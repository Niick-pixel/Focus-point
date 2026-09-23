const $ = (id) => document.getElementById(id);
const engine = new window.SoundEngine();

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

window.api.onBreakStart((payload) => {
  info = payload;
  document.documentElement.dataset.theme = payload.theme || 'night';
  $('eyebrow').textContent = payload.isLong ? 'Long break — step away' : 'Time to rest';
  $('tip').textContent = payload.tip || '';

  $('skip').hidden = !payload.allowSkip;
  $('snooze').hidden = !payload.allowSnooze;
  $('snooze').textContent = `Snooze ${payload.snoozeMinutes} min`;

  $('breath').hidden = !payload.showBreathing;
  if (payload.showBreathing) setTimeout(() => breathe(0), 600);

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

// Swallow shortcuts that could close or reload the overlay.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || (e.ctrlKey && ['r', 'w'].includes(e.key.toLowerCase())) || e.key === 'F5') {
    e.preventDefault();
  }
});
