// Stats tab: a week of rest at a glance. Uses $, $$ and api from settings.js.
(() => {
  const DAY = 86400000;
  const PLOT_H = 120;           // px, bar area (labels sit above/below it)
  const MIN_SCALE = 5 * 60000;  // keep tiny values from filling the chart

  let weekOffset = 0; // 0 = this week, -1 = last week, ...
  let days = {};

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const empty = { restMs: 0, workMs: 0, completed: 0, skipped: 0, snoozed: 0, standMs: 0, stands: 0 };

  function fmtDur(ms) {
    const min = Math.round(ms / 60000);
    if (ms > 0 && min === 0) return `${Math.max(1, Math.round(ms / 1000))} s`;
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  }

  function startOfWeek(offset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const mondayShift = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - mondayShift + offset * 7);
    return d;
  }

  function weekDays(offset) {
    const start = startOfWeek(offset);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return {
        date,
        key: keyOf(date),
        isToday: date.getTime() === today.getTime(),
        isFuture: date > today,
        ...empty,
        ...(days[keyOf(date)] || {}),
      };
    });
  }

  const sum = (list, field) => list.reduce((a, d) => a + d[field], 0);

  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const longFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  const rangeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

  function weekTitle(list) {
    if (weekOffset === 0) return 'This week';
    if (weekOffset === -1) return 'Last week';
    return `${rangeFmt.format(list[0].date)} – ${rangeFmt.format(list[6].date)}`;
  }

  function renderDelta(list) {
    const el = $('#restDelta');
    // Compare like with like: this week so far vs the same days last week.
    const prev = weekDays(weekOffset - 1);
    const upto = weekOffset === 0 ? list.findIndex((d) => d.isToday) + 1 : 7;
    const now = sum(list.slice(0, upto), 'restMs');
    const before = sum(prev.slice(0, upto), 'restMs');
    if (!before && !now) { el.textContent = ''; return; }
    if (!before) { el.textContent = 'No rest logged the week before'; return; }
    const diff = now - before;
    const span = weekOffset === 0 ? 'same point last week' : 'the week before';
    if (Math.abs(diff) < 60000) el.textContent = `About the same as ${span}`;
    else el.textContent = `${diff > 0 ? '▲' : '▼'} ${fmtDur(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${span}`;
  }

  function describe(d) {
    const parts = [`${fmtDur(d.restMs)} rested`, `${d.completed} break${d.completed === 1 ? '' : 's'}`];
    if (d.skipped + d.snoozed) parts.push(`${d.skipped + d.snoozed} skipped or snoozed`);
    if (d.standMs) parts.push(`${fmtDur(d.standMs)} standing`);
    return `${longFmt.format(d.date)} · ${parts.join(' · ')}`;
  }

  function renderChart(list) {
    const bars = $('#bars');
    const labels = $('#days');
    bars.innerHTML = '';
    labels.innerHTML = '';
    const max = Math.max(MIN_SCALE, ...list.map((d) => d.restMs));
    const maxIdx = list.reduce((best, d, i) => (d.restMs > list[best].restMs ? i : best), 0);

    list.forEach((d, i) => {
      const col = document.createElement('button');
      col.className = 'col';
      col.disabled = d.isFuture;
      col.setAttribute('aria-label', d.isFuture ? longFmt.format(d.date) : describe(d));
      const h = d.restMs ? Math.max(3, (d.restMs / max) * PLOT_H) : 0;

      // Direct labels only where they matter: today and the best day.
      if (d.restMs && (d.isToday || i === maxIdx)) {
        const v = document.createElement('span');
        v.className = 'val';
        v.textContent = fmtDur(d.restMs);
        v.style.bottom = `${h + 4}px`;
        col.append(v);
      }
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.height = `${h}px`;
      col.append(bar);

      if (!d.isFuture) {
        const show = () => showTip(col, d);
        col.addEventListener('mouseenter', show);
        col.addEventListener('focus', show);
        col.addEventListener('mouseleave', hideTip);
        col.addEventListener('blur', hideTip);
      }
      bars.append(col);

      const lab = document.createElement('span');
      lab.textContent = weekdayFmt.format(d.date);
      lab.classList.toggle('today', d.isToday);
      lab.classList.toggle('future', d.isFuture);
      labels.append(lab);
    });
  }

  function showTip(col, d) {
    const tip = $('#tooltip');
    tip.textContent = describe(d);
    tip.hidden = false;
    const chart = $('#chart').getBoundingClientRect();
    const c = col.getBoundingClientRect();
    const w = tip.offsetWidth;
    const x = Math.min(Math.max(c.left - chart.left + c.width / 2 - w / 2, 0), chart.width - w);
    tip.style.left = `${x}px`;
  }

  function hideTip() {
    $('#tooltip').hidden = true;
  }

  function renderTable(list) {
    const body = $('#statsTable tbody');
    body.innerHTML = '';
    for (const d of list) {
      const tr = document.createElement('tr');
      const cells = d.isFuture
        ? [weekdayFmt.format(d.date), '—', '—', '—', '—', '—']
        : [weekdayFmt.format(d.date), fmtDur(d.restMs), d.completed, d.skipped + d.snoozed, fmtDur(d.standMs), fmtDur(d.workMs)];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.append(td);
      }
      body.append(tr);
    }
  }

  function renderTiles(list) {
    const rest = sum(list, 'restMs');
    const work = sum(list, 'workMs');
    $('#tileBreaks').textContent = sum(list, 'completed');
    $('#tileSkipped').textContent = sum(list, 'skipped') + sum(list, 'snoozed');
    $('#tileScreen').textContent = fmtDur(work);
    $('#tileStand').textContent = fmtDur(sum(list, 'standMs'));
    $('#tileStands').textContent = sum(list, 'stands');
    $('#tileRatio').textContent = work >= 10 * 60000 ? `${fmtDur((rest / work) * 3600000)}` : '—';
  }

  async function render() {
    days = await api.getStats();
    const list = weekDays(weekOffset);
    const total = sum(list, 'restMs');
    $('#weekLabel').textContent = weekTitle(list);
    $('#restTotal').textContent = fmtDur(total);
    $('#restLabel').textContent = weekOffset === 0 ? 'rested this week' : 'rested that week';
    $('#nextWeek').disabled = weekOffset >= 0;
    renderDelta(list);
    renderChart(list);
    renderTable(list);
    renderTiles(list);
  }

  const visible = () => $('.panel[data-panel="stats"]').classList.contains('active');

  $('#prevWeek').addEventListener('click', () => { weekOffset -= 1; render(); });
  $('#nextWeek').addEventListener('click', () => { if (weekOffset < 0) { weekOffset += 1; render(); } });
  $('#tableToggle').addEventListener('click', () => {
    const table = $('#statsTable');
    table.hidden = !table.hidden;
    $('#tableToggle').textContent = table.hidden ? 'View as table' : 'Hide table';
  });
  $('#clearStats').addEventListener('click', async () => {
    if (!confirm('Delete all of your rest history? This cannot be undone.')) return;
    await api.clearStats();
  });

  document.addEventListener('tabchange', (e) => { if (e.detail === 'stats') render(); });
  api.onStats(() => visible() && render());
  setInterval(() => visible() && render(), 60000); // screen time keeps growing
  if (visible()) render();
})();
