// Focus Point sound engine: calm ambiences synthesized in real time with the Web Audio API.
// No audio files needed. Each layer is built from filtered noise and oscillators:
//   rain  – pink noise "hiss" + a low rumble + thousands of tiny randomized droplets
//   ocean – brown noise swelling in slow waves, with a bright "foam" wash on each crest
//   wind  – white noise through a drifting band-pass filter (the "whistle" wanders)
//   fire  – deep brown-noise roar + random crackles and pops
//   dream – slow evolving chord pads + distant bell sparkles, drowned in a long reverb
//   custom – your own audio files, looped / shuffled
(function () {
  const NOISE_SECONDS = 6;

  function makeNoise(ctx, color) {
    const len = ctx.sampleRate * NOISE_SECONDS;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (color === 'white') d[i] = w * 0.5;
        else if (color === 'pink') {
          // Paul Kellet's refined pink-noise filter
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;    b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;    b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else {
          // brown (red) noise: leaky integrated white noise
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
      // Cross-fade the loop seam so there is no click when the buffer repeats.
      const fade = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t;
      }
    }
    return buf;
  }

  function makeImpulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rand = (a, b) => a + Math.random() * (b - a);

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.layers = {};
      this.buffers = {};
      this.timers = [];
      this.loops = [];
      this.session = 0;
      this.mix = {};
      this.masterVolume = 0.7;
      this.customUrls = [];
      this.shuffle = true;
      this.running = false;
    }

    // ---- public API ---------------------------------------------------------

    async start({ master = 0.7, mix = {}, customUrls = [], shuffle = true, fadeIn = 3 } = {}) {
      if (this.running) await this.stop(0);
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;

      // Gentle glue compressor keeps layered sounds from getting harsh.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.4;
      this.master.connect(comp).connect(this.ctx.destination);

      this.customUrls = customUrls;
      this.shuffle = shuffle;
      this.running = true;
      this.masterVolume = master;
      this.setMix(mix, fadeIn);
      this.#ramp(this.master.gain, this.#curve(master), fadeIn);
    }

    async stop(fadeOut = 1.5) {
      if (!this.running) return;
      this.running = false;
      this.session += 1; // anything still scheduled for the old session stops itself
      const { ctx, master, layers, timers, loops } = this;
      this.layers = {};
      this.timers = [];
      this.loops = [];
      this.buffers = {};
      this.#ramp(master.gain, 0, fadeOut, ctx);
      layers.custom?.fadeTo(0, fadeOut);
      await new Promise((r) => setTimeout(r, fadeOut * 1000 + 60));
      timers.forEach(clearInterval);
      loops.forEach((slot) => clearTimeout(slot.id));
      for (const layer of Object.values(layers)) layer.stop?.();
      await ctx.close().catch(() => {});
      if (this.ctx === ctx) this.ctx = null;
    }

    setMaster(v) {
      this.masterVolume = v;
      if (!this.running) return;
      this.#ramp(this.master.gain, this.#curve(v), 0.3);
      this.layers.custom?.fadeTo(this.#curve(this.mix.custom || 0) * this.#curve(v), 0.3);
    }

    /** mix: { rain: 0..1, ocean, wind, fire, dream, custom } */
    setMix(mix, fadeSeconds = 0.6) {
      this.mix = { ...this.mix, ...mix };
      if (!this.running) return;
      for (const [name, vol] of Object.entries(this.mix)) {
        if (vol > 0 && !this.layers[name] && this.#builders[name]) {
          this.layers[name] = this.#builders[name]();
          this.layers[name].out?.connect(this.master);
        }
        const layer = this.layers[name];
        if (!layer) continue;
        if (layer.out) this.#ramp(layer.out.gain, this.#curve(vol), 0.6);
        else layer.fadeTo(this.#curve(vol) * this.#curve(this.masterVolume), fadeSeconds);
      }
    }

    setCustom(urls, shuffle = this.shuffle) {
      this.customUrls = urls;
      this.shuffle = shuffle;
      if (this.layers.custom) {
        this.layers.custom.stop();
        delete this.layers.custom;
        this.setMix({}, 0.3);
      }
    }

    // ---- helpers ------------------------------------------------------------

    #curve(v) { return Math.pow(Math.max(0, Math.min(1, v)), 2); } // perceptual volume

    #ramp(param, value, seconds, ctx = this.ctx) {
      const now = ctx.currentTime;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + Math.max(0.02, seconds));
    }

    #noise(color) {
      if (!this.buffers[color]) this.buffers[color] = makeNoise(this.ctx, color);
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers[color];
      src.loop = true;
      src.start(0, rand(0, NOISE_SECONDS - 1)); // random offset decorrelates layers sharing a buffer
      return src;
    }

    #filter(type, freq, Q = 0.7) {
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = Q;
      return f;
    }

    #gain(v) {
      const g = this.ctx.createGain();
      g.gain.value = v;
      return g;
    }

    #lfo(freq, depth, target) {
      const o = this.ctx.createOscillator();
      o.frequency.value = freq;
      const g = this.#gain(depth);
      o.connect(g).connect(target);
      o.start();
      return o;
    }

    /** Run fn at random intervals while the engine is running. */
    #every(minMs, maxMs, fn) {
      const slot = { id: 0 };
      const session = this.session;
      this.loops.push(slot);
      const loop = () => {
        if (!this.running || this.session !== session) return;
        fn();
        slot.id = setTimeout(loop, rand(minMs, maxMs));
      };
      slot.id = setTimeout(loop, rand(minMs, maxMs));
    }

    #pan(value) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = value;
      return p;
    }

    // ---- layers -------------------------------------------------------------

    #builders = {
      rain: () => {
        const ctx = this.ctx;
        const out = this.#gain(0);
        const nodes = [];

        // Body of the rain: soft pink hiss
        const hiss = this.#noise('pink');
        const hp = this.#filter('highpass', 400);
        const lp = this.#filter('lowpass', 7000);
        hiss.connect(hp).connect(lp).connect(this.#gain(1.1)).connect(out);
        nodes.push(hiss);

        // Distant rumble of rain on roofs
        const rumble = this.#noise('brown');
        rumble.connect(this.#filter('lowpass', 250)).connect(this.#gain(0.7)).connect(out);
        nodes.push(rumble);

        // Slow intensity drift so the rain breathes
        const drift = this.#gain(0.85);
        this.#lfo(0.05, 0.15, drift.gain);
        const shimmer = this.#noise('white');
        shimmer.connect(this.#filter('bandpass', 3200, 0.6)).connect(drift).connect(this.#gain(0.25)).connect(out);
        nodes.push(shimmer);

        // Individual droplets: tiny filtered noise ticks scattered in stereo
        const dropBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
        const dd = dropBuf.getChannelData(0);
        for (let i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (dd.length / 7));
        this.#every(12, 45, () => {
          const s = ctx.createBufferSource();
          s.buffer = dropBuf;
          s.playbackRate.value = rand(0.6, 1.6);
          const f = this.#filter('bandpass', rand(1800, 6500), rand(2, 6));
          const g = this.#gain(rand(0.06, 0.35));
          s.connect(f).connect(g).connect(this.#pan(rand(-0.9, 0.9))).connect(out);
          s.start();
        });

        return { out, stop: () => nodes.forEach((n) => n.stop()) };
      },

      ocean: () => {
        const out = this.#gain(0);
        const nodes = [];
        const waveRate = 0.075; // one wave every ~13 seconds

        const body = this.#noise('brown');
        const lp = this.#filter('lowpass', 500);
        const swell = this.#gain(0.5);
        body.connect(lp).connect(swell).connect(out);
        nodes.push(body, this.#lfo(waveRate, 0.42, swell.gain), this.#lfo(waveRate, 350, lp.frequency));

        const foam = this.#noise('pink');
        const foamGain = this.#gain(0.08);
        foam.connect(this.#filter('highpass', 1500)).connect(foamGain).connect(this.#pan(0.3)).connect(out);
        nodes.push(foam, this.#lfo(waveRate, 0.075, foamGain.gain));

        // A second, out-of-phase set of waves on the other side
        const body2 = this.#noise('brown');
        const swell2 = this.#gain(0.35);
        body2.connect(this.#filter('lowpass', 380)).connect(swell2).connect(this.#pan(-0.5)).connect(out);
        nodes.push(body2, this.#lfo(waveRate * 0.73, 0.3, swell2.gain));

        return { out, stop: () => nodes.forEach((n) => n.stop()) };
      },

      wind: () => {
        const out = this.#gain(0);
        const nodes = [];
        const src = this.#noise('white');
        const bp = this.#filter('bandpass', 420, 1.4);
        const gust = this.#gain(0.5);
        src.connect(bp).connect(this.#filter('lowpass', 1400)).connect(gust).connect(out);
        nodes.push(src, this.#lfo(0.043, 220, bp.frequency), this.#lfo(0.117, 90, bp.frequency), this.#lfo(0.031, 0.35, gust.gain));

        const low = this.#noise('brown');
        low.connect(this.#filter('lowpass', 300)).connect(this.#gain(0.4)).connect(out);
        nodes.push(low);
        return { out, stop: () => nodes.forEach((n) => n.stop()) };
      },

      fire: () => {
        const ctx = this.ctx;
        const out = this.#gain(0);
        const nodes = [];
        const roar = this.#noise('brown');
        const roarGain = this.#gain(0.5);
        roar.connect(this.#filter('lowpass', 350)).connect(roarGain).connect(out);
        nodes.push(roar, this.#lfo(0.21, 0.12, roarGain.gain));

        const hissN = this.#noise('pink');
        hissN.connect(this.#filter('highpass', 4000)).connect(this.#gain(0.03)).connect(out);
        nodes.push(hissN);

        const crackleBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.012), ctx.sampleRate);
        const cd = crackleBuf.getChannelData(0);
        for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (cd.length / 5));
        this.#every(40, 420, () => {
          const bursts = Math.random() < 0.25 ? Math.floor(rand(2, 6)) : 1; // occasional little pops
          for (let b = 0; b < bursts; b++) {
            const s = ctx.createBufferSource();
            s.buffer = crackleBuf;
            s.playbackRate.value = rand(0.5, 1.4);
            const g = this.#gain(rand(0.08, 0.4));
            s.connect(this.#filter('highpass', rand(900, 2500))).connect(g).connect(this.#pan(rand(-0.4, 0.4))).connect(out);
            s.start(ctx.currentTime + b * rand(0.01, 0.05));
          }
        });
        return { out, stop: () => nodes.forEach((n) => n.stop()) };
      },

      dream: () => {
        const ctx = this.ctx;
        const out = this.#gain(0);
        const reverb = ctx.createConvolver();
        reverb.buffer = makeImpulse(ctx, 5, 2.6);
        reverb.connect(this.#gain(0.9)).connect(out);
        const dry = this.#gain(0.35);
        const toVerb = this.#gain(0.8);
        toVerb.connect(reverb);
        const padBus = this.#filter('lowpass', 1600, 0.5);
        const filterLfo = this.#lfo(0.03, 500, padBus.frequency); // slow "opening and closing" of the pad
        padBus.connect(dry).connect(out);
        padBus.connect(toVerb);

        // Lush, open voicings (MIDI notes). Cmaj9 → Am11 → Fmaj7#11 → G6/9 → Em9 → Fmaj9
        const chords = [
          [48, 55, 62, 64, 71],
          [45, 52, 59, 60, 67],
          [41, 48, 55, 64, 66],
          [43, 50, 57, 59, 64],
          [40, 47, 54, 55, 62],
          [41, 48, 57, 64, 67],
        ];
        const chordSec = 11;
        let idx = 0;

        const playChord = () => {
          const t = ctx.currentTime;
          for (const note of chords[idx % chords.length]) {
            const env = this.#gain(0);
            env.connect(padBus);
            const level = 0.06;
            env.gain.setValueAtTime(0, t);
            env.gain.linearRampToValueAtTime(level, t + 4);
            env.gain.setValueAtTime(level, t + chordSec - 1);
            env.gain.linearRampToValueAtTime(0, t + chordSec + 4);
            for (const [type, detune] of [['sine', -7], ['triangle', 6], ['sine', 1200]]) {
              const o = ctx.createOscillator();
              o.type = type;
              o.frequency.value = midiToHz(note);
              o.detune.value = detune + rand(-3, 3);
              const g = this.#gain(detune === 1200 ? 0.15 : 0.5); // soft octave shimmer
              o.connect(g).connect(env);
              o.start(t);
              o.stop(t + chordSec + 4.5);
            }
          }
          idx += 1;
        };
        playChord();
        const session = this.session;
        const chordTimer = setInterval(() => {
          if (this.running && this.session === session) playChord();
        }, chordSec * 1000);
        this.timers.push(chordTimer);

        // Distant glassy bells from a pentatonic scale
        const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91];
        this.#every(1800, 5200, () => {
          const t = ctx.currentTime;
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = midiToHz(scale[Math.floor(Math.random() * scale.length)]);
          const g = this.#gain(0);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(rand(0.02, 0.05), t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + rand(2.5, 4.5));
          const pan = this.#pan(rand(-0.8, 0.8));
          o.connect(g).connect(pan);
          pan.connect(this.#gain(0.25)).connect(out);
          pan.connect(this.#gain(1)).connect(toVerb);
          o.start(t);
          o.stop(t + 5);
        });

        return { out, stop: () => { clearInterval(chordTimer); filterLfo.stop(); } };
      },

      custom: () => {
        // Played through a plain <audio> element (volume set directly) so local files
        // are never blocked by cross-origin rules on the Web Audio graph.
        const urls = [...this.customUrls];
        const audio = new Audio();
        audio.volume = 0;
        if (this.shuffle) urls.sort(() => Math.random() - 0.5);
        audio.loop = urls.length === 1;
        let i = 0;
        const playNext = () => {
          if (!urls.length) return;
          audio.src = urls[i % urls.length];
          i += 1;
          audio.play().catch(() => {});
        };
        audio.addEventListener('ended', () => { if (urls.length > 1) playNext(); });
        audio.addEventListener('error', () => { if (urls.length > 1 && i < urls.length * 2) playNext(); });
        playNext();

        let fadeTimer = null;
        const fadeTo = (target, seconds) => {
          clearInterval(fadeTimer);
          const from = audio.volume;
          const steps = Math.max(1, Math.round(seconds * 30));
          let n = 0;
          fadeTimer = setInterval(() => {
            n += 1;
            audio.volume = Math.max(0, Math.min(1, from + (target - from) * (n / steps)));
            if (n >= steps) clearInterval(fadeTimer);
          }, 1000 / 30);
        };
        return {
          out: null,
          fadeTo,
          stop: () => { clearInterval(fadeTimer); audio.pause(); audio.removeAttribute('src'); audio.load(); },
        };
      },
    };
  }

  window.SoundEngine = SoundEngine;
})();
