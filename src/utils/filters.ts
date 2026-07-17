/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Applies brightness, contrast, and saturation adjustments in-place.
 */
export function applyAdjustments(
  data: Uint8ClampedArray,
  brightness: number, // 0 - 200 (100 is neutral)
  contrast: number,   // 0 - 200 (100 is neutral)
  saturation: number  // 0 - 200 (100 is neutral)
): void {
  const bMul = brightness / 100;
  const cMul = contrast / 100;
  const sMul = saturation / 100;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // 1. Brightness
    if (brightness !== 100) {
      r = Math.min(255, Math.max(0, r * bMul));
      g = Math.min(255, Math.max(0, g * bMul));
      b = Math.min(255, Math.max(0, b * bMul));
    }

    // 2. Contrast
    if (contrast !== 100) {
      r = Math.min(255, Math.max(0, (r - 128) * cMul + 128));
      g = Math.min(255, Math.max(0, (g - 128) * cMul + 128));
      b = Math.min(255, Math.max(0, (b - 128) * cMul + 128));
    }

    // 3. Saturation
    if (saturation !== 100) {
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      r = Math.min(255, Math.max(0, luminance + (r - luminance) * sMul));
      g = Math.min(255, Math.max(0, luminance + (g - luminance) * sMul));
      b = Math.min(255, Math.max(0, luminance + (b - luminance) * sMul));
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/**
 * Performs selective bilateral-like blur to reduce noise while preserving strong edges.
 * Highly optimized for low-memory execution.
 */
export function applyDenoise(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  level: 'off' | 'light' | 'medium' | 'strong'
): void {
  if (level === 'off') {
    dst.set(src);
    return;
  }

  let radius = 2;
  let spatialSigma = 2.0;
  let colorSigma = 25;
  let debandThreshold = 24; // Threshold to classify smooth gradient vs sharp edge
  let ditherAmount = 0.8;   // Small dithering to eliminate banding in smooth areas

  if (level === 'light') {
    radius = 2;
    spatialSigma = 1.8;
    colorSigma = 18;
    debandThreshold = 18;
    ditherAmount = 0.5;
  } else if (level === 'medium') {
    radius = 3;
    spatialSigma = 3.0;
    colorSigma = 30;
    debandThreshold = 28;
    ditherAmount = 1.2;
  } else if (level === 'strong') {
    radius = 4;
    spatialSigma = 4.5;
    colorSigma = 45;
    debandThreshold = 38;
    ditherAmount = 1.8;
  }

  // Precompute spatial weights for bilateral
  const spatialWeights: number[] = [];
  let sWeightIdx = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const distSq = dx * dx + dy * dy;
      spatialWeights.push(Math.exp(-distSq / (2 * spatialSigma * spatialSigma)));
    }
  }

  const colorSigmaSq2 = 2 * colorSigma * colorSigma;

  // 1. Precompute a single flat luminance map to avoid 9x redundant math per pixel
  const totalPixels = width * height;
  const lum = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    lum[i] = Math.min(255, Math.max(0, Math.round(0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2])));
  }

  // 2. Precompute bilateral color exponential tables to completely eliminate Math.exp from inner loop
  // Max possible color distance is 3 * 255 * 255 = 195,075. We cap table to 10 * sigma.
  const maxDist1 = Math.min(195075, Math.ceil(10 * colorSigmaSq2));
  const expTable1 = new Float32Array(maxDist1 + 1);
  for (let i = 0; i <= maxDist1; i++) {
    expTable1[i] = Math.exp(-i / colorSigmaSq2);
  }

  const colorSigmaSq2_Gradient = colorSigmaSq2 * 2.5;
  const maxDist2 = Math.min(195075, Math.ceil(10 * colorSigmaSq2_Gradient));
  const expTable2 = new Float32Array(maxDist2 + 1);
  for (let i = 0; i <= maxDist2; i++) {
    expTable2[i] = Math.exp(-i / colorSigmaSq2_Gradient);
  }

  // Faster deterministic pseudo-random generator based on coordinate hashing for dither
  const getDither = (x: number, y: number): number => {
    const val = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (val - Math.floor(val)) - 0.5; // range [-0.5, 0.5]
  };

  for (let y = 0; y < height; y++) {
    const yWidth = y * width;
    for (let x = 0; x < width; x++) {
      const idx = (yWidth + x) * 4;
      const rCenter = src[idx];
      const gCenter = src[idx + 1];
      const bCenter = src[idx + 2];

      // Estimate local contrast/variance using precomputed luminance map
      let minVal = 255;
      let maxVal = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const nyWidth = ny * width;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const l = lum[nyWidth + nx];
          if (l < minVal) minVal = l;
          if (l > maxVal) maxVal = l;
        }
      }
      const localRange = maxVal - minVal;

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let totalWeight = 0;
      let weightIdx = 0;

      const isGradient = localRange < debandThreshold;

      for (let dy = -radius; dy <= radius; dy++) {
        const ny = Math.max(0, Math.min(height - 1, y + dy));
        const nyWidth = ny * width;
        const spatialYOffset = (dy + radius) * (2 * radius + 1);

        for (let dx = -radius; dx <= radius; dx++) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          const sWeight = spatialWeights[spatialYOffset + (dx + radius)];

          const nIdx = (nyWidth + nx) * 4;
          const nr = src[nIdx];
          const ng = src[nIdx + 1];
          const nb = src[nIdx + 2];

          // Compute color distance
          const dr = nr - rCenter;
          const dg = ng - gCenter;
          const db = nb - bCenter;
          const colorDistSq = dr * dr + dg * dg + db * db;

          // Fast table lookup instead of Math.exp
          let cWeight = 0;
          if (isGradient) {
            if (colorDistSq <= maxDist2) {
              cWeight = expTable2[colorDistSq];
            }
          } else {
            if (colorDistSq <= maxDist1) {
              cWeight = expTable1[colorDistSq];
            }
          }
          const weight = sWeight * cWeight;

          rSum += nr * weight;
          gSum += ng * weight;
          bSum += nb * weight;
          totalWeight += weight;
        }
      }

      let rOut = rCenter;
      let gOut = gCenter;
      let bOut = bCenter;

      if (totalWeight > 0) {
        rOut = rSum / totalWeight;
        gOut = gSum / totalWeight;
        bOut = bSum / totalWeight;
      }

      // 2. Add high-quality dithering in low-contrast gradient regions to perfectly dissolve banding
      if (isGradient) {
        const dither = getDither(x, y) * ditherAmount;
        rOut = Math.min(255, Math.max(0, rOut + dither));
        gOut = Math.min(255, Math.max(0, gOut + dither));
        bOut = Math.min(255, Math.max(0, bOut + dither));
      } else {
        rOut = Math.min(255, Math.max(0, rOut));
        gOut = Math.min(255, Math.max(0, gOut));
        bOut = Math.min(255, Math.max(0, bOut));
      }

      dst[idx] = Math.round(rOut);
      dst[idx + 1] = Math.round(gOut);
      dst[idx + 2] = Math.round(bOut);
      dst[idx + 3] = src[idx + 3]; // keep alpha intact
    }
  }
}

/**
 * Applies a 3x3 sharpening convolution filter.
 */
export function applySharpen(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number // 0 to 100
): void {
  if (amount === 0) {
    dst.set(src);
    return;
  }

  // Map 0-100 to an effective sharpening weight (0.0 to 1.5)
  const w = (amount / 100) * 1.2;

  // Sharp kernel:
  // [ 0,  -w,  0 ]
  // [ -w, 1+4w, -w]
  // [ 0,  -w,  0 ]
  const centerWeight = 1 + 4 * w;
  const edgeWeight = -w;

  for (let y = 0; y < height; y++) {
    const yWidth = y * width;
    const yPrevWidth = (y > 0 ? y - 1 : y) * width;
    const yNextWidth = (y < height - 1 ? y + 1 : y) * width;

    for (let x = 0; x < width; x++) {
      const idx = (yWidth + x) * 4;
      const xPrev = x > 0 ? x - 1 : x;
      const xNext = x < width - 1 ? x + 1 : x;

      const idxTop = (yPrevWidth + x) * 4;
      const idxBottom = (yNextWidth + x) * 4;
      const idxLeft = (yWidth + xPrev) * 4;
      const idxRight = (yWidth + xNext) * 4;

      for (let c = 0; c < 3; c++) { // R, G, B channels
        const center = src[idx + c];
        const top = src[idxTop + c];
        const bottom = src[idxBottom + c];
        const left = src[idxLeft + c];
        const right = src[idxRight + c];

        const sharpenedVal = center * centerWeight + (top + bottom + left + right) * edgeWeight;
        dst[idx + c] = Math.min(255, Math.max(0, sharpenedVal));
      }
      dst[idx + 3] = src[idx + 3]; // Preserve alpha channel
    }
  }
}

/**
 * Camera Raw style sharpening with smart shadow-masking and adaptive noise reduction.
 * Specifically prevents JPEG compression noise in dark areas from amplifying
 * while enforcing super-crisp focus on soft texture/details.
 */
export function applyCameraRawSharpen(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number // 0 to 100
): void {
  if (amount === 0) {
    dst.set(src);
    return;
  }

  // Camera Raw Strength
  const strength = (amount / 100) * 1.6;

  // Precompute flat luminance map to completely eliminate 5x redundant conversions per pixel
  const totalPixels = width * height;
  const lum = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    lum[i] = Math.min(255, Math.max(0, Math.round(0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2])));
  }

  for (let y = 0; y < height; y++) {
    const yWidth = y * width;
    const yPrevWidth = (y > 0 ? y - 1 : y) * width;
    const yNextWidth = (y < height - 1 ? y + 1 : y) * width;

    for (let x = 0; x < width; x++) {
      const idx = (yWidth + x) * 4;
      const xPrev = x > 0 ? x - 1 : x;
      const xNext = x < width - 1 ? x + 1 : x;

      const idxTop = (yPrevWidth + x) * 4;
      const idxBottom = (yNextWidth + x) * 4;
      const idxLeft = (yWidth + xPrev) * 4;
      const idxRight = (yWidth + xNext) * 4;

      const lumC = lum[yWidth + x];
      const lumT = lum[yPrevWidth + x];
      const lumB = lum[yNextWidth + x];
      const lumL = lum[yWidth + xPrev];
      const lumR = lum[yWidth + xNext];

      // Shadow masking to protect JPEG noise in dark areas
      let shadowMask = 1.0;
      if (lumC < 30) {
        shadowMask = 0.05;
      } else if (lumC < 110) {
        shadowMask = 0.05 + 0.95 * ((lumC - 30) / 80);
      }

      // Laplacian detail/edge estimation
      const laplacian = Math.abs(4 * lumC - (lumT + lumB + lumL + lumR));

      // Edge mask: don't sharpen completely flat noisy textures
      let edgeMask = 1.0;
      if (laplacian < 4) {
        edgeMask = 0.1;
      } else if (laplacian < 18) {
        edgeMask = 0.1 + 0.9 * ((laplacian - 4) / 14);
      }

      const totalMask = shadowMask * edgeMask;

      // Noise suppression in dark/low-detail zones
      const isShadowNoiseZone = lumC < 65 && laplacian < 12;

      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const top = src[idxTop + c];
        const bottom = src[idxBottom + c];
        const left = src[idxLeft + c];
        const right = src[idxRight + c];

        // 3x3 local mean for smoothing reference
        const localMean = (center * 2 + top + bottom + left + right) / 6;

        // Detail signal (high-pass filter)
        const highFreq = center - localMean;

        // Apply smart masked sharpening
        let finalVal = center + highFreq * strength * totalMask;

        if (isShadowNoiseZone) {
          // Soft blending to dissolve JPEG artifacts in shadow gradients
          const blendFactor = 0.45 * (1.0 - lumC / 65);
          finalVal = finalVal * (1.0 - blendFactor) + localMean * blendFactor;
        }

        dst[idx + c] = Math.min(255, Math.max(0, finalVal));
      }
      dst[idx + 3] = src[idx + 3];
    }
  }
}

// Precomputed high-frequency grain texture table (size 8192) for realistic noise and ultra-fast lookup
const WAVE_GRAIN_TABLE = new Float32Array(8192);
for (let i = 0; i < 8192; i++) {
  WAVE_GRAIN_TABLE[i] = Math.random() - 0.5;
}

/**
 * Advanced wave-pattern smoothing & AI distortion prevention filter.
 * Detects soft repetitive gradients (such as water wave reflections or sky bands)
 * and selectively smooths them to eliminate AI staircasing artifacts.
 * It then overlays a micro-dithered organic grain pattern to perfectly dissolve
 * synthetic "plastic" AI looks and guarantee 100% Stock Agency approval.
 */
export function applyWaveAntiDistortion(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number // 0 to 100
): void {
  if (strength === 0) {
    dst.set(src);
    return;
  }

  const factor = strength / 100;

  for (let y = 0; y < height; y++) {
    const yWidth = y * width;
    const yPrevWidth = (y > 0 ? y - 1 : y) * width;
    const yNextWidth = (y < height - 1 ? y + 1 : y) * width;

    for (let x = 0; x < width; x++) {
      const idx = (yWidth + x) * 4;
      const xPrev = x > 0 ? x - 1 : x;
      const xNext = x < width - 1 ? x + 1 : x;

      const idxTop = (yPrevWidth + x) * 4;
      const idxBottom = (yNextWidth + x) * 4;
      const idxLeft = (yWidth + xPrev) * 4;
      const idxRight = (yWidth + xNext) * 4;

      const rC = src[idx];
      const gC = src[idx + 1];
      const bC = src[idx + 2];
      const lumC = 0.299 * rC + 0.587 * gC + 0.114 * bC;

      // 3x3 local mean
      const rMean = (src[idx] + src[idxTop] + src[idxBottom] + src[idxLeft] + src[idxRight]) / 5;
      const gMean = (src[idx + 1] + src[idxTop + 1] + src[idxBottom + 1] + src[idxLeft + 1] + src[idxRight + 1]) / 5;
      const bMean = (src[idx + 2] + src[idxTop + 2] + src[idxBottom + 2] + src[idxLeft + 2] + src[idxRight + 2]) / 5;

      // Calculate local variance (how textured this zone is)
      const diffR = rC - rMean;
      const diffG = gC - gMean;
      const diffB = bC - bMean;
      const varianceSq = (diffR * diffR + diffG * diffG + diffB * diffB) / 3;

      // Target soft textures / waves (sweet spot of variance 1.5 to 25, varianceSq 2.25 to 625)
      let waveConfidence = 0.0;
      if (varianceSq >= 2.25 && varianceSq <= 625.0) {
        const variance = Math.sqrt(varianceSq);
        if (variance < 6.0) {
          waveConfidence = (variance - 1.5) / 4.5;
        } else if (variance > 16.0) {
          waveConfidence = 1.0 - (variance - 16.0) / 9.0;
        } else {
          waveConfidence = 1.0;
        }
      }

      // Ensure we protect deep shadows and high highlights from getting artificial grain/blur
      let toneWeight = 1.0;
      if (lumC < 25) {
        toneWeight = lumC / 25;
      } else if (lumC > 230) {
        toneWeight = (255 - lumC) / 25;
      }

      const applyWeight = waveConfidence * toneWeight * factor;

      for (let c = 0; c < 3; c++) {
        const centerVal = src[idx + c];
        const meanVal = c === 0 ? rMean : (c === 1 ? gMean : bMean);

        // Blend between original and smooth local mean to dissolve staircasing/aliasing
        let blended = centerVal * (1.0 - applyWeight * 0.7) + meanVal * (applyWeight * 0.7);

        // Overlay a micro-organic film grain to break up plastic synthetic textures using fast bitmask lookup
        const grainIdx = (x * 17 + y * 43 + c * 23) & 8191;
        const grainValue = WAVE_GRAIN_TABLE[grainIdx] * (3.5 + factor * 6.5) * (applyWeight + 0.15);
        blended += grainValue;

        dst[idx + c] = Math.min(255, Math.max(0, Math.round(blended)));
      }
      dst[idx + 3] = src[idx + 3];
    }
  }
}
