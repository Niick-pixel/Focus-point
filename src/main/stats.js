// Rest history: small per-day totals kept in stats.json next to the settings.
//   restMs     – time actually spent on the break screen
//   workMs     – screen time counted by the work timer (not idle/away/paused)
//   completed  – breaks you finished
//   skipped    – breaks you skipped
//   snoozed    – breaks you pushed back
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 400;
const MAX_TICK_MS = 5000; // ignore gaps (sleep, frozen process) when counting screen time

function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const emptyDay = () => ({ restMs: 0, workMs: 0, completed: 0, skipped: 0, snoozed: 0 });

class Stats {
  constructor(dir, { now = Date.now } = {}) {
    this.file = dir ? path.join(dir, 'stats.json') : null;
    this.now = now;
    this.days = this.#load();
    this.breakStartedAt = null;
    this.lastTick = null;
    this.saveTimer = null;
  }

  #load() {
    if (!this.file) return {};
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')).days || {};
    } catch {
      return {};
    }
  }

  #day(ms) {
    const key = dayKey(ms);
    if (!this.days[key]) this.days[key] = emptyDay();
    return this.days[key];
  }

  /** Wire up to a RestTimer. `onChange` fires after a break is recorded. */
  attach(timer, onChange = () => {}) {
    timer.on('break-start', () => { this.breakStartedAt = this.now(); });
    timer.on('break-end', ({ reason }) => {
      this.recordBreak(reason);
      onChange();
    });
    timer.on('state', (state) => this.tick(state.phase));
  }

  recordBreak(reason) {
    const now = this.now();
    const started = this.breakStartedAt ?? now;
    this.breakStartedAt = null;
    const day = this.#day(started);
    day.restMs += Math.max(0, now - started);
    if (reason === 'completed') day.completed += 1;
    else if (reason === 'skipped') day.skipped += 1;
    else if (reason === 'snoozed') day.snoozed += 1;
    this.save();
  }

  /** Called on every timer state update; counts screen time while working. */
  tick(phase) {
    const now = this.now();
    const counting = phase === 'working' || phase === 'deferred';
    if (counting && this.lastTick != null) {
      const delta = now - this.lastTick;
      if (delta > 0 && delta <= MAX_TICK_MS) this.#day(now).workMs += delta;
    }
    this.lastTick = counting ? now : null;
    this.#saveSoon();
  }

  get() {
    return structuredClone(this.days);
  }

  clear() {
    this.days = {};
    this.save();
  }

  #saveSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 30000);
  }

  save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const cutoff = dayKey(this.now() - KEEP_DAYS * 86400000);
    for (const key of Object.keys(this.days)) if (key < cutoff) delete this.days[key];
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, days: this.days }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Could not save stats:', err);
    }
  }
}

module.exports = { Stats, dayKey };
