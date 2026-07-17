/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Eye, Move, ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react';

interface ImageSliderProps {
  originalUrl: string;
  upscaledUrl: string;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
}

export default function ImageSlider({
  originalUrl,
  upscaledUrl,
  originalWidth,
  originalHeight,
  upscaledWidth,
  upscaledHeight,
}: ImageSliderProps) {
  const [sliderPosition, setSliderPosition] = useState<number>(50); // 0 to 100
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 to 5
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Handle slider drag
  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isPanning && zoomLevel > 1) {
      // Handle panning instead when zoomed
      const touch = e.touches[0];
      const dx = touch.clientX - panStartRef.current.x;
      const dy = touch.clientY - panStartRef.current.y;
      setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      panStartRef.current = { x: touch.clientX, y: touch.clientY };
      return;
    }
    if (e.touches[0]) {
      handleMove(e.touches[0].clientX);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && zoomLevel > 1) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      panStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.buttons === 1) {
      handleMove(e.clientX);
    }
  };

  const handleStartPan = (clientX: number, clientY: number) => {
    if (zoomLevel > 1) {
      setIsPanning(true);
      panStartRef.current = { x: clientX, y: clientY };
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // If clicking the slider bar or zoomed in, allow dragging
    const target = e.target as HTMLElement;
    if (target.closest('.slider-handle')) return; // handled separately or let propagation deal
    handleStartPan(e.clientX, e.clientY);
  };

  const handleMouseUpOrLeave = () => {
    setIsPanning(false);
  };

  // Keep pan offset within bounds
  useEffect(() => {
    if (zoomLevel === 1) {
      setPanOffset({ x: 0, y: 0 });
    } else if (containerRef.current) {
      // Bound the pan offset based on zoom factor
      const rect = containerRef.current.getBoundingClientRect();
      const maxW = (rect.width * (zoomLevel - 1)) / 2;
      const maxH = (rect.height * (zoomLevel - 1)) / 2;
      setPanOffset((prev) => ({
        x: Math.max(-maxW, Math.min(maxW, prev.x)),
        y: Math.max(-maxH, Math.min(maxH, prev.y)),
      }));
    }
  }, [zoomLevel]);

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setSliderPosition((prev) => Math.max(0, prev - 5));
      } else if (e.key === 'ArrowRight') {
        setSliderPosition((prev) => Math.min(100, prev + 5));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`flex flex-col gap-3 w-full ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-950 p-6' : ''}`}>
      {/* Compare Controls */}
      <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 px-4 py-2 rounded-lg">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-slate-300">
            Interactive Comparator: Drag slider to swipe
          </span>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setZoomLevel((z) => Math.max(1, z - 1))}
            disabled={zoomLevel === 1}
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 disabled:opacity-30 disabled:pointer-events-none rounded transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono px-1.5 text-slate-300 font-bold select-none">
            {zoomLevel}x
          </span>
          <button
            onClick={() => setZoomLevel((z) => Math.min(5, z + 1))}
            disabled={zoomLevel === 5}
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 disabled:opacity-30 disabled:pointer-events-none rounded transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-slate-800 mx-1"></div>
          <button
            onClick={() => {
              setIsFullscreen(!isFullscreen);
              setZoomLevel(1);
            }}
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Compare"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Compare stage */}
      <div
        ref={containerRef}
        className={`relative overflow-hidden border border-slate-800 rounded-lg bg-slate-950 flex items-center justify-center select-none ${
          isFullscreen ? 'flex-1 h-0' : 'h-[500px] md:h-[600px]'
        } ${zoomLevel > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-ew-resize'}`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onTouchStart={(e) => handleStartPan(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => handleTouchMove(e.nativeEvent)}
        onTouchEnd={handleMouseUpOrLeave}
      >
        <div
          className="relative transition-transform duration-75 ease-out"
          style={{
            transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
            width: '100%',
            height: '100%',
          }}
        >
          {/* RIGHT SIDE: Upscaled Image (Base) */}
          <img
            src={upscaledUrl}
            alt="Upscaled View"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            style={{ imageRendering: 'auto' }}
          />

          {/* LEFT SIDE: Original Image (Overlay clipped by slider width) */}
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none border-r border-transparent"
            style={{
              width: `${sliderPosition}%`,
              transition: isPanning ? 'none' : 'width 0.05s ease-out',
            }}
          >
            <img
              src={originalUrl}
              alt="Original View"
              className="absolute inset-0 h-full object-contain pointer-events-none"
              style={{
                width: containerRef.current ? containerRef.current.clientWidth : '100%',
                maxWidth: 'none',
                // Keep image rendering pixelated if nearest neighbor, so users see pixels
                imageRendering: 'pixelated',
              }}
            />
          </div>

          {/* Vertical Divider Line */}
          <div
            ref={sliderRef}
            className="absolute top-0 bottom-0 w-[1.5px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)] z-10 pointer-events-none"
            style={{
              left: `${sliderPosition}%`,
              transition: isPanning ? 'none' : 'left 0.05s ease-out',
            }}
          >
            {/* Slider Drag Circle Handle */}
            <div className="slider-handle absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-white text-slate-950 rounded-full flex items-center justify-center shadow-[0_2px_12px_rgba(0,0,0,0.5)] pointer-events-auto cursor-ew-resize hover:scale-105 active:scale-95 transition-all border border-slate-200">
              <Move className="w-3.5 h-3.5 shrink-0" />
            </div>
          </div>

          {/* Side Labels */}
          <div className="absolute top-2.5 left-2.5 bg-slate-950/60 backdrop-blur border border-white/10 text-[10px] text-slate-300 px-2 py-0.5 rounded shadow select-none pointer-events-none z-20 uppercase font-mono">
            Original • {originalWidth}x{originalHeight}
          </div>
          <div className="absolute top-2.5 right-2.5 bg-indigo-600/60 backdrop-blur border border-indigo-400/30 text-[10px] text-white font-bold px-2 py-0.5 rounded shadow select-none pointer-events-none z-20 uppercase font-mono">
            Output • {upscaledWidth}x{upscaledHeight}
          </div>

          {zoomLevel > 1 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-slate-950/90 backdrop-blur border border-slate-800 px-3 py-1 rounded-full shadow text-[10px] text-slate-300 font-mono flex items-center gap-1.5 select-none pointer-events-none z-20">
              <Move className="w-3 h-3 text-indigo-400 animate-pulse" />
              DRAG TO PAN DETAILS
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
