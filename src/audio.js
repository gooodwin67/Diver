export class DiveAudio {
  constructor() { this.enabled = false; this.context = null; }
  unlock() {
    if (!this.enabled) return;
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = .24;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  toggle() { this.enabled = !this.enabled; if (this.enabled) this.unlock(); return this.enabled; }
  tone(frequency,duration,volume = .2,delay = 0) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime + delay;
    const osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(frequency,now); osc.frequency.exponentialRampToValueAtTime(frequency * .7,now + duration);
    gain.gain.setValueAtTime(0,now); gain.gain.linearRampToValueAtTime(volume,now + .012); gain.gain.exponentialRampToValueAtTime(.0001,now + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(now); osc.stop(now + duration + .02);
  }
  jump() { this.tone(190,.24,.12); }
  splash(quality) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context, duration = .6 + (1 - quality) * .6;
    const buffer = ctx.createBuffer(1,ctx.sampleRate * duration,ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 5);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1300 + quality * 700;
    source.connect(filter); filter.connect(this.master); source.start();
    this.tone(180,.4,.14,.1);
  }
  success() { this.tone(392,.45,.18); this.tone(494,.5,.14,.15); this.tone(587,.7,.14,.3); }
}
