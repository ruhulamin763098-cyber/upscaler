/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UpscalerAlgorithm, UpscalerConfig } from '../types';
import { applyAdjustments, applyDenoise, applySharpen, applyCameraRawSharpen, applyWaveAntiDistortion } from './filters';

// Sinc function
function sinc(x: number): number {
  if (x === 0) return 1.0;
  const piX = Math.PI * x;
  return Math.sin(piX) / piX;
}

// Lanczos-3 Kernel
function lanczosKernel(x: number): number {
  const absX = Math.abs(x);
  if (absX === 0) return 1.0;
  if (absX >= 3.0) return 0.0;
  return sinc(absX) * sinc(absX / 3.0);
}

// Bicubic Kernel (Catmull-Rom spline, a = -0.5)
function bicubicKernel(x: number): number {
  const absX = Math.abs(x);
  const a = -0.5;
  if (absX <= 1.0) {
    return (a + 2.0) * absX * absX * absX - (a + 3.0) * absX * absX + 1.0;
  } else if (absX < 2.0) {
    return a * absX * absX * absX - 5.0 * a * absX * absX + 8.0 * a * absX - 4.0 * a;
  }
  return 0.0;
}

/**
 * High-performance upscaling of a single small tile of an image.
 * This function processes pixels directly in a Uint8ClampedArray for speed.
 * Edge padding is handled outside this function by taking a larger source tile.
 */
export function upscaleTile(
  srcData: ImageData,
  destWidth: number,
  destHeight: number,
  algorithm: UpscalerAlgorithm,
  scale: number,
  offsetX: number, // relative to the destination bounding box
  offsetY: number
): ImageData {
  const srcWidth = srcData.width;
  const srcHeight = srcData.height;
  const srcPixels = srcData.data;

  const destData = new ImageData(destWidth, destHeight);
  const destPixels = destData.data;

  if (algorithm === 'nearest') {
    for (let dy = 0; dy < destHeight; dy++) {
      const targetY = offsetY + dy;
      // Map destination Y back to source fractional Y
      const srcY = Math.min(srcHeight - 1, Math.max(0, Math.floor(targetY / scale)));
      const destRowIdx = dy * destWidth * 4;
      const srcRowIdx = srcY * srcWidth * 4;

      for (let dx = 0; dx < destWidth; dx++) {
        const targetX = offsetX + dx;
        const srcX = Math.min(srcWidth - 1, Math.max(0, Math.floor(targetX / scale)));

        const srcIdx = srcRowIdx + srcX * 4;
        const destIdx = destRowIdx + dx * 4;

        destPixels[destIdx] = srcPixels[srcIdx];         // R
        destPixels[destIdx + 1] = srcPixels[srcIdx + 1]; // G
        destPixels[destIdx + 2] = srcPixels[srcIdx + 2]; // B
        destPixels[destIdx + 3] = srcPixels[srcIdx + 3]; // A
      }
    }
  } else if (algorithm === 'bilinear') {
    for (let dy = 0; dy < destHeight; dy++) {
      const targetY = offsetY + dy;
      const srcY = targetY / scale;
      const y0 = Math.floor(srcY);
      const y1 = Math.min(srcHeight - 1, y0 + 1);
      const yDiff = srcY - y0;

      const destRowIdx = dy * destWidth * 4;

      for (let dx = 0; dx < destWidth; dx++) {
        const targetX = offsetX + dx;
        const srcX = targetX / scale;
        const x0 = Math.floor(srcX);
        const x1 = Math.min(srcWidth - 1, x0 + 1);
        const xDiff = srcX - x0;

        const destIdx = destRowIdx + dx * 4;

        // surrounding 4 pixels indices
        const idx00 = (y0 * srcWidth + x0) * 4;
        const idx10 = (y0 * srcWidth + x1) * 4;
        const idx01 = (y1 * srcWidth + x0) * 4;
        const idx11 = (y1 * srcWidth + x1) * 4;

        // Bilinear interpolation for each color channel
        for (let c = 0; c < 4; c++) {
          const p00 = srcPixels[idx00 + c];
          const p10 = srcPixels[idx10 + c];
          const p01 = srcPixels[idx01 + c];
          const p11 = srcPixels[idx11 + c];

          const top = p00 + xDiff * (p10 - p00);
          const bottom = p01 + xDiff * (p11 - p01);
          destPixels[destIdx + c] = Math.round(top + yDiff * (bottom - top));
        }
      }
    }
  } else if (algorithm === 'bicubic') {
    // Precompute vertical bicubic weights and y0 source positions
    const y0Arr = new Int32Array(destHeight);
    const yWeightsArr = new Float32Array(destHeight * 4);
    for (let dy = 0; dy < destHeight; dy++) {
      const targetY = offsetY + dy;
      const srcY = targetY / scale;
      const y0 = Math.floor(srcY);
      y0Arr[dy] = y0;
      const yDiff = srcY - y0;
      const offset = dy * 4;
      for (let i = -1; i <= 2; i++) {
        yWeightsArr[offset + (i + 1)] = bicubicKernel(yDiff - i);
      }
    }

    // Precompute horizontal bicubic weights and x0 source positions
    const x0Arr = new Int32Array(destWidth);
    const xWeightsArr = new Float32Array(destWidth * 4);
    for (let dx = 0; dx < destWidth; dx++) {
      const targetX = offsetX + dx;
      const srcX = targetX / scale;
      const x0 = Math.floor(srcX);
      x0Arr[dx] = x0;
      const xDiff = srcX - x0;
      const offset = dx * 4;
      for (let j = -1; j <= 2; j++) {
        xWeightsArr[offset + (j + 1)] = bicubicKernel(xDiff - j);
      }
    }

    // High performance pixel loop
    for (let dy = 0; dy < destHeight; dy++) {
      const y0 = y0Arr[dy];
      const yWeightOffset = dy * 4;
      const destRowIdx = dy * destWidth * 4;

      for (let dx = 0; dx < destWidth; dx++) {
        const x0 = x0Arr[dx];
        const xWeightOffset = dx * 4;
        const destIdx = destRowIdx + dx * 4;

        let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
        let weightSum = 0;

        for (let i = -1; i <= 2; i++) {
          const py = Math.min(srcHeight - 1, Math.max(0, y0 + i));
          const yw = yWeightsArr[yWeightOffset + (i + 1)];
          const pyRow = py * srcWidth;

          for (let j = -1; j <= 2; j++) {
            const px = Math.min(srcWidth - 1, Math.max(0, x0 + j));
            const xw = xWeightsArr[xWeightOffset + (j + 1)];
            const weight = yw * xw;

            const idx = (pyRow + px) * 4;
            rSum += srcPixels[idx] * weight;
            gSum += srcPixels[idx + 1] * weight;
            bSum += srcPixels[idx + 2] * weight;
            aSum += srcPixels[idx + 3] * weight;
            weightSum += weight;
          }
        }

        const invWeightSum = 1.0 / (weightSum || 1);
        destPixels[destIdx] = Math.min(255, Math.max(0, Math.round(rSum * invWeightSum)));
        destPixels[destIdx + 1] = Math.min(255, Math.max(0, Math.round(gSum * invWeightSum)));
        destPixels[destIdx + 2] = Math.min(255, Math.max(0, Math.round(bSum * invWeightSum)));
        destPixels[destIdx + 3] = Math.min(255, Math.max(0, Math.round(aSum * invWeightSum)));
      }
    }
  } else if (algorithm === 'lanczos') {
    // Precompute vertical Lanczos weights and normalized values
    const y0Arr = new Int32Array(destHeight);
    const yWeightsArr = new Float32Array(destHeight * 6);
    for (let dy = 0; dy < destHeight; dy++) {
      const targetY = offsetY + dy;
      const srcY = targetY / scale;
      const y0 = Math.floor(srcY);
      y0Arr[dy] = y0;
      const yDiff = srcY - y0;
      const offset = dy * 6;

      let yWeightSum = 0;
      for (let i = -2; i <= 3; i++) {
        const w = lanczosKernel(yDiff - i);
        yWeightsArr[offset + (i + 2)] = w;
        yWeightSum += w;
      }

      // Normalize vertical weights
      if (yWeightSum > 0) {
        for (let i = 0; i < 6; i++) {
          yWeightsArr[offset + i] /= yWeightSum;
        }
      }
    }

    // Precompute horizontal Lanczos weights and normalized values
    const x0Arr = new Int32Array(destWidth);
    const xWeightsArr = new Float32Array(destWidth * 6);
    for (let dx = 0; dx < destWidth; dx++) {
      const targetX = offsetX + dx;
      const srcX = targetX / scale;
      const x0 = Math.floor(srcX);
      x0Arr[dx] = x0;
      const xDiff = srcX - x0;
      const offset = dx * 6;

      let xWeightSum = 0;
      for (let j = -2; j <= 3; j++) {
        const w = lanczosKernel(xDiff - j);
        xWeightsArr[offset + (j + 2)] = w;
        xWeightSum += w;
      }

      // Normalize horizontal weights
      if (xWeightSum > 0) {
        for (let j = 0; j < 6; j++) {
          xWeightsArr[offset + j] /= xWeightSum;
        }
      }
    }

    // High performance pixel loop
    for (let dy = 0; dy < destHeight; dy++) {
      const y0 = y0Arr[dy];
      const yWeightOffset = dy * 6;
      const destRowIdx = dy * destWidth * 4;

      for (let dx = 0; dx < destWidth; dx++) {
        const x0 = x0Arr[dx];
        const xWeightOffset = dx * 6;
        const destIdx = destRowIdx + dx * 4;

        let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

        for (let i = -2; i <= 3; i++) {
          const py = Math.min(srcHeight - 1, Math.max(0, y0 + i));
          const yw = yWeightsArr[yWeightOffset + (i + 2)];
          const pyRow = py * srcWidth;

          for (let j = -2; j <= 3; j++) {
            const px = Math.min(srcWidth - 1, Math.max(0, x0 + j));
            const xw = xWeightsArr[xWeightOffset + (j + 2)];
            const weight = yw * xw;

            const idx = (pyRow + px) * 4;
            rSum += srcPixels[idx] * weight;
            gSum += srcPixels[idx + 1] * weight;
            bSum += srcPixels[idx + 2] * weight;
            aSum += srcPixels[idx + 3] * weight;
          }
        }

        destPixels[destIdx] = Math.min(255, Math.max(0, Math.round(rSum)));
        destPixels[destIdx + 1] = Math.min(255, Math.max(0, Math.round(gSum)));
        destPixels[destIdx + 2] = Math.min(255, Math.max(0, Math.round(bSum)));
        destPixels[destIdx + 3] = Math.min(255, Math.max(0, Math.round(aSum)));
      }
    }
  }

  return destData;
}

/**
 * Orchestrator that upscales an image chunk-by-chunk (Tiled Processing) to save RAM.
 * Calls state updates periodically to avoid blocking the main UI thread.
 */
export async function processImageTiled(
  img: HTMLImageElement,
  config: UpscalerConfig,
  onProgress: (progress: number, currentTile: number, totalTiles: number) => void,
  onComplete: (upscaledDataUrl: string) => void,
  onCancelRef: { current: boolean }
): Promise<void> {
  const scale = config.scale;
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  const destWidth = Math.round(originalWidth * scale);
  const destHeight = Math.round(originalHeight * scale);

  // Setup the original source canvas
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = originalWidth;
  srcCanvas.height = originalHeight;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Could not create original canvas context');
  srcCtx.drawImage(img, 0, 0);

  // Setup the final high-resolution output canvas
  const destCanvas = document.createElement('canvas');
  destCanvas.width = destWidth;
  destCanvas.height = destHeight;
  const destCtx = destCanvas.getContext('2d');
  if (!destCtx) throw new Error('Could not create output canvas context');

  // Define tile grid based on config (or single tile if disabled)
  const tileSize = config.lowMemoryMode ? config.tileSize : Math.max(destWidth, destHeight);
  const cols = Math.ceil(destWidth / tileSize);
  const rows = Math.ceil(destHeight / tileSize);
  const totalTiles = cols * rows;

  let currentTile = 0;

  // Extra margin (padding) to avoid edge seams between tiles during bilinear/bicubic/lanczos filtering
  const padding = config.algorithm === 'lanczos' ? 3 : (config.algorithm === 'bicubic' ? 2 : (config.algorithm === 'bilinear' ? 1 : 0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (onCancelRef.current) {
        // Safe cleanup
        srcCanvas.width = 0;
        srcCanvas.height = 0;
        destCanvas.width = 0;
        destCanvas.height = 0;
        return;
      }

      // 1. Determine bounding box for this tile in the upscaled (destination) image
      const tileX = c * tileSize;
      const tileY = r * tileSize;
      const tileW = Math.min(tileSize, destWidth - tileX);
      const tileH = Math.min(tileSize, destHeight - tileY);

      // 2. Map back to source image to extract the appropriate chunk with padding
      const srcTileX_Float = tileX / scale;
      const srcTileY_Float = tileY / scale;
      const srcTileW_Float = tileW / scale;
      const srcTileH_Float = tileH / scale;

      // Add integer padding around the source region, bounding it by source dimensions
      const srcX_Padded = Math.max(0, Math.floor(srcTileX_Float) - padding);
      const srcY_Padded = Math.max(0, Math.floor(srcTileY_Float) - padding);
      const srcXEnd_Padded = Math.min(originalWidth, Math.ceil(srcTileX_Float + srcTileW_Float) + padding);
      const srcYEnd_Padded = Math.min(originalHeight, Math.ceil(srcTileY_Float + srcTileH_Float) + padding);

      const srcW_Padded = srcXEnd_Padded - srcX_Padded;
      const srcH_Padded = srcYEnd_Padded - srcY_Padded;

      if (srcW_Padded <= 0 || srcH_Padded <= 0) continue;

      // 3. Extract the padded source sub-image data
      const srcTileData = srcCtx.getImageData(srcX_Padded, srcY_Padded, srcW_Padded, srcH_Padded);

      // Calculate the correct pixel offsets for upscaling inside the padded source coordinate box
      // Target sub-region: We are writing a destination tile at (tileX, tileY) of size (tileW, tileH).
      // Relative to srcX_Padded and srcY_Padded:
      const relativeDestOffsetX = tileX - (srcX_Padded * scale);
      const relativeDestOffsetY = tileY - (srcY_Padded * scale);

      // 4. Perform scaling on the tiny sub-image
      const scaledTileData = upscaleTile(
        srcTileData,
        tileW,
        tileH,
        config.algorithm,
        scale,
        relativeDestOffsetX,
        relativeDestOffsetY
      );

      // 5. Apply filters directly on this tiny scaled tile (saving huge RAM and CPU!)
      // Apply Denoise (Bilateral filter)
      let finalTilePixels = scaledTileData.data;
      if (config.denoise !== 'off') {
        const filteredTile = new ImageData(tileW, tileH);
        applyDenoise(scaledTileData.data, filteredTile.data, tileW, tileH, config.denoise);
        finalTilePixels = filteredTile.data;
      }

      // Apply Sharpening (Convolution / Camera Raw)
      if (config.sharpen > 0) {
        const sharpenedTile = new ImageData(tileW, tileH);
        if (config.cameraRawMode) {
          applyCameraRawSharpen(finalTilePixels, sharpenedTile.data, tileW, tileH, config.sharpen);
        } else {
          applySharpen(finalTilePixels, sharpenedTile.data, tileW, tileH, config.sharpen);
        }
        finalTilePixels = sharpenedTile.data;
      }
      
      // Apply Advanced Wave Anti-Distortion / AI Artifact Prevention
      if (config.antiDistortion && config.antiDistortionStrength && config.antiDistortionStrength > 0) {
        const antiDistortionTile = new ImageData(tileW, tileH);
        applyWaveAntiDistortion(finalTilePixels, antiDistortionTile.data, tileW, tileH, config.antiDistortionStrength);
        finalTilePixels = antiDistortionTile.data;
      }

      // Apply Brightness/Contrast/Saturation
      if (config.brightness !== 100 || config.contrast !== 100 || config.saturation !== 100) {
        applyAdjustments(finalTilePixels, config.brightness, config.contrast, config.saturation);
      }

      // Create a temporary ImageData to draw onto the final canvas
      const tileImageData = new ImageData(finalTilePixels, tileW, tileH);
      
      // Draw this single scaled & filtered tile directly onto the final master canvas
      destCtx.putImageData(tileImageData, tileX, tileY);

      currentTile++;
      const progressPercent = Math.round((currentTile / totalTiles) * 100);
      onProgress(progressPercent, currentTile, totalTiles);

      // Yield thread back to browser to process frames, rendering UI responsive,
      // and allowing the garbage collector (GC) to immediately deallocate temporary buffers!
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  // Generate output DataURL
  const finalUrl = destCanvas.toDataURL('image/png');

  // Deallocate canvases immediately to prevent memory leaks!
  srcCanvas.width = 0;
  srcCanvas.height = 0;
  destCanvas.width = 0;
  destCanvas.height = 0;

  onComplete(finalUrl);
}

/**
 * Calculates RAM footprint metrics comparing tiled processing vs single large canvas rendering.
 */
export function calculateRamMetrics(width: number, height: number, scale: number, config: UpscalerConfig): {
  estimatedOriginalBytes: number;
  estimatedOutputBytes: number;
  peakRamWithTiling: number;
  peakRamWithoutTiling: number;
  ramSavedBytes: number;
  ramSavedPercentage: number;
} {
  const originalPixels = width * height;
  const outputPixels = Math.round(width * scale) * Math.round(height * scale);

  // ImageData takes 4 bytes per pixel.
  const estimatedOriginalBytes = originalPixels * 4;
  const estimatedOutputBytes = outputPixels * 4;

  // Without tiling: Canvas image + source ImageData + scaled ImageData + denoise buffer + sharpen buffer + adjustments.
  // Can easily reach 5-8x the uncompressed image size in working RAM.
  const baseOverhead = 5;
  const peakRamWithoutTiling = (estimatedOriginalBytes + estimatedOutputBytes) * baseOverhead;

  // With tiling: Source canvas + destination canvas + tiny active tile ImageData (e.g. 256x256).
  // Active tile is tiny: e.g. 256x256 * 4 = 256KB, filters on active tile = 256KB * 3 = 768KB.
  const activeTileSize = config.lowMemoryMode ? config.tileSize : Math.max(Math.round(width * scale), Math.round(height * scale));
  const activeTilePixels = Math.min(outputPixels, activeTileSize * activeTileSize);
  const activeTileBytes = activeTilePixels * 4;

  const peakRamWithTiling = (estimatedOriginalBytes + estimatedOutputBytes) + (activeTileBytes * baseOverhead);

  const ramSavedBytes = Math.max(0, peakRamWithoutTiling - peakRamWithTiling);
  const ramSavedPercentage = peakRamWithoutTiling > 0 ? (ramSavedBytes / peakRamWithoutTiling) * 100 : 0;

  return {
    estimatedOriginalBytes,
    estimatedOutputBytes,
    peakRamWithTiling,
    peakRamWithoutTiling,
    ramSavedBytes,
    ramSavedPercentage,
  };
}
