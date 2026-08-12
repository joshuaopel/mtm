/**
 * Engine and impact audio, synthesised at runtime.
 *
 * No sample assets: a couple of detuned oscillators through a low-pass
 * filter tracks engine load convincingly enough, and it keeps the download
 * to nothing. Browsers refuse to start audio before a user gesture, so
 * everything here tolerates being called before `unlock()` succeeds.
 */
export class EngineAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  private oscillators: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;

  private running = false;
  private muted = false;

  /** Call from a user gesture (a keypress or click) to start audio. */
  async unlock(): Promise<void> {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.32;
    this.master.connect(this.context.destination);

    if (this.context.state === 'suspended') await this.context.resume();
  }

  private ensureEngine(): void {
    if (this.running || !this.context || !this.master) return;

    const ctx = this.context;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 3.5;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.filter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    // Three detuned saws an octave apart give a big lumpy V8 rather than a
    // clean tone; the slight detune is what stops it sounding like a synth.
    for (const [type, ratio, detune] of [
      ['sawtooth', 1, -8],
      ['sawtooth', 0.5, 6],
      ['square', 2, 12],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 60 * ratio;
      osc.detune.value = detune;

      const gain = ctx.createGain();
      gain.gain.value = ratio === 1 ? 0.6 : ratio === 0.5 ? 0.35 : 0.12;
      osc.connect(gain);
      gain.connect(this.filter);
      osc.start();
      this.oscillators.push(osc);
    }

    // Tyre/wind noise bed, driven separately from engine load.
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1400;

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;

    noise.connect(noiseFilter);
    noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    noise.start();

    this.running = true;
  }

  /**
   * @param rpm       0..1 engine speed
   * @param load      0..1 throttle
   * @param speed     0..1 road speed, for the noise bed
   * @param airborne  cuts the tyre noise when the wheels leave the ground
   */
  update(rpm: number, load: number, speed: number, airborne: boolean): void {
    if (!this.context) return;
    this.ensureEngine();
    if (!this.engineGain || !this.filter || !this.noiseGain) return;

    const now = this.context.currentTime;
    const base = 42 + rpm * 118;

    for (let i = 0; i < this.oscillators.length; i++) {
      const ratio = i === 0 ? 1 : i === 1 ? 0.5 : 2;
      // setTargetAtTime glides instead of stepping, which avoids the clicks
      // you get from assigning frequency directly every frame.
      this.oscillators[i].frequency.setTargetAtTime(base * ratio, now, 0.03);
    }

    this.filter.frequency.setTargetAtTime(500 + rpm * 2600 + load * 900, now, 0.05);
    this.engineGain.gain.setTargetAtTime(0.16 + load * 0.24, now, 0.06);
    this.noiseGain.gain.setTargetAtTime(airborne ? 0.01 : speed * 0.07, now, 0.08);
  }

  /** Percussive thump for landings and collisions. */
  thump(strength: number): void {
    if (!this.context || !this.master) return;
    const ctx = this.context;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.22);

    const gain = ctx.createGain();
    const peak = Math.min(0.6, strength * 0.5);
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  /** Silence the engine without tearing down the graph. */
  idle(): void {
    if (!this.context || !this.engineGain || !this.noiseGain) return;
    const now = this.context.currentTime;
    this.engineGain.gain.setTargetAtTime(0, now, 0.1);
    this.noiseGain.gain.setTargetAtTime(0, now, 0.1);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.32, this.context.currentTime, 0.05);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }
}
