const test = require('node:test');
const assert = require('node:assert');
const { activeZone } = require('../src/main/zones');
const { RestTimer } = require('../src/main/timer');

const WEEKDAYS = [1, 2, 3, 4, 5];
const t = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
// 2026-09-21 is a Monday, 2026-09-26 a Saturday
const meeting = { id: 'a', label: 'Standup', days: WEEKDAYS, start: '09:30', end: '10:00', enabled: true };

test('a zone covers its range of hours on its days only', () => {
  assert.ok(activeZone([meeting], t(2026, 9, 21, 9, 30)));
  assert.ok(activeZone([meeting], t(2026, 9, 21, 9, 59)));
  assert.strictEqual(activeZone([meeting], t(2026, 9, 21, 10, 0)), null, 'end is exclusive');
  assert.strictEqual(activeZone([meeting], t(2026, 9, 21, 9, 29)), null);
  assert.strictEqual(activeZone([meeting], t(2026, 9, 26, 9, 45)), null, 'not on Saturday');
  assert.strictEqual(activeZone([{ ...meeting, enabled: false }], t(2026, 9, 21, 9, 45)), null);
  assert.strictEqual(activeZone([meeting], t(2026, 9, 21, 9, 45)).endsAt, t(2026, 9, 21, 10, 0));
});

test('zones can run past midnight', () => {
  const night = { id: 'n', days: [5], start: '22:00', end: '02:00', enabled: true }; // Friday night
  assert.strictEqual(activeZone([night], t(2026, 9, 25, 23, 0)).endsAt, t(2026, 9, 26, 2, 0));
  assert.ok(activeZone([night], t(2026, 9, 26, 1, 30)), 'still on Saturday 01:30');
  assert.strictEqual(activeZone([night], t(2026, 9, 27, 1, 30)), null, 'Sunday 01:30 is not Friday night');
});

test('overlapping zones report the later end', () => {
  const long = { id: 'b', days: WEEKDAYS, start: '09:00', end: '11:00', enabled: true };
  assert.strictEqual(activeZone([meeting, long], t(2026, 9, 21, 9, 45)).endsAt, t(2026, 9, 21, 11, 0));
});

test('a break due inside a zone waits for the zone to end', () => {
  let now = t(2026, 9, 21, 9, 0);
  const settings = {
    workMinutes: 45, breakMinutes: 2, longBreakEnabled: false, longBreakEvery: 4, longBreakMinutes: 10,
    warningSeconds: 30, idleResetMinutes: 0, holdForFullscreen: true, fullscreenMaxWaitMinutes: 5,
    zones: [{ id: 'm', label: 'Team meeting', days: WEEKDAYS, start: '09:30', end: '11:00', enabled: true }],
  };
  const timer = new RestTimer(() => settings, { now: () => now });
  const events = [];
  timer.on('warning', () => events.push('warning'));
  timer.startWork();
  const advance = (ms) => { const end = now + ms; while (now < end) { now = Math.min(end, now + 1000); timer.tick(); } };

  advance(45 * 60000); // 09:45, inside the meeting
  assert.strictEqual(timer.phase, 'deferred');
  assert.strictEqual(timer.state().deferReason, 'zone');
  assert.deepStrictEqual(events, [], 'no heads-up during the meeting');
  advance(74 * 60000); // 10:59 — the fullscreen max-wait (5 min) must not force it
  assert.strictEqual(timer.phase, 'deferred');
  advance(61000); // 11:00:01
  assert.strictEqual(timer.phase, 'working');
  advance(31000);
  assert.deepStrictEqual(events, ['warning']);
  assert.strictEqual(timer.phase, 'break');
});
