/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RamMetrics } from '../types';
import { Cpu, CheckCircle, AlertCircle, Info, Zap } from 'lucide-react';

interface RamMonitorProps {
  metrics: RamMetrics | null;
  lowMemoryMode: boolean;
  tileSize: number;
}

export default function RamMonitor({ metrics, lowMemoryMode, tileSize }: RamMonitorProps) {
  if (!metrics) return null;

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isRamAtRiskWithoutTiling = metrics.peakRamWithoutTiling > 250 * 1024 * 1024; // >250MB uncompressed working heap is high risk on 4GB RAM browser tabs

  return (
    <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-4 shadow-xl text-slate-100">
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-indigo-400" />
          <h3 className="font-semibold text-xs tracking-tight text-slate-200">RAM & PERFORMANCE ANALYSIS</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {lowMemoryMode ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
              Tiled Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
              <AlertCircle className="w-3 h-3" />
              Tiled Off
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        {/* Core memory footprint */}
        <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">Peak RAM Usage</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold tracking-tight text-indigo-400 font-mono">
              {formatBytes(lowMemoryMode ? metrics.peakRamWithTiling : metrics.peakRamWithoutTiling)}
            </span>
            <span className="text-[10px] text-slate-500 font-mono uppercase">max heap</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5 leading-normal flex items-start gap-1">
            <Info className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
            Allocated JS heap threshold during the scaling pipeline.
          </p>
        </div>

        {/* Saved RAM */}
        <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">RAM Saved</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold tracking-tight text-indigo-400 font-mono">
              {lowMemoryMode ? formatBytes(metrics.ramSavedBytes) : '0 MB'}
            </span>
            {lowMemoryMode && (
              <span className="text-[11px] font-bold text-indigo-400 font-mono">
                (-{metrics.ramSavedPercentage.toFixed(0)}%)
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5 leading-normal flex items-start gap-1">
            <Zap className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
            Reduced risk of browser tab crash on 4GB RAM devices.
          </p>
        </div>

        {/* Device safety */}
        <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">Compatibility</span>
          <div className="flex items-center gap-1.5 mt-1">
            {lowMemoryMode ? (
              <>
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400 uppercase">100% Safe (4GB)</span>
              </>
            ) : isRamAtRiskWithoutTiling ? (
              <>
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span className="text-xs font-bold text-red-400 uppercase">High Crash Risk</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-400 uppercase">Moderate RAM</span>
              </>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-2 leading-normal">
            {lowMemoryMode
              ? `Processing image in tiny ${tileSize}x${tileSize}px visual chunks to bound active canvas memory.`
              : 'Scaling entire canvas concurrently can spike heap memory, causing low-RAM devices to close.'}
          </p>
        </div>
      </div>

      {lowMemoryMode && (
        <div className="bg-slate-950/20 border border-slate-800 p-2.5 rounded-lg">
          <div className="flex items-start gap-2">
            <div className="p-1 rounded bg-indigo-500/10 text-indigo-400 mt-0.5">
              <Zap className="w-3 h-3" />
            </div>
            <div>
              <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Memory Allocation Mitigation:</h4>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                Browsers enforce strict memory quotas per tab. 
                Upscaling a photo to 4K allocates large pixel buffers, and mathematical convolution filters 
                (Lanczos, sharpening) amplify this heap up to 8x, triggering OOM crashes. 
                Our **Tiled Canvas Pipeline** processes one tiny chunk at a time, keeping peak memory completely flat.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
