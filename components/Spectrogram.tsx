
import React, { useRef, useEffect } from 'react';

interface SpectrogramProps {
  data: number[][]; // [time][frequency]
  zoomX: number;
  zoomY: number;
}

export const Spectrogram: React.FC<SpectrogramProps> = ({ data, zoomX, zoomY }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !data.length) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const numFrames = data.length;
    const numBins = data[0].length;
    
    // Set internal canvas resolution based on zoom to keep it sharp
    // We cap it to avoid browser canvas limits, but 10x is usually safe
    canvas.width = Math.min(numFrames * zoomX, 8000); 
    canvas.height = Math.min(numBins * zoomY, 4000);

    const imgData = ctx.createImageData(canvas.width, canvas.height);
    
    // Find min/max for normalization
    let min = Infinity;
    let max = -Infinity;
    for (let f = 0; f < numFrames; f++) {
      for (let b = 0; b < numBins; b++) {
        if (data[f][b] < min) min = data[f][b];
        if (data[f][b] > max) max = data[f][b];
      }
    }

    // Render loop with scaling logic
    for (let x = 0; x < canvas.width; x++) {
      const f = Math.floor((x / canvas.width) * numFrames);
      for (let y = 0; y < canvas.height; y++) {
        const b = Math.floor(((canvas.height - 1 - y) / canvas.height) * numBins);
        
        const val = (data[f][b] - min) / (max - min);
        const idx = (y * canvas.width + x) * 4;
        
        // High-contrast Magma-style colormap
        imgData.data[idx] = Math.pow(val, 0.8) * 255; // R
        imgData.data[idx + 1] = Math.pow(val, 1.5) * 200; // G
        imgData.data[idx + 2] = Math.pow(val, 3) * 150 + 40; // B
        imgData.data[idx + 3] = 255; // A
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [data, zoomX, zoomY]);

  return (
    <canvas 
      ref={canvasRef} 
      className="block w-full h-full"
      style={{ 
        imageRendering: 'auto',
        minWidth: '100%',
        minHeight: '100%'
      }}
    />
  );
};
