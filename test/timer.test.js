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
