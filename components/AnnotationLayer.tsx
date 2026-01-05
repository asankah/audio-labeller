
import React, { useState, useRef } from 'react';
import { Annotation } from '../types';

interface AnnotationLayerProps {
  annotations: Annotation[];
  onAdd: (ann: Annotation) => void;
  onRemove: (id: string) => void;
  isDrawing: boolean;
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({ 
  annotations, 
  onAdd, 
  onRemove,
  isDrawing
}) => {
  const containerRef = useRef<SVGSVGElement>(null);
  const [currentDrag, setCurrentDrag] = useState<{ x: number, w: number } | null>(null);

  const getPos = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    const { x } = getPos(e);
    setCurrentDrag({ x, w: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!currentDrag || !isDrawing) return;
    const { x } = getPos(e);
    setCurrentDrag(prev => prev ? {
      ...prev,
      w: x - prev.x
    } : null);
  };

  const handleMouseUp = () => {
    if (!currentDrag || !isDrawing) return;
    
    const finalAnn = {
      id: Math.random().toString(36).substr(2, 9),
      x: Math.min(currentDrag.x, currentDrag.x + currentDrag.w),
      width: Math.abs(currentDrag.w),
      label: ''
    };

    if (finalAnn.width > 0.001) { // Low threshold for high-zoom precision
      onAdd(finalAnn);
    }
    setCurrentDrag(null);
  };

  return (
    <svg 
      ref={containerRef}
      className={`absolute inset-0 w-full h-full touch-none ${isDrawing ? 'cursor-crosshair' : 'cursor-default'}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {annotations.map(ann => (
        <g key={ann.id}>
          {/* Vertical temporal masking strip */}
          <rect
            x={`${ann.x * 100}%`}
            y="0"
            width={`${ann.width * 100}%`}
            height="100%"
            fill="rgba(239, 68, 68, 0.25)"
            stroke="#ef4444"
            strokeWidth="1.5"
            className="pointer-events-none"
          />
          
          {/* Label Display */}
          {ann.label && (
            <foreignObject
              x={`${ann.x * 100}%`}
              y="40"
              width={`${ann.width * 100}%`}
              height="20"
              className="overflow-visible pointer-events-none"
            >
              <div className="flex justify-center w-full">
                <span className="bg-slate-900/80 text-white text-[9px] px-1 py-0.5 rounded border border-slate-700 whitespace-nowrap backdrop-blur-sm">
                  {ann.label}
                </span>
              </div>
            </foreignObject>
          )}

          {/* Close button - anchored to right edge of strip */}
          <foreignObject
             x={`${(ann.x + ann.width) * 100}%`}
             y="8"
             width="40"
             height="40"
             className="overflow-visible"
          >
            <div className="flex -translate-x-full justify-end pr-1 pointer-events-auto">
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onRemove(ann.id); 
                }}
                className="bg-red-500 hover:bg-red-600 text-white rounded-md w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow-xl border border-red-400/50 transition-all hover:scale-110 active:scale-95"
                title="Remove interval"
              >
                ✕
              </button>
            </div>
          </foreignObject>
        </g>
      ))}

      {/* Active Selection Visual Feedback */}
      {currentDrag && (
        <rect
          x={`${Math.min(currentDrag.x, currentDrag.x + currentDrag.w) * 100}%`}
          y="0"
          width={`${Math.abs(currentDrag.w) * 100}%`}
          height="100%"
          fill="rgba(59, 130, 246, 0.3)"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeDasharray="4"
          className="pointer-events-none"
        />
      )}
    </svg>
  );
};
