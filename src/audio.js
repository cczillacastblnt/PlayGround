import { clamp } from "./utils.js";

/**
 * Lightweight synthesized audio. No external assets, everything is generated
 * with WebAudio so the game remains a single self-contained bundle.
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.started = false;
    this.lastShot = 0;
    this.lastUi = 0;
    this.ambientNodes = [];
    this.pulseClock = 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.62;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.72;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.33;
    this.musicBus.connect(this.master);

    this.noiseBuffer = this._makeNoise(1.4);
    this._startAmbient();
    this.started = true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.62, this.ctx.currentTime + 0.15);
    }
  }

  _makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.62 + white * 0.38;
      data[i] = last;
    }
    return buffer;
  }

  _startAmbient() {
    const ctx = this.ctx;
    const bus = this.musicBus;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 210;
    filter.Q.value = 3.5;
    filter.connect(bus);

    const freqs = [43.65, 65.4, 87.3, 130.8];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? "sawtooth" : "sine";
      osc.frequency.value = f;
      osc.detune.value = (i - 1.5) * 7;
      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 0.09 : 0.025;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.035 + i * 0.011;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = i === 0 ? 3.2 : 1.1;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      lfo.start();
      this.ambientNodes.push(osc, lfo);
    });

    // Distant wind / static layer.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 420;
    nf.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.025;
    const nlfo = ctx.createOscillator();
    nlfo.frequency.value = 0.07;
    const nlg = ctx.createGain();
    nlg.gain.value = 0.012;
    nlfo.connect(nlg);
    nlg.connect(ng.gain);
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(bus);
    noise.start();
    nlfo.start();
    this.ambientNodes.push(noise, nlfo);
  }

  update(dt) {
    if (!this.ctx || this.muted) return;
    this.pulseClock += dt;
    if (this.pulseClock > 4.6) {
      this.pulseClock = 0;
      this._ambientPulse();
    }
  }

  _ambientPulse() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(98, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.018, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 1);
  }

  _tone({ freq = 440, endFreq = null, dur = 0.12, type = "sine", gain = 0.05, delay = 0, bus = null }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(bus || this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise({ dur = 0.3, gain = 0.08, freq = 800, endFreq = 120, type = "lowpass", delay = 0, q = 0.7 }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  uiClick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastUi < 0.035) return;
    this.lastUi = now;
    this._tone({ freq: 760, endFreq: 980, dur: 0.045, type: "square", gain: 0.014 });
  }

  select() {
    this._tone({ freq: 520, endFreq: 660, dur: 0.07, type: "triangle", gain: 0.026 });
    this._tone({ freq: 1040, dur: 0.04, type: "sine", gain: 0.012, delay: 0.03 });
  }

  command() {
    this._tone({ freq: 380, endFreq: 610, dur: 0.09, type: "triangle", gain: 0.03 });
    this._tone({ freq: 610, endFreq: 820, dur: 0.08, type: "sine", gain: 0.02, delay: 0.045 });
  }

  error() {
    this._tone({ freq: 150, endFreq: 95, dur: 0.16, type: "sawtooth", gain: 0.028 });
    this._tone({ freq: 120, endFreq: 70, dur: 0.14, type: "square", gain: 0.015, delay: 0.05 });
  }

  buildStart() {
    this._tone({ freq: 240, endFreq: 420, dur: 0.22, type: "triangle", gain: 0.026 });
    this._noise({ dur: 0.19, gain: 0.022, freq: 1500, endFreq: 400, type: "bandpass", q: 1.8 });
  }

  structureComplete() {
    [330, 440, 660].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.18, type: "triangle", gain: 0.028, delay: i * 0.085 })
    );
  }

  trainStart() {
    this._tone({ freq: 180, endFreq: 330, dur: 0.26, type: "sawtooth", gain: 0.018 });
  }

  trainComplete() {
    this._tone({ freq: 440, endFreq: 680, dur: 0.12, type: "triangle", gain: 0.03 });
    this._tone({ freq: 680, endFreq: 880, dur: 0.13, type: "sine", gain: 0.02, delay: 0.08 });
  }

  attack(kind = "bullet") {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShot < 0.055) return;
    this.lastShot = now;
    if (kind === "shell") {
      this._tone({ freq: 90, endFreq: 42, dur: 0.22, type: "square", gain: 0.04 });
      this._noise({ dur: 0.24, gain: 0.05, freq: 560, endFreq: 70, q: 0.8 });
    } else if (kind === "plasma") {
      this._tone({ freq: 880, endFreq: 220, dur: 0.15, type: "sawtooth", gain: 0.022 });
    } else if (kind === "turret") {
      this._tone({ freq: 420, endFreq: 190, dur: 0.11, type: "square", gain: 0.018 });
    } else {
      this._noise({ dur: 0.07, gain: 0.026, freq: 2400, endFreq: 700, type: "highpass", q: 0.8 });
      this._tone({ freq: 170, endFreq: 90, dur: 0.05, type: "square", gain: 0.012 });
    }
  }

  impact() {
    this._noise({ dur: 0.12, gain: 0.018, freq: 1300, endFreq: 250, q: 1.5 });
  }

  explosion(big = false) {
    this._noise({ dur: big ? 0.85 : 0.36, gain: big ? 0.16 : 0.06, freq: big ? 480 : 900, endFreq: 45, q: 0.6 });
    this._tone({ freq: big ? 54 : 82, endFreq: 28, dur: big ? 0.7 : 0.28, type: "sine", gain: big ? 0.12 : 0.04 });
    if (big) this._noise({ dur: 0.5, gain: 0.05, freq: 240, endFreq: 40, q: 0.4, delay: 0.18 });
  }

  gather() {
    this._tone({ freq: 520, endFreq: 880, dur: 0.06, type: "sine", gain: 0.008 });
  }

  deposit() {
    this._tone({ freq: 660, endFreq: 990, dur: 0.1, type: "triangle", gain: 0.022 });
  }

  alert() {
    this._tone({ freq: 320, dur: 0.18, type: "square", gain: 0.018 });
    this._tone({ freq: 420, dur: 0.18, type: "square", gain: 0.018, delay: 0.21 });
    this._tone({ freq: 520, dur: 0.2, type: "square", gain: 0.018, delay: 0.42 });
  }

  victory() {
    [220, 330, 440, 554, 660].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.7, type: "triangle", gain: 0.032, delay: i * 0.17 })
    );
  }

  defeat() {
    [220, 185, 146, 110].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.9, type: "sawtooth", gain: 0.02, delay: i * 0.23 })
    );
    this._noise({ dur: 1.6, gain: 0.03, freq: 320, endFreq: 40, delay: 0.3 });
  }

  setLowpassForPause(paused) {
    if (!this.master || !this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    const target = this.muted ? 0 : paused ? 0.22 : 0.62;
    this.master.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.2);
  }

  clampVolume(v) {
    if (this.master) this.master.gain.value = clamp(v, 0, 1);
  }
}
