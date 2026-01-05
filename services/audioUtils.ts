
/**
 * Simple FFT implementation
 */
export class FFT {
  private n: number;
  private m: number;
  private cos: Float32Array;
  private sin: Float32Array;

  constructor(n: number) {
    this.n = n;
    this.m = Math.log2(n);
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  forward(real: Float32Array, imag: Float32Array) {
    let j = 0;
    for (let i = 0; i < this.n - 1; i++) {
      if (i < j) {
        const tr = real[i];
        const ti = imag[i];
        real[i] = real[j];
        imag[i] = imag[j];
        real[j] = tr;
        imag[j] = ti;
      }
      let k = this.n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    for (let s = 1; s <= this.m; s++) {
      const m = 1 << s;
      const m2 = m >> 1;
      for (let j = 0; j < m2; j++) {
        const wr = this.cos[j * (this.n / m)];
        const wi = -this.sin[j * (this.n / m)];
        for (let k = j; k < this.n; k += m) {
          const tr = wr * real[k + m2] - wi * imag[k + m2];
          const ti = wr * imag[k + m2] + wi * real[k + m2];
          real[k + m2] = real[k] - tr;
          imag[k + m2] = imag[k] - ti;
          real[k] += tr;
          imag[k] += ti;
        }
      }
    }
  }

  inverse(real: Float32Array, imag: Float32Array) {
    for (let i = 0; i < this.n; i++) imag[i] = -imag[i];
    this.forward(real, imag);
    for (let i = 0; i < this.n; i++) {
      real[i] /= this.n;
      imag[i] /= -this.n;
    }
  }
}

export const hanningWindow = (n: number) => {
  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return window;
};

export const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
export const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);

export const computeSpectrogram = (
  audioBuffer: AudioBuffer,
  windowSize = 2048,
  hopSize = 512,
  melBinsCount = 128
) => {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const fft = new FFT(windowSize);
  const window = hanningWindow(windowSize);
  
  const numFrames = Math.floor((data.length - windowSize) / hopSize);
  const spectrogram: number[][] = [];
  
  const minHz = 0;
  const maxHz = sampleRate / 2;
  const minMel = hzToMel(minHz);
  const maxMel = hzToMel(maxHz);
  
  const melPoints = new Float32Array(melBinsCount + 2);
  for (let i = 0; i < melBinsCount + 2; i++) {
    melPoints[i] = melToHz(minMel + (i * (maxMel - minMel)) / (melBinsCount + 1));
  }
  
  const binPoints = melPoints.map(hz => Math.floor(((windowSize + 1) * hz) / sampleRate));
  const filterbank = Array.from({ length: melBinsCount }, (_, i) => {
    const filter = new Float32Array(windowSize / 2 + 1);
    for (let j = binPoints[i]; j < binPoints[i+1]; j++) {
        filter[j] = (j - binPoints[i]) / (binPoints[i+1] - binPoints[i]);
    }
    for (let j = binPoints[i+1]; j < binPoints[i+2]; j++) {
        filter[j] = (binPoints[i+2] - j) / (binPoints[i+2] - binPoints[i+1]);
    }
    return filter;
  });

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    const real = new Float32Array(windowSize);
    const imag = new Float32Array(windowSize);
    
    for (let i = 0; i < windowSize; i++) {
      real[i] = data[start + i] * window[i];
    }
    
    fft.forward(real, imag);
    
    const magnitudes = new Float32Array(windowSize / 2 + 1);
    for (let i = 0; i <= windowSize / 2; i++) {
      magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    
    const melFrame = filterbank.map(filter => {
      let sum = 0;
      for (let i = 0; i < magnitudes.length; i++) {
        sum += magnitudes[i] * filter[i];
      }
      return 20 * Math.log10(Math.max(1e-10, sum));
    });
    
    spectrogram.push(melFrame);
  }
  
  return {
    spectrogram,
    frequencies: Array.from(melPoints.slice(1, melBinsCount + 1)),
    times: Array.from({ length: numFrames }, (_, i) => (i * hopSize) / sampleRate)
  };
};

export const applyMaskAndReconstruct = async (
  ctx: AudioContext,
  originalBuffer: AudioBuffer,
  annotations: any[],
  windowSize = 2048,
  hopSize = 512
) => {
  const data = originalBuffer.getChannelData(0);
  const sampleRate = originalBuffer.sampleRate;
  const fft = new FFT(windowSize);
  const window = hanningWindow(windowSize);
  
  const numFrames = Math.floor((data.length - windowSize) / hopSize);
  const reconstructed = new Float32Array(originalBuffer.length);
  const norm = new Float32Array(originalBuffer.length);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    const frameReal = new Float32Array(windowSize);
    const frameImag = new Float32Array(windowSize);
    
    for (let i = 0; i < windowSize; i++) {
      frameReal[i] = data[start + i] * window[i];
    }
    
    fft.forward(frameReal, frameImag);
    
    const timePos = f / numFrames;

    // Apply Mask based on Time Interval
    let isTimeMasked = false;
    for (const ann of annotations) {
      if (timePos >= ann.x && timePos <= ann.x + ann.width) {
        isTimeMasked = true;
        break;
      }
    }

    if (isTimeMasked) {
      // Zero out the entire frame
      frameReal.fill(0);
      frameImag.fill(0);
    }
    
    fft.inverse(frameReal, frameImag);
    
    for (let i = 0; i < windowSize; i++) {
      reconstructed[start + i] += frameReal[i] * window[i];
      norm[start + i] += window[i] * window[i];
    }
  }

  for (let i = 0; i < reconstructed.length; i++) {
    if (norm[i] > 1e-10) reconstructed[i] /= norm[i];
  }

  const newBuffer = ctx.createBuffer(1, reconstructed.length, sampleRate);
  newBuffer.copyToChannel(reconstructed, 0);
  return newBuffer;
};
