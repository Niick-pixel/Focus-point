const $ = (id) => document.getElementById(id);
const engine = new window.SoundEngine({ loadAsset: (name) => window.api.loadSound(name) });

let info = null;
let tickTimer = null;
let breathTimer = null;
let muted = false;

const fmt = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

function tick() {
  const left = info.endsAt - Date.now();
  $('time').textContent = fmt(left);
  const done = 1 - Math.max(0, left) / info.totalMs;
  $('bar').style.width = `${Math.min(100, done * 100).toFixed(2)}%`;
}

// Calm 4-2-6 breathing: in for 4s, hold 2s, out for 6s. Longer exhales slow the heart rate.
const BREATH = [
  { cls: 'in', label: 'Breathe in', ms: 4000 },
  { cls: 'hold', label: 'Hold', ms: 2000 },
  { cls: 'out', label: 'Breathe out', ms: 6000 },
];
function breathe(step = 0) {
  const phase = BREATH[step % BREATH.length];
  const el = $('breath');
  el.classList.remove('in', 'hold', 'out');
  el.classList.add(phase.cls);
  $('breathLabel').textContent = phase.label;
  breathTimer = setTimeout(() => breathe(step + 1), phase.ms);
}

// Eye exercises: follow a dot through a gentle routine that loops for the whole break.
// Positions are in "units": -1..1 across the usable area, (0, 0) = screen center.
const TAU = Math.PI * 2;
const EYE_STEPS = [
  { label: 'Follow the dot — side to side', secs: 10, at: (t) => [Math.sin((TAU * t) / 3.3), 0] },
  { label: 'Now up and down', secs: 10, at: (t) => [0, Math.sin((TAU * t) / 3.3)] },
  { label: 'Slow circles', secs: 9, at: (t) => [Math.sin((TAU * t) / 4.5), -Math.cos((TAU * t) / 4.5)] },
  { label: 'And the other way', secs: 9, at: (t) => [-Math.sin((TAU * t) / 4.5), -Math.cos((TAU * t) / 4.5)] },
  { label: 'Trace a sideways eight', secs: 11, at: (t) => [Math.sin((TAU * t) / 5.5), Math.sin((2 * TAU * t) / 5.5)] },
  { label: 'Look far away… then back at the dot', secs: 10, at: () => [0, 0], scale: (t) => 1 + 1.4 * (0.5 - 0.5 * Math.cos((TAU * t) / 5)) },
  { label: 'Close your eyes and relax', secs: 7, at: () => [0, 0], fade: true },
];
const EYE_BLEND_S = 0.9; // glide from wherever the dot is into the next step's path

let eyeFrame = 0;
let eyeState = null;

function startEyes() {
  document.body.classList.add('mode-eyes');
  $('eyeLayer').hidden = false;
  $('eyeLabel').hidden = false;
  eyeState = { step: -1, stepStart: 0, from: [0, 0], pos: [0, 0], t0: performance.now() };
  eyeFrame = requestAnimationFrame(eyeTick);
}

function stopEyes() {
  cancelAnimationFrame(eyeFrame);
  eyeState = null;
  document.body.classList.remove('mode-eyes');
  $('eyeLayer').hidden = true;
  $('eyeLabel').hidden = true;
}

function eyeTick(now) {
  if (!eyeState) return;
  const total = EYE_STEPS.reduce((a, s) => a + s.secs, 0);
  let t = ((now - eyeState.t0) / 1000) % total;
  let index = 0;
  while (t >= EYE_STEPS[index].secs) { t -= EYE_STEPS[index].secs; index += 1; }
  const step = EYE_STEPS[index];

  if (index !== eyeState.step) {
    eyeState.step = index;
    eyeState.from = eyeState.pos;
    $('eyeLabel').textContent = step.label;
  }

  let [x, y] = step.at(t);
  const k = Math.min(1, t / EYE_BLEND_S);
  const ease = k * k * (3 - 2 * k);
  x = eyeState.from[0] + (x - eyeState.from[0]) * ease;
  y = eyeState.from[1] + (y - eyeState.from[1]) * ease;
  eyeState.pos = [x, y];

  const w = window.innerWidth, h = window.innerHeight;
  const px = w / 2 + x * w * 0.36;
  const py = h / 2 + y * h * 0.32;
  const scale = step.scale ? step.scale(t) : 1;
  const dot = $('eyeDot');
  dot.style.transform = `translate(${px}px, ${py}px) scale(${scale})`;
  dot.style.opacity = step.fade ? String(Math.max(0.08, 1 - t / 1.5)) : '1';
  eyeFrame = requestAnimationFrame(eyeTick);
}

window.api.onBreakStart((payload) => {
  info = payload;
  document.documentElement.dataset.theme = payload.theme || 'night';
  $('eyebrow').textContent = payload.isLong ? 'Long break — step away' : 'Time to rest';
  $('tip').textContent = payload.tip || '';

  $('skip').hidden = !payload.allowSkip;
  $('snooze').hidden = !payload.allowSnooze;
  $('snooze').textContent = `Snooze ${payload.snoozeMinutes} min`;

  $('emergency').hidden = !payload.strict;

  const activity = payload.activity || 'breathe';
  $('breath').hidden = activity !== 'breathe';
  if (activity === 'breathe') setTimeout(() => breathe(0), 600);
  if (activity === 'eyes') startEyes();

  tick();
  tickTimer = setInterval(tick, 250);

  if (payload.sound) {
    $('mute').hidden = false;
    engine.start({ ...payload.sound, fadeIn: 4 });
  }

  requestAnimationFrame(() => document.body.classList.add('visible'));
});

window.api.onBreakWaiting(() => {
  clearInterval(tickTimer);
  stopEyes();
  $('eyebrow').textContent = 'Break complete';
  $('time').textContent = 'Welcome back';
  $('time').style.fontSize = 'clamp(40px, 6vw, 72px)';
  $('bar').style.width = '100%';
  $('actions').hidden = true;
  $('backActions').hidden = false;
  $('back').focus();
});

window.api.onBreakClosing(() => {
  clearInterval(tickTimer);
  clearTimeout(breathTimer);
  stopEyes();
  document.body.classList.add('leaving');
  engine.stop(1.4);
});

$('skip').addEventListener('click', () => window.api.skip());
$('snooze').addEventListener('click', () => window.api.snooze());
$('back').addEventListener('click', () => window.api.back());
$('mute').addEventListener('click', () => {
  muted = !muted;
  $('mute').classList.toggle('muted', muted);
  $('mute').title = muted ? 'Unmute' : 'Mute';
  engine.setMaster(muted ? 0 : info.sound.master);
});

// Strict mode's emergency exit: hold Esc for 5 seconds.
const EMERGENCY_MS = 5000;
let holdStart = 0;
let holdFrame = 0;

function holdTick() {
  const p = Math.min(1, (performance.now() - holdStart) / EMERGENCY_MS);
  $('emergencyFill').style.width = `${p * 100}%`;
  if (p >= 1) {
    cancelHold();
    $('emergencyText').textContent = 'Ending break…';
    window.api.skip();
    return;
  }
  holdFrame = requestAnimationFrame(holdTick);
}

function cancelHold() {
  cancelAnimationFrame(holdFrame);
  holdStart = 0;
  $('emergency').classList.remove('holding');
  $('emergencyFill').style.width = '0%';
}

// Swallow shortcuts that could close or reload the overlay.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || (e.ctrlKey && ['r', 'w'].includes(e.key.toLowerCase())) || e.key === 'F5') {
    e.preventDefault();
  }
  if (e.key === 'Escape' && info?.strict && !holdStart) {
    holdStart = performance.now();
    $('emergency').classList.add('holding');
    holdFrame = requestAnimationFrame(holdTick);
  }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Escape') cancelHold(); });
window.addEventListener('blur', cancelHold);
