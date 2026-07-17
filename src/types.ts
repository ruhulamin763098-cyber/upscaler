/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface QueueItem {
  id: string;
  originalUrl: string;
  originalWidth: number;
  originalHeight: number;
  originalName: string;
  originalSize: number;
  upscaledUrl: string | null;
  upscaledWidth: number;
  upscaledHeight: number;
  upscaledSize: number;
  isProcessing: boolean;
  progress: number;
  currentTile: number;
  totalTiles: number;
  elapsedTime: number;
  config: UpscalerConfig;
  recommendation: GeminiRecommendation | null;
}

export type UpscalerAlgorithm = 'lanczos' | 'bicubic' | 'bilinear' | 'nearest';

export interface UpscalerConfig {
  algorithm: UpscalerAlgorithm;
  scale: number;
  denoise: 'off' | 'light' | 'medium' | 'strong';
  sharpen: number; // 0 to 100
  cameraRawMode?: boolean; // activates Camera Raw custom smart sharpening filter
  antiDistortion?: boolean; // activates advanced wave-pattern smoothing and AI artifact prevention
  antiDistortionStrength?: number; // 0 to 100 strength for wave and gradient refinement
  brightness: number; // 0 to 200 (100 is default)
  contrast: number; // 0 to 200 (100 is default)
  saturation: number; // 0 to 200 (100 is default)
  lowMemoryMode: boolean;
  tileSize: number; // 128 | 256 | 512
}

export interface ImageState {
  originalUrl: string | null;
  originalWidth: number;
  originalHeight: number;
  originalName: string;
  originalSize: number; // in bytes
  upscaledUrl: string | null;
  upscaledWidth: number;
  upscaledHeight: number;
  upscaledSize: number; // in bytes
  isProcessing: boolean;
  progress: number; // 0 to 100
  currentTile: number;
  totalTiles: number;
  elapsedTime: number; // in ms
}

export interface GeminiRecommendation {
  caption: string;
  algorithm: UpscalerAlgorithm;
  scale: number;
  denoise: 'off' | 'light' | 'medium' | 'strong';
  sharpen: number;
  brightness: number;
  contrast: number;
  saturation: number;
  reasoning: string;
}

export interface RamMetrics {
  estimatedOriginalBytes: number;
  estimatedOutputBytes: number;
  peakRamWithTiling: number;
  peakRamWithoutTiling: number;
  ramSavedBytes: number;
  ramSavedPercentage: number;
}
