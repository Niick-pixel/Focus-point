// Stand visuals: an animated side-view figure, a pelvic-floor diagram and a standing desk.
// Everything is drawn procedurally into inline SVG each frame — no image assets.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const rad = (deg) => (deg * Math.PI) / 180;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.append(node);
    return node;
  }

  // ---------------------------------------------------------------------------
  // Figure: side view, facing right. Pose parameters:
  //   squat 0..1   knees bend, hips sit back
  //   heel  0..1   rise onto the toes
  //   tilt -1..1   pelvic tilt (-1 = tuck tailbone under, +1 = tip it back)
  //   swayX, swayY -1..1  hip circles
  //   march -1..1  +: near knee up, -: far knee up
  //   arms  'hang' | 'forward' | 'hips'
  //   reach 0..1   how far the arms come forward (for 'forward')
  //   floor -0.3..1  pelvic floor lift (drives the glow at the pelvis)
  // ---------------------------------------------------------------------------
  const L = { shin: 108, thigh: 110, torso: 126, upper: 66, fore: 60, head: 19 };
  const GROUND = 408;

  class Figure {
    constructor(svg) {
      this.svg = svg;
      svg.setAttribute('viewBox', '0 0 300 440');
      const defs = el('defs', {}, svg);
      const glow = el('radialGradient', { id: 'pelvisGlow' }, defs);
      el('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.95' }, glow);
      el('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0' }, glow);

      el('ellipse', { cx: 160, cy: GROUND + 6, rx: 78, ry: 7, class: 'fig-shadow' }, svg);
      this.far = this.#limbSet('fig-far');
      this.halo = el('circle', { r: 46, fill: 'url(#pelvisGlow)', opacity: 0 }, svg);
      this.torso = el('path', { class: 'fig-torso' }, svg);
      this.near = this.#limbSet('fig-near');
      this.pelvis = el('ellipse', { rx: 23, ry: 16, class: 'fig-pelvis' }, svg);
      this.floorArc = el('path', { class: 'fig-floor' }, svg);
      this.head = el('circle', { r: L.head, class: 'fig-head' }, svg);
      this.pose = Figure.neutral();
      this.armW = { hang: 1, forward: 0, hips: 0 }; // blended so arm changes glide
    }

    static neutral() {
      return { squat: 0, heel: 0, tilt: 0, swayX: 0, swayY: 0, march: 0, arms: 'hang', reach: 0, floor: 0 };
    }

    #limbSet(cls) {
      const g = el('g', { class: cls }, this.svg);
      return {
        thigh: el('line', {}, g), shin: el('line', {}, g), foot: el('line', {}, g),
        upper: el('line', {}, g), fore: el('line', {}, g),
      };
    }

    static #line(node, a, b) {
      node.setAttribute('x1', a[0].toFixed(1)); node.setAttribute('y1', a[1].toFixed(1));
      node.setAttribute('x2', b[0].toFixed(1)); node.setAttribute('y2', b[1].toFixed(1));
    }

    /** Smoothly move toward a target pose (k = 0..1 per frame). */
    ease(target, k = 0.18) {
      const p = this.pose;
      for (const key of ['squat', 'heel', 'tilt', 'swayX', 'swayY', 'march', 'reach', 'floor']) {
        p[key] = lerp(p[key], target[key] ?? 0, k);
      }
      const want = target.arms || 'hang';
      for (const mode of Object.keys(this.armW)) this.armW[mode] = lerp(this.armW[mode], mode === want ? 1 : 0, k * 0.8);
      this.draw();
    }

    draw() {
      const p = this.pose;
      // Supporting leg: from the ankle up.
      const ankleX = 142;
      const ankle = [ankleX, GROUND - 10 - p.heel * 22];
      const shinA = rad(p.squat * 40);
      const knee = [ankle[0] + L.shin * Math.sin(shinA), ankle[1] - L.shin * Math.cos(shinA)];
      const thighA = rad(p.squat * 82);
      let hip = [knee[0] - L.thigh * Math.sin(thighA), knee[1] - L.thigh * Math.cos(thighA)];
      hip = [hip[0] + p.swayX * 12, hip[1] + p.swayY * 5];

      // Marching: one leg hangs from the hip with the thigh lifted.
      const legFromHip = (lift, dx) => {
        const a = rad(lift * 78);
        const k = [hip[0] + dx + L.thigh * Math.sin(a), hip[1] + L.thigh * Math.cos(a)];
        const s = rad(-lift * 12);
        const an = [k[0] + L.shin * Math.sin(s), k[1] + L.shin * Math.cos(s)];
        return { knee: k, ankle: an, toe: [an[0] + 30, an[1] + 2 - lift * 4] };
      };
      const standingLeg = (dx) => ({
        knee: [knee[0] + dx, knee[1]],
        ankle: [ankle[0] + dx, ankle[1]],
        toe: [ankle[0] + dx + 32, GROUND - 1],
      });
      const nearLeg = p.march > 0.02 ? legFromHip(p.march, 0) : standingLeg(0);
      const farLeg = p.march < -0.02 ? legFromHip(-p.march, 7) : standingLeg(7);

      // Torso leans forward in a squat; pelvic tilt adds a little.
      const lean = rad(p.squat * 30 + p.tilt * 5 - p.swayX * 3);
      const shoulder = [hip[0] + L.torso * Math.sin(lean), hip[1] - L.torso * Math.cos(lean)];
      const headC = [shoulder[0] + 26 * Math.sin(lean + rad(6)), shoulder[1] - 26 * Math.cos(lean) - 6];

      // Arms
      const armFor = (mode, dx) => {
        const sh = [shoulder[0] + dx, shoulder[1] + 6];
        if (mode === 'hips') {
          return { elbow: [sh[0] - 30, sh[1] + 46], hand: [hip[0] + 6 + dx, hip[1] - 14] };
        }
        const reach = mode === 'forward' ? p.reach : 0;
        const a = rad(6 + reach * 78) + lean * 0.4;
        const elbow = [sh[0] + L.upper * Math.sin(a), sh[1] + L.upper * Math.cos(a)];
        const b = a + rad(8 + reach * 6);
        return { elbow, hand: [elbow[0] + L.fore * Math.sin(b), elbow[1] + L.fore * Math.cos(b)] };
      };
      const blendArm = (dx) => {
        const total = Object.values(this.armW).reduce((a, b) => a + b, 0) || 1;
        const out = { elbow: [0, 0], hand: [0, 0] };
        for (const [mode, w] of Object.entries(this.armW)) {
          const a = armFor(mode, dx);
          for (const j of ['elbow', 'hand']) {
            out[j][0] += (a[j][0] * w) / total;
            out[j][1] += (a[j][1] * w) / total;
          }
        }
        return out;
      };
      const nearArm = blendArm(0);
      const farArm = blendArm(6);

      // Draw legs
      for (const [set, leg, dx] of [[this.far, farLeg, 7], [this.near, nearLeg, 0]]) {
        Figure.#line(set.thigh, [hip[0] + dx, hip[1]], leg.knee);
        Figure.#line(set.shin, leg.knee, leg.ankle);
        Figure.#line(set.foot, [leg.ankle[0] - 8, leg.ankle[1] + 4], leg.toe);
      }
      for (const [set, arm, dx] of [[this.far, farArm, 6], [this.near, nearArm, 0]]) {
        Figure.#line(set.upper, [shoulder[0] + dx, shoulder[1] + 6], arm.elbow);
        Figure.#line(set.fore, arm.elbow, arm.hand);
      }

      // Torso: a soft tapered capsule from pelvis to shoulders.
      this.torso.setAttribute('d', `M${hip[0].toFixed(1)},${hip[1].toFixed(1)} L${shoulder[0].toFixed(1)},${shoulder[1].toFixed(1)}`);
      this.head.setAttribute('cx', headC[0].toFixed(1));
      this.head.setAttribute('cy', headC[1].toFixed(1));

      const tiltDeg = (p.tilt * 16 + p.squat * 22).toFixed(1);
      this.pelvis.setAttribute('cx', hip[0].toFixed(1));
      this.pelvis.setAttribute('cy', (hip[1] + 2).toFixed(1));
      this.pelvis.setAttribute('transform', `rotate(${tiltDeg} ${hip[0].toFixed(1)} ${(hip[1] + 2).toFixed(1)})`);

      // Pelvic floor: a small hammock under the pelvis that lifts with the contraction.
      const lift = clamp(p.floor, -0.3, 1);
      const sag = 9 - lift * 11;
      const fx = hip[0], fy = hip[1] + 20;
      this.floorArc.setAttribute('d', `M${(fx - 15).toFixed(1)},${fy.toFixed(1)} Q${fx.toFixed(1)},${(fy + sag).toFixed(1)} ${(fx + 15).toFixed(1)},${fy.toFixed(1)}`);
      this.floorArc.setAttribute('transform', `rotate(${tiltDeg} ${fx.toFixed(1)} ${(hip[1] + 2).toFixed(1)})`);
      this.floorArc.style.opacity = String(0.45 + 0.55 * clamp(lift));
      this.halo.setAttribute('cx', fx.toFixed(1));
      this.halo.setAttribute('cy', (hip[1] + 6).toFixed(1));
      this.halo.setAttribute('opacity', (clamp(lift) * 0.85).toFixed(2));
    }
  }

  // ---------------------------------------------------------------------------
  // Pelvic floor diagram: a frontal, simplified pelvis. The pelvic floor is the
  // hammock of muscle between the sit bones; it rises and glows as you lift.
  // ---------------------------------------------------------------------------
  class PelvisDiagram {
    constructor(svg) {
      this.svg = svg;
      svg.setAttribute('viewBox', '0 0 320 260');
      const defs = el('defs', {}, svg);
      const grad = el('linearGradient', { id: 'floorGrad', x1: '0', x2: '0', y1: '0', y2: '1' }, defs);
      el('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.9' }, grad);
      el('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.25' }, grad);
      const blur = el('filter', { id: 'floorBlur', x: '-30%', y: '-80%', width: '160%', height: '260%' }, defs);
      el('feGaussianBlur', { stdDeviation: '9' }, blur);

      // Pelvic bones (stylized): two iliac wings, the sacrum, the pubic arch and sit bones.
      const bones = el('g', { class: 'pv-bones' }, svg);
      el('path', { d: 'M160 52 C120 40 72 34 44 52 C30 62 30 92 50 118 C66 140 92 150 108 172' }, bones);
      el('path', { d: 'M160 52 C200 40 248 34 276 52 C290 62 290 92 270 118 C254 140 228 150 212 172' }, bones);
      el('path', { d: 'M142 60 C140 90 146 112 160 128 C174 112 180 90 178 60', class: 'pv-sacrum' }, bones);
      el('path', { d: 'M108 172 C122 196 142 206 160 206 C178 206 198 196 212 172', class: 'pv-arch' }, bones);
      this.sitL = el('circle', { cx: 104, cy: 184, r: 7, class: 'pv-sit' }, bones);
      this.sitR = el('circle', { cx: 216, cy: 184, r: 7, class: 'pv-sit' }, bones);

      this.glow = el('path', { class: 'pv-glow', filter: 'url(#floorBlur)' }, svg);
      this.fibers = [0, 1, 2].map((i) => el('path', { class: `pv-fiber pv-fiber-${i}` }, svg));
      this.floor = el('path', { class: 'pv-floor', fill: 'url(#floorGrad)' }, svg);

      this.arrows = el('g', { class: 'pv-arrows' }, svg);
      for (const x of [134, 160, 186]) el('path', { d: `M${x - 7} 0 L${x} -8 L${x + 7} 0` }, this.arrows);
      this.label = el('text', { x: 160, y: 250, 'text-anchor': 'middle', class: 'pv-label' }, svg);
      this.label.textContent = 'Pelvic floor';
      this.lift = 0;
      this.t = 0;
    }

    /** lift: -0.3 (fully relaxed / descended) .. 1 (fully lifted) */
    set(targetLift, dt = 1 / 60) {
      this.lift = lerp(this.lift, clamp(targetLift, -0.3, 1), 0.14);
      this.t += dt;
      const lift = this.lift;
      const baseY = 190;
      const sag = 42 - lift * 50;              // released: deep hammock; lifted: almost flat, slightly domed
      const thick = 10 + (1 - clamp(lift)) * 4;
      const mid = baseY + sag;
      const top = `M104 ${baseY} C136 ${mid} 184 ${mid} 216 ${baseY}`;
      const bottom = `C184 ${mid + thick} 136 ${mid + thick} 104 ${baseY}`;
      this.floor.setAttribute('d', `${top} ${bottom} Z`);
      this.glow.setAttribute('d', `${top} ${bottom} Z`);
      this.glow.style.opacity = String(0.15 + 0.75 * clamp(lift));
      this.fibers.forEach((f, i) => {
        const o = (i - 1) * 4;
        f.setAttribute('d', `M${112 + i * 6} ${baseY + 2 + o * 0.2} C140 ${mid + 4 + o} 180 ${mid + 4 + o} ${208 - i * 6} ${baseY + 2 + o * 0.2}`);
      });
      const arrowsOn = clamp((lift - 0.25) * 2);
      this.arrows.setAttribute('transform', `translate(0 ${(mid - 18 - arrowsOn * 6 - Math.sin(this.t * 4) * 2).toFixed(1)})`);
      this.arrows.style.opacity = String(arrowsOn);
      this.sitL.style.opacity = this.sitR.style.opacity = String(0.5 + 0.5 * clamp(lift));
    }
  }

  // ---------------------------------------------------------------------------
  // Standing desk: the desktop glides up or down in a loop, with a soft chevron cue.
  // ---------------------------------------------------------------------------
  class Desk {
    constructor(svg, direction = 'up') {
      this.svg = svg;
      this.direction = direction;
      svg.setAttribute('viewBox', '0 0 320 300');
      el('line', { x1: 30, y1: 270, x2: 290, y2: 270, class: 'desk-floor' }, svg);
      el('rect', { x: 78, y: 262, width: 164, height: 8, rx: 4, class: 'desk-base' }, svg);
      this.outer = el('rect', { x: 150, width: 20, rx: 4, class: 'desk-column' }, svg);
      this.inner = el('rect', { x: 153, width: 14, rx: 3, class: 'desk-column-inner' }, svg);
      this.top = el('g', {}, svg);
      el('rect', { x: 40, y: -12, width: 240, height: 12, rx: 6, class: 'desk-top' }, this.top);
      el('rect', { x: 126, y: -86, width: 92, height: 60, rx: 7, class: 'desk-monitor' }, this.top);
      el('rect', { x: 166, y: -26, width: 12, height: 14, rx: 2, class: 'desk-stand' }, this.top);
      el('rect', { x: 70, y: -18, width: 44, height: 6, rx: 3, class: 'desk-keyboard' }, this.top);
      this.chev = el('g', { class: 'desk-chevrons' }, svg);
      for (let i = 0; i < 3; i++) el('path', { d: `M-10 ${i * 12} L0 ${i * 12 - 10} L10 ${i * 12}` }, this.chev);
      this.t0 = performance.now();
    }

    frame(now) {
      const cycle = 3.6;
      const t = ((now - this.t0) / 1000) % cycle;
      const move = Math.min(1, t / 2.2);
      const e = move < 0.5 ? 4 * move ** 3 : 1 - (-2 * move + 2) ** 3 / 2; // ease in-out
      const k = this.direction === 'up' ? e : 1 - e;
      const y = lerp(170, 88, k);           // desktop height
      const fade = t > cycle - 0.5 ? (cycle - t) / 0.5 : Math.min(1, t / 0.3);
      this.top.setAttribute('transform', `translate(0 ${y.toFixed(1)})`);
      this.outer.setAttribute('y', '170');
      this.outer.setAttribute('height', '92');
      this.inner.setAttribute('y', y.toFixed(1));
      this.inner.setAttribute('height', (182 - y).toFixed(1));
      this.chev.setAttribute('transform', `translate(262 ${this.direction === 'up' ? 150 - k * 30 : 110 + (1 - k) * 30}) ${this.direction === 'up' ? '' : 'scale(1 -1)'}`);
      this.chev.style.opacity = String(0.9 * fade);
      this.svg.style.opacity = String(0.35 + 0.65 * fade);
    }
  }

  window.StandVisuals = { Figure, PelvisDiagram, Desk, clamp, lerp };
})();
