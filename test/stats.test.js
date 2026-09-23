const test = require('node:test');
const assert = require('node:assert');
const { RestTimer } = require('../src/main/timer');
const { Stats, dayKey } = require('../src/main/stats');

function setup() {
  let now = new Date(2026, 8, 21, 9, 0, 0).getTime(); // Monday 09:00 local
  const clock = () => now;
  const settings = {
    workMinutes: 45, breakMinutes: 2, longBreakEnabled: false, longBreakEvery: 4, longBreakMinutes: 10,
    snoozeMinutes: 5, warningSeconds: 0, confirmEnd: false, idleResetMinutes: 0,
  };
  const timer = new RestTimer(() => settings, { now: clock });
  const stats = new Stats(null, { now: clock });
  stats.attach(timer);
  timer.startWork();
  const advance = (ms) => { const end = now + ms; while (now < end) { now = Math.min(end, now + 1000); timer.tick(); } };
  return { timer, stats, advance, today: () => stats.get()[dayKey(now)] };
}

test('counts rest time and completed breaks', () => {
  const { stats, advance, today } = setup();
  advance(45 * 60000); // work
  advance(2 * 60000);  // break
  const d = today();
  assert.strictEqual(d.completed, 1);
  assert.ok(Math.abs(d.restMs - 2 * 60000) <= 1000);
  assert.ok(Math.abs(d.workMs - 45 * 60000) <= 2000);
  assert.strictEqual(Object.keys(stats.get()).length, 1);
});

test('skips and snoozes are counted separately, with the time you did rest', () => {
  const { timer, advance, today } = setup();
  timer.breakNow();
  advance(20000);
  timer.skipBreak();
  timer.breakNow();
  advance(5000);
  timer.snooze();
  const d = today();
  assert.deepStrictEqual([d.completed, d.skipped, d.snoozed], [0, 1, 1]);
  assert.strictEqual(d.restMs, 25000);
});

test('paused time is not screen time', () => {
  const { timer, advance, today } = setup();
  timer.pause(60);
  advance(60 * 60000 - 1000);
  assert.strictEqual(today()?.workMs ?? 0, 0);
});
