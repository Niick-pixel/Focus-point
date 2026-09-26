const $ = (id) => document.getElementById(id);
const { Figure, PelvisDiagram, Desk } = window.StandVisuals;
const { ROUTINES, ROUTINE_NAMES, GET_READY, getExercise } = window.StandExercises;

let payload = null;
let frame = 0;
let desk = null;
let routine = null; // { segments, t0, offset, figure, pelvis }
let finished = false;

// ---- soft sound cues ----------------------------------------------------------

let muted = false;
try { muted = localStorage.getItem('standMuted') === '1'; } catch { /* storage unavailable */ }
let audio = null;
let lastChime = 0;

function chime(freq, gain = 0.06, length = 0.5) {
  if (muted || voiceOn || !payload?.primary) return;
  const now = performance.now();
  if (now - lastChime < 1400) return; // never nag: at most one cue every 1.4 s
  lastChime = now;
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + length + 0.05);
  } catch { /* audio unavailable */ }
}

// ---- spoken cues (optional) ------------------------------------------------------

let voiceOn = false;
let lastSpoken = '';

function speak(text) {
  if (!voiceOn || !payload?.primary || !('speechSynthesis' in window)) return;
  // Speak each kind of cue once ("Hold… 4", "Hold… 3" → "Hold").
  const key = text.replace(/[…\d]+/g, '').trim();
  if (!key || key === lastSpoken) return;
  lastSpoken = key;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(key);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /^en(-|_)/i.test(v.lang) && /natural|aria|jenny|guy|zira/i.test(v.name))
      || voices.find((v) => /^en(-|_)/i.test(v.lang)) || null;
    u.rate = 0.95;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}

function renderVoice() {
  $('voice').setAttribute('aria-pressed', String(voiceOn));
  $('voice').title = voiceOn ? 'Spoken cues: on' : 'Spoken cues: off';
}

$('voice').addEventListener('click', () => {
  voiceOn = !voiceOn;
  lastSpoken = '';
  if (!voiceOn) try { speechSynthesis.cancel(); } catch { /* ignore */ }
  window.api.setSettings({ standVoice: voiceOn });
  renderVoice();
});

function renderMute() {
  $('mute').classList.toggle('muted', muted);
  $('mute').title = muted ? 'Unmute cues' : 'Mute cues';
}

$('mute').addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('standMuted', muted ? '1' : '0'); } catch { /* ignore */ }
  renderMute();
});

// ---- raise / lower ------------------------------------------------------------

function button(label, onClick) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function showDesk(direction) {
  $('exerciseView').hidden = true;
  $('deskView').hidden = false;
  const art = $('deskArt');
  art.replaceChildren();
  desk = new Desk(art, direction);
  const secondary = $('deskSecondary');
  secondary.replaceChildren();

  if (direction === 'up') {
    $('deskEyebrow').textContent = 'Standing time';
    $('deskTitle').textContent = 'Time to stand';
    $('deskSub').textContent = payload.routine === 'none'
      ? 'Raise your desk and keep working on your feet.'
      : 'Raise your desk. A short pelvic-floor routine starts when you’re up.';
    $('deskPrimary').textContent = 'I’m standing';
    $('deskPrimary').onclick = () => window.api.standUp();
    secondary.append(
      button('Not now · 10 min', () => window.api.standNotNow()),
      button('Skip this one', () => window.api.standSkip()),
    );
    chime(587, 0.05, 0.9);
  } else {
    const minutes = Math.max(1, Math.round((payload.stoodMs || 0) / 60000));
    $('deskEyebrow').textContent = 'Standing time';
    $('deskTitle').textContent = 'Time to sit';
    $('deskSub').textContent = `You stood for ${minutes} minute${minutes === 1 ? '' : 's'}. Lower your desk and let your shoulders drop.`;
    $('deskPrimary').textContent = 'Desk is down';
    $('deskPrimary').onclick = () => window.api.standDown();
    secondary.append(button('5 more minutes', () => window.api.standMore()));
    chime(440, 0.05, 0.9);
  }
  $('deskPrimary').focus();
  loop();
}

// ---- guided routine -------------------------------------------------------------

function buildSegments(name, level) {
  const ids = ROUTINES[name] || ROUTINES.short;
  let t = 0;
  return ids.map((id, index) => {
    const ex = getExercise(id, level);
    const seg = { id, ex, index, start: t, readyEnd: t + GET_READY, end: t + GET_READY + ex.secs };
    t = seg.end;
    return seg;
  });
}

function showExercises() {
  $('deskView').hidden = true;
  $('exerciseView').hidden = false;
  desk = null;
  const figSvg = $('figure');
  const pelSvg = $('pelvis');
  figSvg.replaceChildren();
  pelSvg.replaceChildren();
  const segments = buildSegments(payload.routine, payload.level || 1);
  const level = payload.level || 1;
  $('exEyebrow').textContent = `Standing · ${ROUTINE_NAMES[payload.routine] || 'Pelvic floor'}${payload.routine === 'stretch' ? '' : ` · Level ${level}`}`;
  routine = {
    segments,
    t0: performance.now(),
    offset: 0,
    pausedAt: 0,
    figure: new Figure(figSvg),
    pelvis: new PelvisDiagram(pelSvg),
    seg: -1,
    cue: '',
    lastFloor: 0,
  };
  $('exDots').replaceChildren(...segments.map(() => document.createElement('i')));
  loop();
}

function elapsed() {
  const now = routine.pausedAt || performance.now();
  return (now - routine.t0) / 1000 + routine.offset;
}

function togglePause() {
  if (!routine || $('exerciseView').hidden) return;
  if (routine.pausedAt) {
    routine.offset -= (performance.now() - routine.pausedAt) / 1000;
    routine.pausedAt = 0;
    $('exPause').textContent = 'Pause';
    document.body.classList.remove('paused');
  } else {
    routine.pausedAt = performance.now();
    $('exPause').textContent = 'Resume';
    document.body.classList.add('paused');
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}

function skipToNext() {
  if (!routine) return;
  const t = elapsed();
  const next = routine.segments.find((seg) => seg.start > t);
  if (next) routine.offset += next.start - t;
  else finish();
}

function finish() {
  if (finished) return;
  finished = true;
  window.api.standExercisesDone();
}

function setCue(text) {
  if (text === routine.cue) return;
  routine.cue = text;
  const cue = $('exCue');
  cue.classList.add('swap');
  setTimeout(() => {
    cue.textContent = text;
    cue.classList.remove('swap');
  }, 140);
}

function routineFrame() {
  const t = elapsed();
  const segs = routine.segments;
  const segIndex = segs.findIndex((s) => t < s.end);
  if (segIndex === -1) {
    routine.figure.ease({ arms: 'hang' });
    routine.pelvis.set(0);
    if (payload.primary) finish();
    return;
  }
  const seg = segs[segIndex];
  const ex = seg.ex;

  if (segIndex !== routine.seg) {
    routine.seg = segIndex;
    $('exTitle').textContent = ex.title;
    $('exHow').textContent = ex.how;
    $('exFocus').textContent = `Focus · ${ex.focus}`;
    // Stretches get the stage to themselves; the pelvis diagram returns for pelvic-floor work.
    $('exPelvis').closest('.ex-stage').classList.toggle('solo', ex.focus !== 'Pelvic floor');
    lastSpoken = '';
    speak(`${segIndex === 0 ? '' : 'Next: '}${ex.title}`);
    [...$('exDots').children].forEach((d, i) => {
      d.classList.toggle('done', i < segIndex);
      d.classList.toggle('now', i === segIndex);
    });
  }

  let state;
  if (t < seg.readyEnd) {
    $('exNext').textContent = segIndex === 0 ? 'Get ready' : 'Up next';
    state = { floor: 0, pose: { arms: ex.at(0).pose.arms }, cue: 'Stand tall and breathe', count: '' };
    $('exBar').style.width = `${((t - seg.start) / GET_READY) * 100}%`;
  } else {
    $('exNext').textContent = `${segIndex + 1} of ${segs.length}`;
    state = ex.at(t - seg.readyEnd);
    $('exBar').style.width = `${((t - seg.readyEnd) / ex.secs) * 100}%`;
  }

  if (routine.pausedAt) {
    setCue('Paused');
    return;
  }
  routine.figure.ease({ ...state.pose, floor: state.floor });
  routine.pelvis.set(state.floor);
  setCue(state.cue);
  if (t >= seg.readyEnd) speak(state.cue);
  $('exCount').textContent = !state.count ? '' : /^\d/.test(state.count) ? `Rep ${state.count}` : state.count;

  // Soft cue as the lift begins (higher note) or fully lets go (lower note).
  if (routine.lastFloor < 0.45 && state.floor >= 0.45) chime(660, 0.035, 0.35);
  if (routine.lastFloor > 0.25 && state.floor <= 0.05) chime(494, 0.03, 0.45);
  routine.lastFloor = state.floor;
}

$('exSkip').addEventListener('click', skipToNext);
$('exPause').addEventListener('click', togglePause);
$('exEnd').addEventListener('click', finish);

// ---- frame loop ---------------------------------------------------------------

function loop() {
  cancelAnimationFrame(frame);
  const step = (now) => {
    if (desk) desk.frame(now);
    if (routine && !$('exerciseView').hidden) routineFrame();
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

// ---- wiring -------------------------------------------------------------------

window.api.onStandMode((p) => {
  payload = { ...payload, ...p };
  document.documentElement.dataset.theme = payload.theme || 'night';
  document.body.classList.toggle('secondary', !payload.primary);
  voiceOn = !!payload.voice;
  renderMute();
  renderVoice();
  if (p.mode === 'raise') showDesk('up');
  else if (p.mode === 'lower') showDesk('down');
  else if (p.mode === 'exercise') {
    finished = false;
    showExercises();
  }
  requestAnimationFrame(() => document.body.classList.add('visible'));
});

window.api.onStandClosing(() => {
  document.body.classList.add('leaving');
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  setTimeout(() => cancelAnimationFrame(frame), 1500);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || (e.ctrlKey && ['r', 'w'].includes(e.key.toLowerCase())) || e.key === 'F5') e.preventDefault();
  if (!routine || $('exerciseView').hidden || e.target.closest?.('button')) return;
  if (e.key === ' ') { e.preventDefault(); togglePause(); }
  if (e.key === 'ArrowRight') skipToNext();
});
