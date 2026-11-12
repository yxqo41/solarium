/* Blob morph for the solarium menu: one clip-path traced every frame from
 * the smooth-union signed-distance field of two rounded boxes — the trigger
 * pill shrinking away and the menu panel growing out of it. Each edge of
 * both boxes runs on its own spring, so the leading edge travels softer than
 * the trailing ones and the shape reads as liquid rather than a scaling
 * rectangle. Technique adapted from the "Liquid glass toolbar menu" demo;
 * the metaball field, edge springs and outline tracer are ported directly.
 *
 * All geometry lives in one coordinate space (the stage's local pixels).
 * Edges are named L/R for the x bounds and T/B for the y bounds; an edge's
 * scalar `x` is its position on that axis regardless of which one it is.
 */

const N = 240;        // rays cast per outline
const SMOOTH = 22;    // metaball blend width, in stage pixels
const SEED = 4;       // half-size of the press-point seed the pill collapses to
const RC = 32;        // corner radius cap for the menu panel
const AXES = ['L', 'R', 'T', 'B'];

// The trigger pill (A) and the menu panel (B) are both plain rounded boxes;
// the union's signed distance is the smooth minimum of the two distances.
function sdBox(px, py, cx, cy, hx, hy, rc) {
  const dx = Math.abs(px - cx) - hx + rc;
  const dy = Math.abs(py - cy) - hy + rc;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rc;
}

function smoothMin(a, b) {
  const m = Math.max(SMOOTH - Math.abs(a - b), 0) / SMOOTH;
  return Math.min(a, b) - m * m * SMOOTH * 0.25;
}

function canon(rect) {
  return {
    L: rect.l ?? rect.left,
    R: rect.r ?? rect.right,
    T: rect.t ?? rect.top,
    B: rect.b ?? rect.bottom,
  };
}

// A spring edge: position x chasing target t under stiffness k and damping c.
function edge(x) {
  return { x, v: 0, t: x, k: 1, c: 1 };
}

export class LiquidMenuMorph {
  // pill  — the trigger's rect in stage coordinates
  // panel — the menu's final rect in the same space
  // press — the point the gesture started at, also in stage coordinates
  // leadV/leadH — which panel edge travels furthest ('T'/'B', 'L'/'R')
  constructor({ pill, panel, press, pillRadius, panelRadius, leadV, leadH }) {
    this.pillRadius = pillRadius;
    this.panelRadius = Math.min(panelRadius, RC);
    this.lead = { v: leadV, h: leadH };
    this.e = {};   // panel edges
    this.a = {};   // pill edges
    this.F = canon(panel);
    this.PR = canon(pill);
    this.P = { x: press.x, y: press.y };

    const seed = {
      L: this.P.x - SEED, R: this.P.x + SEED,
      T: this.P.y - SEED, B: this.P.y + SEED,
    };
    for (const k of AXES) {
      // Opening starts as the pill plus a seed dot; the panel edges grow out
      // to their targets while the pill edges collapse onto the press point.
      this.e[k] = edge(seed[k]);
      this.a[k] = edge(this.PR[k]);
    }
    this.seed = seed;
    this.closing = false;
    this.closeAt = 0;
  }

  // The reference's spring table: on open the leading edge is the soft one so
  // the shape leans into its travel direction; on close the horizontal edges
  // are stiff so the panel pinches back into the pill quickly.
  retarget(opening, panel = this.F) {
    this.closing = !opening;
    if (!opening) this.closeAt = performance.now();
    const { seed, lead, PR } = this;
    for (const k of AXES) {
      const axis = k === 'L' || k === 'R' ? 'h' : 'v';
      const e = this.e[k];
      const a = this.a[k];
      e.t = opening ? panel[k] : seed[k];
      a.t = opening ? seed[k] : PR[k];
      if (opening) {
        if (lead[axis] === k) {
          e.k = axis === 'v' ? 300 : 190;
          e.c = axis === 'v' ? 19 : 15;
        } else {
          e.k = 420;
          e.c = 30;
        }
        a.k = 240;
        a.c = 27;
      } else {
        e.k = axis === 'h' ? 480 : 250;
        e.c = axis === 'h' ? 34 : 26;
        a.k = 300;
        a.c = 30;
      }
    }
  }

  // Advance the springs. Returns true while the shape is still moving; the
  // caller keeps the frame loop alive on that answer. A dismissal that has
  // not settled within a second is finished anyway, matching the reference's
  // failsafe for a spring that never quite rests.
  step(dtMs) {
    const dt = Math.min(dtMs / 1000 || 0, 1 / 30);
    const steps = Math.max(1, Math.round(dt * 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const k of AXES) {
        for (const s of [this.e[k], this.a[k]]) {
          s.v += (-s.k * (s.x - s.t) - s.c * s.v) * h;
          s.x += s.v * h;
        }
      }
    }
    for (const k of AXES) {
      for (const s of [this.e[k], this.a[k]]) {
        if (Math.abs(s.v) > 0.05 || Math.abs(s.x - s.t) > 0.05) return true;
      }
    }
    return !(this.closing && performance.now() - this.closeAt > 1000);
  }

  // The signed distance of the union at a stage-local point.
  field(x, y) {
    const panelCx = (this.e.L.x + this.e.R.x) / 2;
    const panelCy = (this.e.T.x + this.e.B.x) / 2;
    const pillCx = (this.a.L.x + this.a.R.x) / 2;
    const pillCy = (this.a.T.x + this.a.B.x) / 2;
    const pillHx = Math.max((this.a.R.x - this.a.L.x) / 2, 1);
    const pillHy = Math.max((this.a.B.x - this.a.T.x) / 2, 1);
    const panelHx = Math.max((this.e.R.x - this.e.L.x) / 2, 1);
    const panelHy = Math.max((this.e.B.x - this.e.T.x) / 2, 1);
    const pill = sdBox(x, y, pillCx, pillCy, pillHx, pillHy,
      Math.min(this.pillRadius, pillHx, pillHy));
    const panel = sdBox(x, y, panelCx, panelCy, panelHx, panelHy,
      Math.min(this.panelRadius, panelHx, panelHy));
    return smoothMin(pill, panel);
  }

  // Ray-march the zero contour: N rays from the press point, each bisected to
  // the boundary, then joined as a quadratic-smoothed closed path — the same
  // tracer the reference uses, so the blob edge stays organic instead of
  // polygonal.
  outline() {
    const pts = [];
    const px = this.P.x;
    const py = this.P.y;
    for (let i = 0; i < N; i++) {
      const angle = i / N * Math.PI * 2;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      let t = 0;
      let prev = 0;
      for (let k = 0; k < 110; k++) {
        const d = this.field(px + ux * t, py + uy * t);
        if (d > 0) break;
        prev = t;
        t += Math.max(-d, 0.8);
      }
      let lo = prev;
      let hi = t;
      for (let j = 0; j < 5; j++) {
        const mid = (lo + hi) / 2;
        if (this.field(px + ux * mid, py + uy * mid) > 0) hi = mid;
        else lo = mid;
      }
      pts.push([px + ux * lo, py + uy * lo]);
    }
    const n = pts.length;
    const f = v => Math.round(v * 10) / 10;
    let d = `M${f((pts[n - 1][0] + pts[0][0]) / 2)} ${f((pts[n - 1][1] + pts[0][1]) / 2)}`;
    for (let q = 0; q < n; q++) {
      const p = pts[q];
      const r = pts[(q + 1) % n];
      d += `Q${f(p[0])} ${f(p[1])} ${f((p[0] + r[0]) / 2)} ${f((p[1] + r[1]) / 2)}`;
    }
    return d + 'Z';
  }
}
