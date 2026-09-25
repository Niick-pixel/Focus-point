// Floating "Standing" pill: countdown ring + a Sit button that appears on hover.
const CIRC = 2 * Math.PI * 17;
const $ = (id) => document.getElementById(id);

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render(state) {
  if (state.phase !== 'standing') return;
  $('time').textContent = fmt(state.standingLeftMs);
  const done = 1 - state.standingLeftMs / state.standingTotalMs;
  $('ring').style.strokeDashoffset = String(CIRC * Math.min(1, Math.max(0, done)));
}

$('ring').style.strokeDasharray = String(CIRC);
$('sit').addEventListener('click', () => window.api.standSitNow());
window.api.onStandState(render);
window.api.getStandState().then(render);
window.api.getSettings().then((s) => { document.documentElement.dataset.theme = s.theme; });
window.api.onSettings((s) => { document.documentElement.dataset.theme = s.theme; });
