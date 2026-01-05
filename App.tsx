
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from './components/Button';
import { Spectrogram } from './components/Spectrogram';
import { AnnotationLayer } from './components/AnnotationLayer';
import { Annotation, SpectrogramData, AudioState } from './types';
import { computeSpectrogram, applyMaskAndReconstruct, audioBufferToWav } from './services/audioUtils';

const RECORDING_DURATION = 8000;

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [specData, setSpecData] = useState<SpectrogramData | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFiltered, setIsFiltered] = useState(false);
  const [status, setStatus] = useState<string>('Ready to capture audio...');
  const [clipName, setClipName] = useState<string>('Untitled Recording');
  
  // Zoom State
  const [zoomX, setZoomX] = useState(1);
  const [zoomY, setZoomY] = useState(1);

  // Playback position state (0 to 1)
  const [playheadPos, setPlayheadPos] = useState(0);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  
  // Refs to avoid stale closures in the animation loop
  const isPlayingRef = useRef(false);
  const playbackStartTimeRef = useRef<number>(0);
  const playbackStartOffsetRef = useRef<number>(0);
  const audioDurationRef = useRef<number>(0);

  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  const startRecording = async () => {
    const ctx = initAudio();
    if (ctx.state === 'suspended') await ctx.resume();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/wav' });
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        
        setStatus('Generating Spectrogram...');
        const res = computeSpectrogram(audioBuffer);
        setSpecData({
          data: res.spectrogram,
          times: res.times,
          frequencies: res.frequencies
        });
        
        setAudioState({
          buffer: audioBuffer,
          filteredBuffer: null,
          duration: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate
        });
        
        audioDurationRef.current = audioBuffer.duration;
        setStatus('Analysis complete. Drag to block time intervals.');
        stream.getTracks().forEach(t => t.stop());
      };

      setIsRecording(true);
      setAnnotations([]);
      setAudioState(null);
      setSpecData(null);
      setZoomX(1);
      setZoomY(1);
      setPlayheadPos(0);
      setClipName(`Capture ${new Date().toLocaleTimeString().replace(/:/g, '-')}`);
      mediaRecorder.start();
      
      const startTime = Date.now();
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startTime;
        setProgress(Math.min(100, (elapsed / RECORDING_DURATION) * 100));
        if (elapsed >= RECORDING_DURATION) {
          mediaRecorder.stop();
          setIsRecording(false);
          clearInterval(recordingTimerRef.current!);
        }
      }, 50);

    } catch (err) {
      console.error(err);
      setStatus('Microphone access denied or error occurred.');
    }
  };

  const handleTogglePlay = async (filter: boolean) => {
    const ctx = initAudio();
    if (isPlaying) {
      stopPlayback();
      return;
    }

    let bufferToPlay = filter ? audioState?.filteredBuffer : audioState?.buffer;

    if (filter && !audioState?.filteredBuffer && audioState?.buffer) {
      setStatus('Reconstructing audio with mask...');
      const filtered = await applyMaskAndReconstruct(ctx, audioState.buffer, annotations);
      setAudioState(prev => prev ? { ...prev, filteredBuffer: filtered } : null);
      bufferToPlay = filtered;
      setStatus('Audio reconstructed.');
    }

    if (!bufferToPlay || !audioState) return;

    const offset = playheadPos >= 0.995 ? 0 : playheadPos * audioState.duration;
    if (offset === 0) setPlayheadPos(0);
    
    const source = ctx.createBufferSource();
    source.buffer = bufferToPlay;
    source.connect(ctx.destination);
    source.onended = () => {
      if (sourceNodeRef.current === source) {
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
    };

    playbackStartTimeRef.current = ctx.currentTime;
    playbackStartOffsetRef.current = offset;
    
    source.start(0, offset);
    sourceNodeRef.current = source;
    setIsPlaying(true);
    isPlayingRef.current = true;
    setIsFiltered(filter);
    setStatus(`Playing ${filter ? 'filtered' : 'original'} audio...`);
  };

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
  };

  const updateAnnotationLabel = (id: string, label: string) => {
    setAnnotations(prev => prev.map(ann => ann.id === id ? { ...ann, label } : ann));
  };

  const handleSaveData = () => {
    if (!audioState?.buffer) return;

    const baseName = clipName.trim() || 'untitled-recording';
    
    // 1. Save WAV
    const wavBlob = audioBufferToWav(audioState.buffer);
    const wavUrl = URL.createObjectURL(wavBlob);
    const wavLink = document.createElement('a');
    wavLink.href = wavUrl;
    wavLink.download = `${baseName}.wav`;
    wavLink.click();
    URL.revokeObjectURL(wavUrl);

    // 2. Save JSON
    const jsonData = {
      name: clipName,
      sample_rate: audioState.sampleRate,
      length: audioState.duration,
      features: annotations.map(ann => ({
        start: ann.x * audioState.duration,
        duration: ann.width * audioState.duration,
        label: (ann.label || '')
          .split(',')
          .map(l => l.trim())
          .filter(l => l.length > 0)
      }))
    };
    
    const jsonBlob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonLink = document.createElement('a');
    jsonLink.href = jsonUrl;
    jsonLink.download = `${baseName}.json`;
    jsonLink.click();
    URL.revokeObjectURL(jsonUrl);
    
    setStatus('Research data saved to downloads.');
  };

  useEffect(() => {
    let frameId: number;
    const update = () => {
      if (isPlayingRef.current && audioCtxRef.current && audioDurationRef.current > 0) {
        const ctx = audioCtxRef.current;
        const elapsed = ctx.currentTime - playbackStartTimeRef.current;
        const currentTotalTime = playbackStartOffsetRef.current + elapsed;
        const progress = Math.min(1, currentTotalTime / audioDurationRef.current);
        setPlayheadPos(progress);
        
        if (progress < 1) {
          frameId = requestAnimationFrame(update);
        } else {
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
      }
    };

    if (isPlaying) {
      frameId = requestAnimationFrame(update);
    }
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying]);

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (isDrawingMode || isRecording || !specData) return;
    setIsDraggingPlayhead(true);
    handleScrub(e);
  };

  const handleScrub = (e: React.MouseEvent | MouseEvent) => {
    const container = document.getElementById('spectrogram-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const xInViewport = e.clientX - rect.left;
    const xInContent = xInViewport + container.scrollLeft;
    const totalWidth = container.scrollWidth;
    const pos = Math.max(0, Math.min(1, xInContent / totalWidth));
    setPlayheadPos(pos);

    if (isPlayingRef.current) {
      stopPlayback();
    }
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingPlayhead) {
      handleScrub(e);
    }
  }, [isDraggingPlayhead, specData]);

  const handleGlobalMouseUp = useCallback(() => {
    setIsDraggingPlayhead(false);
  }, []);

  useEffect(() => {
    if (isDraggingPlayhead) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    } else {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDraggingPlayhead, handleGlobalMouseMove, handleGlobalMouseUp]);

  useEffect(() => {
    if (audioState?.buffer) {
       setAudioState(prev => prev ? { ...prev, filteredBuffer: null } : null);
    }
  }, [annotations]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-600 mb-2">
          Sonic Artifact Explorer
        </h1>
        <p className="text-slate-400">Isolate Clicks and Transients via Temporal Masking</p>
      </header>

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              {!isRecording ? (
                <Button onClick={startRecording} variant="primary" className="flex items-center gap-2 shadow-lg shadow-blue-500/20">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  Capture 8s Clip
                </Button>
              ) : (
                <div className="flex items-center gap-4 bg-slate-900 px-4 py-2 rounded-lg border border-red-500/30">
                  <span className="text-red-400 font-mono text-sm">Recording... {Math.round(progress)}%</span>
                  <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-red-500 transition-all duration-75"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 max-w-xs">
              <input 
                type="text"
                value={clipName}
                onChange={(e) => setClipName(e.target.value)}
                placeholder="Clip Name..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                disabled={isRecording}
              />
            </div>

            <div className="flex items-center gap-2 bg-slate-900/50 p-1 rounded-lg border border-slate-700">
               <Button 
                onClick={() => handleTogglePlay(false)} 
                variant="secondary"
                disabled={!audioState || isRecording}
                className="text-sm px-4 min-w-[140px]"
              >
                {isPlaying && !isFiltered ? '⏸ Stop' : '▶ Play Original'}
              </Button>
              <Button 
                onClick={() => handleTogglePlay(true)} 
                variant="primary"
                disabled={!audioState || isRecording || annotations.length === 0}
                className="text-sm px-4 min-w-[140px]"
              >
                {isPlaying && isFiltered ? '⏸ Stop' : '▶ Play Filtered'}
              </Button>
              <Button 
                onClick={handleSaveData}
                variant="secondary"
                disabled={!audioState || isRecording}
                className="text-sm px-4 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30"
                title="Download Research Data"
              >
                💾 Save
              </Button>
            </div>

            <div className="flex items-center gap-4">
               <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                  <span className="text-[10px] uppercase font-bold text-slate-500 px-2">Time</span>
                  <Button onClick={() => setZoomX(prev => Math.max(1, prev - 1))} variant="ghost" className="p-1 px-3 h-8" disabled={zoomX <= 1}>-</Button>
                  <span className="w-8 text-center text-xs font-mono">{zoomX}x</span>
                  <Button onClick={() => setZoomX(prev => Math.min(10, prev + 1))} variant="ghost" className="p-1 px-3 h-8" disabled={zoomX >= 10}>+</Button>
               </div>
               <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-700">
                  <span className="text-[10px] uppercase font-bold text-slate-500 px-2">Freq</span>
                  <Button onClick={() => setZoomY(prev => Math.max(1, prev - 1))} variant="ghost" className="p-1 px-3 h-8" disabled={zoomY <= 1}>-</Button>
                  <span className="w-8 text-center text-xs font-mono">{zoomY}x</span>
                  <Button onClick={() => setZoomY(prev => Math.min(10, prev + 1))} variant="ghost" className="p-1 px-3 h-8" disabled={zoomY >= 10}>+</Button>
               </div>
               <Button onClick={() => { setZoomX(1); setZoomY(1); }} variant="ghost" className="text-xs text-slate-400" disabled={zoomX === 1 && zoomY === 1}>Reset View</Button>
            </div>

            <Button onClick={() => setIsDrawingMode(!isDrawingMode)} variant={isDrawingMode ? 'primary' : 'secondary'} disabled={!specData} className="text-sm min-w-[120px]">
              {isDrawingMode ? '✏️ Annotate Time' : '🖐️ Pan / Scrub'}
            </Button>
          </div>
          
          <div className="text-sm font-mono text-slate-500 italic border-t border-slate-700 pt-4 flex justify-between">
            <span>{status}</span>
            {audioState && (
              <span className="text-slate-400">
                Position: {(playheadPos * audioState.duration).toFixed(2)}s / {audioState.duration.toFixed(2)}s
              </span>
            )}
          </div>
        </div>

        <div className="relative bg-slate-950 rounded-xl border border-slate-700 shadow-2xl overflow-hidden flex h-[500px]">
          <div className="flex-none w-12 flex flex-col justify-between py-4 text-[10px] font-mono text-slate-500 bg-slate-950/80 z-40 border-r border-slate-800 pointer-events-none">
            <span>20k</span>
            <span>15k</span>
            <span>10k</span>
            <span>5k</span>
            <span>1k</span>
            <span>0</span>
          </div>

          <div id="spectrogram-container" className="flex-grow overflow-auto relative custom-scrollbar" onMouseDown={handleContainerMouseDown}>
            {specData ? (
              <div className="relative" style={{ width: `${100 * zoomX}%`, height: `${100 * zoomY}%`, minHeight: '100%' }}>
                <Spectrogram data={specData.data} zoomX={zoomX} zoomY={zoomY} />
                <AnnotationLayer 
                  annotations={annotations}
                  onAdd={(ann) => setAnnotations([...annotations, ann])}
                  onRemove={(id) => setAnnotations(annotations.filter(a => a.id !== id))}
                  isDrawing={isDrawingMode}
                />
                <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: `${playheadPos * 100}%` }}>
                   <div className="w-[2px] h-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.8)] relative">
                      {!isDrawingMode && (
                        <div className="absolute -top-1 -left-[9px] w-5 h-5 bg-yellow-400 rounded-full border-2 border-slate-950 shadow-lg flex items-center justify-center animate-pulse">
                          <div className="w-1 h-2 bg-slate-900 rounded-full" />
                        </div>
                      )}
                   </div>
                </div>
                <div className="absolute inset-0 pointer-events-none bg-yellow-400/5 z-20" style={{ width: `${playheadPos * 100}%` }} />
                <div className="absolute bottom-0 left-0 right-0 h-6 border-t border-slate-800/50 bg-slate-950/80 flex justify-between px-2 text-[10px] font-mono text-slate-500 pointer-events-none z-30">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(s => (
                    <span key={s} style={{ position: 'absolute', left: `${(s/8)*100}%` }}>{s}s</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-600">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <p>Awaiting audio input...</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
            <h3 className="text-lg font-semibold text-cyan-400 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Temporal Masking
            </h3>
            <p className="text-slate-400 text-sm mb-4">
              Annotated segments will be silent when playing the "Filtered" version. Use labels to document specific artifacts like "Mouse Click" or "Breathing".
            </p>
            <div className="grid grid-cols-2 gap-4">
               <div className="bg-slate-900 p-3 rounded border border-slate-700">
                  <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Time Blocking</div>
                  <div className="text-xs text-slate-400">Silences the entire frequency range for the duration.</div>
               </div>
               <div className="bg-slate-900 p-3 rounded border border-slate-700">
                  <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Export Research</div>
                  <div className="text-xs text-slate-400">Save your work as standardized WAV and JSON files.</div>
               </div>
            </div>
          </div>

          <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 flex flex-col">
            <h3 className="text-lg font-semibold text-purple-400 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                Annotations
              </div>
              <span className="text-xs bg-purple-500/20 px-2 py-0.5 rounded-full text-purple-300">{annotations.length}</span>
            </h3>
            {annotations.length === 0 ? (
              <div className="flex-grow flex items-center justify-center border border-dashed border-slate-700 rounded-lg p-8">
                <p className="text-slate-500 text-sm italic">No time ranges marked.</p>
              </div>
            ) : (
              <div className="flex-grow max-h-64 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {annotations.map((ann, i) => (
                  <div key={ann.id} className="flex flex-col gap-2 bg-slate-900/50 p-3 rounded border border-slate-700">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-500 font-mono">
                        #{i + 1} | Time: {(ann.x * 8).toFixed(3)}s — {((ann.x + ann.width) * 8).toFixed(3)}s
                      </span>
                      <button onClick={() => setAnnotations(annotations.filter(a => a.id !== ann.id))} className="text-red-400 hover:text-red-300 px-2 font-bold">Remove</button>
                    </div>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        placeholder="Assign labels (comma separated: click, pop)"
                        value={ann.label || ''}
                        onChange={(e) => updateAnnotationLabel(ann.id, e.target.value)}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <footer className="mt-12 text-center text-slate-600 text-[10px] border-t border-slate-800 pt-8 uppercase tracking-widest">
        Advanced STFT Visualization & Temporal Masking System
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}</style>
    </div>
  );
};

export default App;
