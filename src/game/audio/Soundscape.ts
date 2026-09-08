/** Internally generated audio; no downloads, media permissions or assets. */
export type SoundCue = "step" | "jump" | "land" | "dash" | "strike" | "bolt" | "pulse" | "pickup" | "success" | "failure" | "water";

interface CueSpec {
  index: number;
  cooldown: number;
  duration: number;
  gain: number;
  frequency: number;
  endFrequency: number;
  noise: boolean;
  waveform: OscillatorType;
}

const CUES: Record<SoundCue, CueSpec> = {
  step: { index: 0, cooldown: 0.075, duration: 0.075, gain: 0.11, frequency: 680, endFrequency: 150, noise: true, waveform: "sine" },
  jump: { index: 1, cooldown: 0.1, duration: 0.2, gain: 0.07, frequency: 180, endFrequency: 530, noise: true, waveform: "sine" },
  land: { index: 2, cooldown: 0.1, duration: 0.2, gain: 0.16, frequency: 150, endFrequency: 55, noise: true, waveform: "sine" },
  dash: { index: 3, cooldown: 0.13, duration: 0.38, gain: 0.15, frequency: 2600, endFrequency: 210, noise: true, waveform: "sine" },
  strike: { index: 4, cooldown: 0.09, duration: 0.17, gain: 0.18, frequency: 860, endFrequency: 90, noise: true, waveform: "sine" },
  bolt: { index: 5, cooldown: 0.1, duration: 0.26, gain: 0.075, frequency: 1050, endFrequency: 100, noise: false, waveform: "triangle" },
  pulse: { index: 6, cooldown: 0.25, duration: 0.75, gain: 0.11, frequency: 190, endFrequency: 32, noise: false, waveform: "sine" },
  pickup: { index: 7, cooldown: 0.1, duration: 0.3, gain: 0.065, frequency: 620, endFrequency: 1240, noise: false, waveform: "sine" },
  success: { index: 8, cooldown: 0.4, duration: 0.7, gain: 0.08, frequency: 392, endFrequency: 784, noise: false, waveform: "triangle" },
  failure: { index: 9, cooldown: 0.4, duration: 0.6, gain: 0.07, frequency: 220, endFrequency: 82, noise: false, waveform: "triangle" },
  water: { index: 10, cooldown: 0.18, duration: 0.3, gain: 0.06, frequency: 1800, endFrequency: 680, noise: true, waveform: "sine" },
};

export const MAX_SOUND_VOICES = 12;

/** Exported so limits stay testable without audio hardware. */
export function soundMix(speedRatio: number, focus: boolean, nightAmount: number): {
  wind: number; windHz: number; city: number; resonance: number;
} {
  const speed = Number.isFinite(speedRatio) ? Math.max(0, Math.min(1.3, speedRatio)) : 0;
  const night = Number.isFinite(nightAmount) ? Math.max(0, Math.min(1, nightAmount)) : 0;
  return {
    wind: speed * speed * (focus ? 0.042 : 0.073),
    windHz: 240 + speed * 2450,
    city: (0.026 - night * 0.009) * (focus ? 0.24 : 1),
    resonance: focus ? 0.042 : 0.003 + speed * 0.009,
  };
}

interface Voice {
  source: AudioScheduledSourceNode;
  envelope: GainNode;
  filter: BiquadFilterNode | null;
}

/**
 * A lazy Web Audio graph: four persistent beds and at most twelve short
 * voices. Call unlock() directly in a pointer/key gesture. Browsers that
 * deny audio keep the game playable and can be retried on the next gesture.
 */
export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private city: GainNode | null = null;
  private resonance: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly voices = new Set<Voice>();
  private readonly beds: AudioScheduledSourceNode[] = [];
  private readonly lastCue = new Float64Array(Object.keys(CUES).length).fill(-100);
  private volume = 0.7;
  private paused = true;
  private disposed = false;
  private clock = 0;
  private updateClock = 0;
  private resumeTask: Promise<void> | null = null;

  get activeVoices(): number { return this.voices.size; }

  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        const browser = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
        const Context = browser.AudioContext ?? browser.webkitAudioContext;
        if (!Context) return;
        this.context = new Context({ latencyHint: "interactive" });
        this.buildGraph(this.context);
      }
      if (this.context.state === "suspended" && !this.resumeTask) {
        this.resumeTask = this.context.resume().finally(() => { this.resumeTask = null; });
      }
      await this.resumeTask;
      this.updateMaster();
    } catch {
      // Audio availability must never fail boot or an input event.
    }
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    this.updateMaster();
  }

  /** Menus/blur silence every bus and discard transients, including queued cues. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.stopVoices();
    this.updateMaster();
  }

  update(dt: number, speedRatio: number, focus: boolean, nightAmount = 0): void {
    if (this.paused || !this.context || this.context.state !== "running" || !Number.isFinite(dt)) return;
    const step = Math.max(0, Math.min(0.1, dt));
    this.clock += step;
    this.updateClock += step;
    if (this.updateClock < 1 / 30) return;
    this.updateClock = 0;
    const speed = Number.isFinite(speedRatio) ? Math.max(0, Math.min(1.3, speedRatio)) : 0;
    const night = Number.isFinite(nightAmount) ? Math.max(0, Math.min(1, nightAmount)) : 0;
    const now = this.context.currentTime;
    // Inline the mixer to keep frame updates allocation-free.
    this.wind!.gain.setTargetAtTime(speed * speed * (focus ? 0.042 : 0.073), now, 0.12);
    this.windFilter!.frequency.setTargetAtTime(240 + speed * 2450, now, 0.12);
    this.city!.gain.setTargetAtTime((0.026 - night * 0.009) * (focus ? 0.24 : 1) * (0.9 + Math.sin(this.clock * 0.28) * 0.1), now, 0.3);
    this.resonance!.gain.setTargetAtTime(focus ? 0.042 : 0.003 + speed * 0.009, now, 0.08);
  }

  play(cue: SoundCue): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.paused || this.volume === 0 || this.disposed) return;
    const spec = CUES[cue];
    const now = context.currentTime;
    if (this.voices.size >= MAX_SOUND_VOICES || now - this.lastCue[spec.index]! < spec.cooldown) return;
    this.lastCue[spec.index] = now;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(spec.gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
    envelope.connect(this.master!);
    let source: AudioBufferSourceNode | OscillatorNode;
    let filter: BiquadFilterNode | null = null;
    if (spec.noise) {
      source = context.createBufferSource();
      source.buffer = this.noise;
      filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = cue === "dash" ? 0.55 : 0.85;
      filter.frequency.setValueAtTime(spec.frequency, now);
      filter.frequency.exponentialRampToValueAtTime(spec.endFrequency, now + spec.duration);
      source.connect(filter);
      filter.connect(envelope);
    } else {
      source = context.createOscillator();
      source.type = spec.waveform;
      source.frequency.setValueAtTime(spec.frequency, now);
      source.frequency.exponentialRampToValueAtTime(spec.endFrequency, now + spec.duration);
      source.connect(envelope);
    }
    const voice: Voice = { source, envelope, filter };
    this.voices.add(voice);
    source.onended = () => this.releaseVoice(voice);
    source.start(now);
    source.stop(now + spec.duration + 0.025);
  }

  dispose(): void {
    this.disposed = true;
    this.stopVoices();
    for (const bed of this.beds) {
      try { bed.stop(); } catch { /* A closed context has already stopped it. */ }
      bed.disconnect();
    }
    this.beds.length = 0;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }

  private updateMaster(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.paused ? 0 : this.volume * 0.65, now, 0.035);
  }

  private releaseVoice(voice: Voice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.filter?.disconnect();
    voice.envelope.disconnect();
    this.voices.delete(voice);
  }

  private stopVoices(): void {
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch { /* Already ended. */ }
      this.releaseVoice(voice);
    }
  }

  private buildGraph(context: AudioContext): void {
    const master = context.createGain();
    master.gain.value = 0;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    master.connect(limiter);
    limiter.connect(context.destination);
    this.master = master;

    const noise = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const channel = noise.getChannelData(0);
    let seed = 0x8e340;
    for (let i = 0; i < channel.length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      channel[i] = seed / 0x80000000 - 1;
    }
    this.noise = noise;
    this.wind = context.createGain();
    this.wind.gain.value = 0;
    this.windFilter = context.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 240;
    this.windFilter.Q.value = 0.55;
    this.noiseBed(context, noise, this.windFilter, this.wind);

    this.city = context.createGain();
    this.city.gain.value = 0;
    const cityFilter = context.createBiquadFilter();
    cityFilter.type = "lowpass";
    cityFilter.frequency.value = 330;
    this.noiseBed(context, noise, cityFilter, this.city);

    this.resonance = context.createGain();
    this.resonance.gain.value = 0;
    this.resonance.connect(master);
    for (const frequency of [65.4, 98.1]) {
      const tone = context.createOscillator();
      tone.type = "sine";
      tone.frequency.value = frequency;
      tone.connect(this.resonance);
      tone.start();
      this.beds.push(tone);
    }
  }

  private noiseBed(context: AudioContext, buffer: AudioBuffer, filter: BiquadFilterNode, gain: GainNode): void {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    source.start(0, this.beds.length * 0.83);
    this.beds.push(source);
  }
}
