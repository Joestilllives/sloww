export type SoundscapeMode = 'silence' | 'rain' | 'brown' | 'birds';

class WhisperSoundscapeEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeNodes: AudioNode[] = [];
  private birdTimer: number | null = null;
  private rainDropTimer: number | null = null;
  private currentMode: SoundscapeMode = 'silence';
  private volume = 0.12; // Whisper-quiet 12% default

  private unlocked = false;

  private unlockContext(ctx: AudioContext): void {
    if (this.unlocked) return;
    try {
      const silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
      const silentSource = ctx.createBufferSource();
      silentSource.buffer = silentBuffer;
      silentSource.connect(ctx.destination);
      silentSource.start(0);
      this.unlocked = true;
    } catch {
      // Ignore if context is not yet ready
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    const state = this.ctx.state as string;
    if (state === 'suspended' || state === 'interrupted') {
      void this.ctx.resume().catch(() => {
        // Browser may require another user tap if interrupted externally
      });
    }
    // Play a 1-sample silent buffer inside the tap gesture so iOS Safari unlocks Web Audio reliably
    this.unlockContext(this.ctx);
    return this.ctx;
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(nextVol: number): void {
    this.volume = Math.max(0, Math.min(1, nextVol));
    if (this.ctx && this.masterGain && this.currentMode !== 'silence') {
      if ((this.ctx.state as string) !== 'running') {
        void this.ctx.resume().catch(() => {});
      }
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.volume, now, 0.08);
    }
  }

  private clearActiveSource(): void {
    if (this.birdTimer !== null) {
      window.clearTimeout(this.birdTimer);
      this.birdTimer = null;
    }
    if (this.rainDropTimer !== null) {
      window.clearTimeout(this.rainDropTimer);
      this.rainDropTimer = null;
    }
    for (const node of this.activeNodes) {
      try {
        if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
          (node as AudioScheduledSourceNode).stop();
        }
        node.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    this.activeNodes = [];
  }

  public setMode(mode: SoundscapeMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;

    if (mode === 'silence') {
      if (this.ctx && this.masterGain) {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.45);
        window.setTimeout(() => {
          if (this.currentMode === 'silence') {
            this.clearActiveSource();
          }
        }, 480);
      } else {
        this.clearActiveSource();
      }
      return;
    }

    const ctx = this.ensureContext();
    this.clearActiveSource();

    const master = ctx.createGain();
    const now = ctx.currentTime;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(this.volume, now + 1.4);
    master.connect(ctx.destination);
    this.masterGain = master;
    this.activeNodes.push(master);

    if (mode === 'rain') {
      this.startFaintRain(ctx, master);
    } else if (mode === 'brown') {
      this.startBrownNoise(ctx, master);
    } else if (mode === 'birds') {
      this.startMorningBirds(ctx, master);
    }
  }

  private createPinkNoiseBuffer(ctx: AudioContext, seconds = 4): AudioBuffer {
    const length = ctx.sampleRate * seconds;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  private startFaintRain(ctx: AudioContext, master: GainNode): void {
    const buffer = this.createPinkNoiseBuffer(ctx, 5);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1050;
    bandpass.Q.value = 0.45;

    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2400;

    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.72;

    source.connect(bandpass);
    bandpass.connect(warmth);
    warmth.connect(bedGain);
    bedGain.connect(master);
    source.start();

    this.activeNodes.push(source, bandpass, warmth, bedGain);

    // Subtle soft raindrop taps on leaves
    const scheduleDrop = () => {
      if (this.currentMode !== 'rain' || !this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const dropGain = this.ctx.createGain();
      const freq = 520 + Math.random() * 780;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + 0.09);

      dropGain.gain.setValueAtTime(0.0001, now);
      dropGain.gain.linearRampToValueAtTime(0.045 * (0.5 + Math.random() * 0.5), now + 0.01);
      dropGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(dropGain);
      dropGain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.14);

      this.rainDropTimer = window.setTimeout(scheduleDrop, 260 + Math.random() * 900);
    };
    this.rainDropTimer = window.setTimeout(scheduleDrop, 350);
  }

  private startBrownNoise(ctx: AudioContext, master: GainNode): void {
    const length = ctx.sampleRate * 5;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 2.2;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 340;
    lowpass.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.value = 0.9;

    source.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(master);
    source.start();

    this.activeNodes.push(source, lowpass, gain);
  }

  private startMorningBirds(ctx: AudioContext, master: GainNode): void {
    // Very faint dawn breeze bed
    const breezeBuf = this.createPinkNoiseBuffer(ctx, 4);
    const breeze = ctx.createBufferSource();
    breeze.buffer = breezeBuf;
    breeze.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 460;

    const breezeGain = ctx.createGain();
    breezeGain.gain.value = 0.18;

    breeze.connect(filter);
    filter.connect(breezeGain);
    breezeGain.connect(master);
    breeze.start();
    this.activeNodes.push(breeze, filter, breezeGain);

    // Gentle distant birdsong phrases
    const playChirpPhrase = () => {
      if (this.currentMode !== 'birds' || !this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime;
      const noteCount = 2 + Math.floor(Math.random() * 2);
      const baseFreq = 1850 + Math.random() * 900;

      for (let i = 0; i < noteCount; i++) {
        const start = now + i * (0.14 + Math.random() * 0.08);
        const dur = 0.09 + Math.random() * 0.07;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();

        osc.type = 'sine';
        const f0 = baseFreq + i * (180 + Math.random() * 240);
        osc.frequency.setValueAtTime(f0, start);
        osc.frequency.exponentialRampToValueAtTime(f0 * (Math.random() > 0.4 ? 1.16 : 0.88), start + dur);

        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(0.11, start + dur * 0.25);
        env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

        if (this.ctx.createStereoPanner) {
          const panner = this.ctx.createStereoPanner();
          panner.pan.value = (Math.random() - 0.5) * 0.7;
          osc.connect(env);
          env.connect(panner);
          panner.connect(this.masterGain);
        } else {
          osc.connect(env);
          env.connect(this.masterGain);
        }

        osc.start(start);
        osc.stop(start + dur + 0.02);
      }

      this.birdTimer = window.setTimeout(playChirpPhrase, 1800 + Math.random() * 3400);
    };

    this.birdTimer = window.setTimeout(playChirpPhrase, 450);
  }

  public playBreathChime(phase: 'inhale' | 'hold' | 'exhale'): void {
    if (typeof window === 'undefined') return;
    try {
      const ctx = this.ensureContext();
      if ((ctx.state as string) !== 'running') {
        void ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const env = ctx.createGain();

      const baseFreq =
        phase === 'inhale' ? 396 : phase === 'hold' ? 432 : 330;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(baseFreq * 2, now);

      const overtoneGain = ctx.createGain();
      overtoneGain.gain.value = 0.14;

      const peak = Math.max(0.035, Math.min(0.11, this.volume * 0.55));
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(peak, now + 0.035);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

      osc.connect(env);
      overtone.connect(overtoneGain);
      overtoneGain.connect(env);
      env.connect(ctx.destination);

      osc.start(now);
      overtone.start(now);
      osc.stop(now + 0.9);
      overtone.stop(now + 0.9);
    } catch {
      // Non-blocking optional chime
    }
  }

  public stop(): void {
    this.currentMode = 'silence';
    this.clearActiveSource();
  }
}

export const soundscapeEngine = new WhisperSoundscapeEngine();
