// Break zones: time ranges when breaks are held because you need to be present
// (meetings, classes, calls). A zone is { id, label, days, start, end, enabled }:
//   days  – weekdays it applies to, 0 = Sunday … 6 = Saturday
//   start – 'HH:MM', end – 'HH:MM'. If end < start the zone runs past midnight
//           (e.g. 22:00–02:00) and belongs to the day it starts on.

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function at(base, dayOffset, minutes) {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

/** @returns {{ zone: object, endsAt: number } | null} the zone covering `now`, ending last */
function activeZone(zones, now) {
  const d = new Date(now);
  const today = d.getDay();
  const yesterday = (today + 6) % 7;
  const minute = d.getHours() * 60 + d.getMinutes();
  let best = null;

  for (const zone of zones || []) {
    if (!zone.enabled) continue;
    const start = toMinutes(zone.start);
    const end = toMinutes(zone.end);
    if (start == null || end == null || start === end) continue;
    const days = new Set(zone.days || []);
    let endsAt = null;

    if (start < end) {
      if (days.has(today) && minute >= start && minute < end) endsAt = at(now, 0, end);
    } else if (days.has(today) && minute >= start) {
      endsAt = at(now, 1, end);        // started tonight, ends tomorrow
    } else if (days.has(yesterday) && minute < end) {
      endsAt = at(now, 0, end);        // started last night, ends this morning
    }

    if (endsAt != null && (!best || endsAt > best.endsAt)) best = { zone, endsAt };
  }
  return best;
}

module.exports = { activeZone, toMinutes };
