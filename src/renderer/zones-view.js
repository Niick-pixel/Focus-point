// Break zones editor (Rhythm tab). Uses $, settings and save() from settings.js.
const ZONE_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const zoneDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const zoneDayLongFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const zoneDayDate = (day) => new Date(2026, 8, 20 + day); // 2026-09-20 is a Sunday

function saveZones(zones, delay = 0) {
  save('zones', zones, delay);
}

function zoneIsOvernight(z) {
  return z.start && z.end && z.end < z.start;
}

function renderZones() {
  const list = $('#zoneList');
  // Don't rebuild under the user's cursor while they're typing a name or time.
  if (list.contains(document.activeElement)) return;
  list.innerHTML = '';
  (settings.zones || []).forEach((zone, index) => list.append(zoneCard(zone, index)));
}

function zoneCard(zone, index) {
  const update = (patch, delay = 0) => {
    const zones = structuredClone(settings.zones);
    zones[index] = { ...zones[index], ...patch };
    saveZones(zones, delay);
    card.classList.toggle('off', !zones[index].enabled);
    overnight.hidden = !zoneIsOvernight(zones[index]);
  };

  const card = document.createElement('div');
  card.className = 'zone';
  card.classList.toggle('off', !zone.enabled);

  // Name + on/off + remove
  const top = document.createElement('div');
  top.className = 'zone-top';
  const label = document.createElement('input');
  label.className = 'zone-label';
  label.placeholder = 'Name (e.g. Team meeting)';
  label.value = zone.label || '';
  label.maxLength = 40;
  label.addEventListener('input', () => update({ label: label.value.trim() }, 500));

  const sw = document.createElement('label');
  sw.className = 'switch';
  sw.title = 'Zone on/off';
  const swInput = document.createElement('input');
  swInput.type = 'checkbox';
  swInput.checked = zone.enabled;
  swInput.setAttribute('aria-label', 'Zone on');
  swInput.addEventListener('change', () => update({ enabled: swInput.checked }));
  sw.append(swInput, document.createElement('span'));

  const remove = document.createElement('button');
  remove.className = 'zone-remove';
  remove.textContent = '×';
  remove.title = 'Remove zone';
  remove.addEventListener('click', () => {
    saveZones(settings.zones.filter((_, i) => i !== index));
    document.activeElement?.blur();
    renderZones();
  });
  top.append(label, sw, remove);

  // Time range
  const times = document.createElement('div');
  times.className = 'zone-times';
  const start = document.createElement('input');
  start.type = 'time';
  start.value = zone.start;
  start.setAttribute('aria-label', 'Starts at');
  const end = document.createElement('input');
  end.type = 'time';
  end.value = zone.end;
  end.setAttribute('aria-label', 'Ends at');
  const to = document.createElement('span');
  to.textContent = 'to';
  const overnight = document.createElement('span');
  overnight.className = 'overnight';
  overnight.textContent = '(ends next day)';
  overnight.hidden = !zoneIsOvernight(zone);
  start.addEventListener('change', () => start.value && update({ start: start.value }));
  end.addEventListener('change', () => end.value && update({ end: end.value }));
  times.append(start, to, end, overnight);

  // Weekdays
  const days = document.createElement('div');
  days.className = 'zone-days';
  for (const day of ZONE_DAY_ORDER) {
    const b = document.createElement('button');
    b.textContent = zoneDayFmt.format(zoneDayDate(day));
    b.title = zoneDayLongFmt.format(zoneDayDate(day));
    b.setAttribute('aria-pressed', String(zone.days.includes(day)));
    b.addEventListener('click', () => {
      const current = settings.zones[index].days;
      const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
      b.setAttribute('aria-pressed', String(next.includes(day)));
      update({ days: next });
    });
    days.append(b);
  }

  card.append(top, times, days);
  return card;
}

$('#addZone').addEventListener('click', () => {
  const zone = {
    id: Date.now().toString(36),
    label: '',
    days: [1, 2, 3, 4, 5],
    start: '09:00',
    end: '10:00',
    enabled: true,
  };
  saveZones([...(settings.zones || []), zone]);
  renderZones();
  $('#zoneList .zone:last-child .zone-label')?.focus();
});

if (settings) renderZones(); // settings may have loaded before this script
