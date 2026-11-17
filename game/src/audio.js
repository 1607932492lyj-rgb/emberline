// Synthesised sound: no audio files, everything comes from one WebAudio graph.
// The context starts on the first user gesture, so a silent page load stays silent.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.4;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(dur, freq, gain, type = 'bandpass', when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    shot(kind) {
      if (kind === 'shotgun') noise(0.22, 900, 0.5, 'lowpass');
      else if (kind === 'dmr') noise(0.18, 1400, 0.45, 'bandpass');
      else if (kind === 'smg') noise(0.07, 2200, 0.3, 'bandpass');
      else noise(0.1, 1800, 0.35, 'bandpass');
      tone(180, 0.08, 0.25, 'square', 60);
    },
    distantShot() {
      noise(0.12, 700, 0.12, 'lowpass');
    },
    reload() {
      tone(1200, 0.03, 0.15, 'square');
      tone(900, 0.03, 0.15, 'square', 0, 0.18);
    },
    hit() {
      tone(2400, 0.05, 0.2, 'square');
    },
    kill() {
      tone(1800, 0.06, 0.22, 'square');
      tone(2600, 0.09, 0.22, 'square', 0, 0.07);
    },
    hurt() {
      noise(0.15, 300, 0.4, 'lowpass');
    },
    explosion() {
      noise(0.9, 400, 0.8, 'lowpass');
      tone(90, 0.7, 0.5, 'sine', 30);
    },
    beep() {
      tone(1400, 0.07, 0.18, 'square');
    },
    plantTick() {
      tone(1000, 0.05, 0.15, 'square');
    },
    buy() {
      tone(1200, 0.06, 0.18, 'sine');
      tone(1800, 0.08, 0.18, 'sine', 0, 0.06);
    },
    denied() {
      tone(300, 0.12, 0.2, 'square', 200);
    },
    roundWin() {
      tone(660, 0.12, 0.2, 'sine');
      tone(880, 0.12, 0.2, 'sine', 0, 0.12);
      tone(1320, 0.2, 0.2, 'sine', 0, 0.24);
    },
    roundLose() {
      tone(440, 0.14, 0.2, 'sine');
      tone(330, 0.14, 0.2, 'sine', 0, 0.14);
      tone(220, 0.26, 0.2, 'sine', 0, 0.28);
    },
  };
}
