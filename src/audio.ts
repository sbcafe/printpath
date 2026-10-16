// Tiny synthesized stepper hum (Web Audio). Created only on a user gesture.
export class Hum {
  private ctx?: AudioContext;
  private gain?: GainNode;
  private o1?: OscillatorNode;
  private o2?: OscillatorNode;
  private filter?: BiquadFilterNode;
  muted = false;
  private level = 0;

  /** Call from a click/tap handler. */
  start() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.gain = ctx.createGain(); this.gain.gain.value = 0;
      this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 700; this.filter.Q.value = 6;
      this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o1.frequency.value = 110;
      this.o2 = ctx.createOscillator(); this.o2.type = 'square'; this.o2.frequency.value = 221;
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      this.o1.connect(this.filter); this.o2.connect(g2).connect(this.filter);
      this.filter.connect(this.gain).connect(ctx.destination);
      this.o1.start(); this.o2.start();
    }
    void this.ctx.resume();
  }

  /** active: nozzle moving; pitch: 0..1 from move speed/direction. */
  set(active: boolean, pitch: number) {
    if (!this.ctx || !this.gain || !this.o1 || !this.o2 || !this.filter) return;
    const target = active && !this.muted ? 0.045 : 0;
    const t = this.ctx.currentTime;
    if (Math.abs(target - this.level) > 1e-4) { this.gain.gain.setTargetAtTime(target, t, 0.05); this.level = target; }
    const f = 90 + pitch * 140;
    this.o1.frequency.setTargetAtTime(f, t, 0.03);
    this.o2.frequency.setTargetAtTime(f * 2.01, t, 0.03);
    this.filter.frequency.setTargetAtTime(500 + pitch * 900, t, 0.05);
  }

  stop() { this.set(false, 0); }
}
