
export interface Annotation {
  id: string;
  x: number; // percentage 0-1 (start time)
  width: number; // percentage 0-1 (duration)
  label?: string;
}

export interface SpectrogramData {
  data: number[][]; // [time][frequency]
  times: number[];
  frequencies: number[];
}

export interface AudioState {
  buffer: AudioBuffer | null;
  filteredBuffer: AudioBuffer | null;
  duration: number;
  sampleRate: number;
}
