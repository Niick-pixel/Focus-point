const test = require('node:test');
const assert = require('node:assert');
const { RestTimer } = require('../src/main/timer');

function setup(overrides = {}) {
  const settings = {
    workMinutes: 45, breakMinutes: 2, longBreakEnabled: true, longBreakEvery: 3, longBreakMinutes: 10,
    snoozeMinutes: 5, warningSeconds: 30, confirmEnd: false, idleResetMinutes: 5, ...overrides,
  };
  let now = 0;
  let idle = 0;
  const t = new RestTimer(() => settings, { now: () => now, idleSeconds: () => idle });
  const events = [];
  for (const e of ['break-start', 'break-end', 'break-closed', 'warning', 'break-waiting']) t.on(e, (p) => events.push([e, p]));
  t.startWork();
  return {
    t, events, settings,
    advance(ms) { const end = now + ms; while (now < end) { now = Math.min(end, now + 1000); t.tick(); } },
    setIdle(s) { idle = s; },
  };
}

test('work block leads to a warning, then a break, then back to work', () => {
  const { t, events, advance } = setup();
  advance(45 * 60000 - 30000);
  assert.deepStrictEqual(events.map((e) => e[0]), ['warning']);
  advance(30000);
  assert.strictEqual(t.phase, 'break');
  assert.strictEqual(t.breakTotalMs, 2 * 60000);
  advance(2 * 60000);
  assert.strictEqual(t.phase, 'working');
  assert.strictEqual(t.breaksTaken, 1);
});

test('every Nth break is a long break', () => {
  const { t, advance } = setup({ workMinutes: 1, warningSeconds: 0 });
  const lengths = [];
  t.on('break-start', (info) => lengths.push(info.isLong));
  for (let i = 0; i < 3; i++) { advance(60000); advance(t.breakTotalMs); }
  assert.deepStrictEqual(lengths, [false, false, true]);
});

test('snooze postpones the break by snoozeMinutes', () => {
  const { t } = setup();
  t.breakNow();
  t.snooze();
  assert.strictEqual(t.phase, 'working');
  assert.strictEqual(t.state().remainingMs, 5 * 60000);
});

test('skipping does not count toward the long-break cycle', () => {
  const { t } = setup();
  t.breakNow();
  t.skipBreak();
  assert.strictEqual(t.breaksTaken, 0);
  assert.strictEqual(t.phase, 'working');
});

test('confirmEnd waits for the user before starting work', () => {
  const { t, advance } = setup({ confirmEnd: true });
  t.breakNow();
  advance(2 * 60000);
  assert.strictEqual(t.phase, 'waiting');
  t.confirmBack();
  assert.strictEqual(t.phase, 'working');
});

test('being idle restarts the work block on return', () => {
  const { t, advance, setIdle } = setup();
  advance(30 * 60000);
  setIdle(6 * 60);
  advance(1000);
  assert.strictEqual(t.phase, 'away');
  setIdle(0);
  advance(1000);
  assert.strictEqual(t.phase, 'working');
  assert.ok(t.state().remainingMs > 44 * 60000);
});

test('timed pause resumes by itself', () => {
  const { t, advance } = setup();
  t.pause(15);
  assert.strictEqual(t.phase, 'paused');
  advance(15 * 60000);
  assert.strictEqual(t.phase, 'working');
});

function setupFullscreen(overrides = {}) {
  let fullscreen = false;
  const env = setup({ holdForFullscreen: true, fullscreenMaxWaitMinutes: 0, ...overrides });
  env.t.isFullscreen = () => fullscreen;
  env.setFullscreen = (v) => { fullscreen = v; };
  return env;
}

test('a break due during a fullscreen game waits until the game closes', () => {
  const { t, events, advance, setFullscreen } = setupFullscreen();
  setFullscreen(true);
  advance(45 * 60000);
  assert.strictEqual(t.phase, 'deferred');
  assert.ok(!events.some((e) => e[0] === 'warning'), 'no warning pops up over the game');
  advance(3 * 60 * 60000); // three hours of gaming
  assert.strictEqual(t.phase, 'deferred');
  setFullscreen(false);
  advance(1000);
  assert.strictEqual(t.phase, 'working'); // short heads-up window
  advance(1000);
  assert.ok(events.some((e) => e[0] === 'warning'));
  advance(30000);
  assert.strictEqual(t.phase, 'break');
});

test('fullscreen does not count as being away, even with no input', () => {
  const { t, advance, setIdle, setFullscreen } = setupFullscreen();
  setFullscreen(true);
  setIdle(20 * 60); // watching a movie, hands off
  advance(10 * 60000);
  assert.strictEqual(t.phase, 'working');
});

test('max wait forces the break after a limit', () => {
  const { t, advance, setFullscreen } = setupFullscreen({ fullscreenMaxWaitMinutes: 30 });
  setFullscreen(true);
  advance(45 * 60000);
  advance(29 * 60000);
  assert.strictEqual(t.phase, 'deferred');
  advance(60000);
  assert.strictEqual(t.phase, 'break');
});

test('with the option off, breaks interrupt fullscreen apps', () => {
  const { t, advance, setFullscreen } = setupFullscreen({ holdForFullscreen: false });
  setFullscreen(true);
  advance(45 * 60000);
  assert.strictEqual(t.phase, 'break');
});
