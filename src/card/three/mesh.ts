// The pure part of the 3D view: a prism from the scene module (plan x, y in cm, z up) as flat-shaded triangles in
// three.js' frame. Plan x stays x, plan z (up) is y, and plan y (down the page, south) is z, which points at a camera
// standing south of the house: east is on the right, as on the plan, and nothing is mirrored.
// A layout is untrusted input (CLAUDE.md finding 1): a base that cannot be drawn makes no triangles and never throws.
import { ShapeUtils, Vector2 } from "three";

type Pt = [number, number];
export interface Triangles { position: number[]; normal: number[] }

/** Past this (cm) a coordinate is not a house; it also keeps every float32 and every product finite. */
const LIMIT = 1e7;

const finitePt = (p: unknown): p is Pt => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= LIMIT && Math.abs(p[1]) <= LIMIT;

/** Appends one triangle with the winding that faces `want` (a unit vector), and that vector as its normal at each corner. */
function emit(out: Triangles, a: number[], b: number[], c: number[], want: number[]): void {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
  for (const p of flip ? [a, c, b] : [a, b, c]) { out.position.push(p[0], p[1], p[2]); out.normal.push(want[0], want[1], want[2]); }
}


/** The parts of a convex polygon `poly` that lie on the left of the line a->b (`keep` 1) or on its right (`keep` -1). */
function halve(poly: Pt[], a: Pt, b: Pt, keep: number): Pt[] {
  const side = (q: Pt) => keep * ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]));
  const res: Pt[] = [];
  poly.forEach((u, i) => {
    const v = poly[(i + 1) % poly.length], su = side(u), sv = side(v);
    if (su >= 0) res.push(u);
    if ((su > 0 && sv < 0) || (su < 0 && sv > 0)) { const t = su / (su - sv); res.push([u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]); }
  });
  return res;
}
/** A convex polygon (a triangle) minus convex holes, as convex pieces: each hole edge splits off what lies outside it. */
function minus(tri: Pt[], holes: Pt[][]): Pt[][] {
  let pieces: Pt[][] = [tri];
  for (const h of holes) {
    const ccw = h.reduce((t, c, n) => { const d = h[(n + 1) % h.length]; return t + c[0] * d[1] - d[0] * c[1]; }, 0) > 0 ? 1 : -1; // inside lies on this side of every edge
    const next: Pt[][] = [];
    for (const piece of pieces) {
      let rest = piece;
      for (let i = 0; i < h.length && rest.length >= 3; i++) {
        const a = h[i], b = h[(i + 1) % h.length], away = halve(rest, a, b, -ccw);
        if (away.length >= 3) next.push(away);
        rest = halve(rest, a, b, ccw);
      }
    }
    pieces = next;
  }
  return pieces.filter((q) => Math.abs(q.reduce((t, c, n) => { const d = q[(n + 1) % q.length]; return t + c[0] * d[1] - d[0] * c[1]; }, 0)) > 1e-6);
}
/** Parameters [t0, t1] of the segment a->b along which a point is inside the polygon `poly`, by crossing the polygon's own edges. */
function within(a: Pt, b: Pt, poly: Pt[]): [number, number][] {
  const ts = [0, 1], dx = b[0] - a[0], dy = b[1] - a[1];
  poly.forEach((c, i) => {
    const d = poly[(i + 1) % poly.length], ex = d[0] - c[0], ey = d[1] - c[1], den = dx * ey - dy * ex;
    if (!den) return;
    const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den, u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  });
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const m = (ts[i] + ts[i + 1]) / 2, q: Pt = [a[0] + dx * m, a[1] + dy * m];
    if (ts[i + 1] - ts[i] < 1e-9 || !contains(poly, q) || nearEdge(poly, q)) continue; // on the base's own edge: its outer wall stands there
    out.push([ts[i], ts[i + 1]]);
  }
  return out;
}
const contains = (poly: Pt[], q: Pt) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const nearEdge = (poly: Pt[], q: Pt) => poly.some((a, k) => { const b = poly[(k + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy)) < 0.5; });
/** Parameters of the segment a->b of a base edge that lie outside every hole (the base's outer wall is not drawn where a hole opens it). */
function outside(a: Pt, b: Pt, holes: Pt[][]): [number, number][] {
  let spans: [number, number][] = [[0, 1]];
  for (const h of holes) {
    const ccw = h.reduce((t, c, n) => { const d = h[(n + 1) % h.length]; return t + c[0] * d[1] - d[0] * c[1]; }, 0) > 0 ? 1 : -1;
    let lo = 0, hi = 1, empty = false;
    for (let i = 0; i < h.length && !empty; i++) { // the part of the segment inside the hole: clip by each edge's inside half-plane
      const c = h[i], d = h[(i + 1) % h.length], f0 = ccw * ((d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0])), f1 = ccw * ((d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]));
      if (f0 <= 0 && f1 <= 0) { empty = true; break; }
      if (f0 < 0) lo = Math.max(lo, f0 / (f0 - f1)); else if (f1 < 0) hi = Math.min(hi, f0 / (f0 - f1));
    }
    if (empty || lo >= hi) continue;
    spans = spans.flatMap(([s0, s1]) => { const r: [number, number][] = []; if (lo > s0) r.push([s0, Math.min(lo, s1)]); if (hi < s1) r.push([Math.max(hi, s0), s1]); return r.filter(([u, v]) => v > u); });
  }
  return spans;
}

/**
 * Adds the prism over `base` from `z0` to `z1` to `out`: a top cap, a bottom cap and one quad per edge, each facing
 * outward whichever way the base is wound. A concave base is triangulated (earcut, from three). Returns whether
 * anything was added; a base with fewer than three distinct points, a line, a non-finite or huge coordinate, or a
 * flat height adds nothing. `holes` (0.26.1, a stairwell) are polygons inside the base that the prism does not fill: each is
 * dropped when it cannot be drawn, and its edges get walls that face into the hole.
 */
export function prismTriangles(base: unknown, z0: number, z1: number, out: Triangles, holes: unknown = undefined): boolean {
  if (!Array.isArray(base) || !(typeof z0 === "number" && typeof z1 === "number" && Math.abs(z0) <= LIMIT && Math.abs(z1) <= LIMIT && z1 > z0)) return false;
  if (!base.every(finitePt)) return false;
  const p: Pt[] = [];
  for (const q of base as Pt[]) { const l = p[p.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) p.push(q); }
  while (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  if (p.length < 3) return false;
  // Shoelace in plan coordinates (y down): positive is clockwise on the page.
  const area = p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
  if (!(Math.abs(area) > 1e-9)) return false;
  // Holes (a stairwell) are convex polygons that may lie inside the base, touch its edge or cross it; a hole that is not convex is ignored.
  const hs: Pt[][] = [];
  if (Array.isArray(holes)) for (const h of holes) {
    if (!Array.isArray(h) || !h.every(finitePt)) continue;
    const q: Pt[] = [];
    for (const v of h as Pt[]) { const l = q[q.length - 1]; if (!l || l[0] !== v[0] || l[1] !== v[1]) q.push(v); }
    while (q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop();
    if (q.length < 3) continue;
    const turn = q.map((a, i) => { const b = q[(i + 1) % q.length], c = q[(i + 2) % q.length]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); });
    if (turn.every((t) => t >= 0) || turn.every((t) => t <= 0)) hs.push(q);
  }
  let faces: number[][];
  try { faces = ShapeUtils.triangulateShape(p.map((q) => new Vector2(q[0], q[1])), []); } catch { return false; }
  const before = out.position.length;
  for (const [i, j, k] of faces) {
    if (p[i] === undefined || p[j] === undefined || p[k] === undefined) continue;
    const at = (q: Pt, z: number) => [q[0], z, q[1]];
    for (const piece of minus([p[i], p[j], p[k]], hs)) for (let n = 1; n + 1 < piece.length; n++) {
      emit(out, at(piece[0], z1), at(piece[n], z1), at(piece[n + 1], z1), [0, 1, 0]);
      emit(out, at(piece[0], z0), at(piece[n], z0), at(piece[n + 1], z0), [0, -1, 0]);
    }
  }
  const quad = (a: Pt, b: Pt, want: number[]) => {
    const A = [a[0], z0, a[1]], B = [b[0], z0, b[1]], C = [b[0], z1, b[1]], D = [a[0], z1, a[1]];
    emit(out, A, B, C, want);
    emit(out, A, C, D, want);
  };
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (!(len > 0)) return;
    // Outward is (dy, -dx) for a positive area, the other way for a negative one.
    const s = area > 0 ? 1 : -1, want = [(s * dy) / len, 0, (-s * dx) / len];
    for (const [t0, t1] of outside(a, b, hs)) quad([a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1], want);
  });
  // The walls of each hole stand where the hole lies inside the base, and face into the hole.
  for (const h of hs) {
    const ha = h.reduce((t, c, n) => { const d = h[(n + 1) % h.length]; return t + c[0] * d[1] - d[0] * c[1]; }, 0);
    h.forEach((a, i) => {
      const b = h[(i + 1) % h.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (!(len > 0)) return;
      const s = ha > 0 ? -1 : 1, want = [(s * dy) / len, 0, (-s * dx) / len];
      for (const [t0, t1] of within(a, b, p)) quad([a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1], want);
    });
  }
  if (out.position.length === before) return false;
  return true;
}

/**
 * S35.5: the loft from the convex ring `base` at `z0` to the ring `top` at `z1`, same number of points, as flat-shaded triangles:
 * a lid each and two triangles per side, each facing out of the ring whichever way it is wound. Returns whether anything was
 * added; rings of unequal length, fewer than three points, a non-finite or huge coordinate, or a flat height add nothing.
 * A car's greenhouse: the windscreen and rear glass slope in toward the roof.
 */
export function loftTriangles(base: unknown, top: unknown, z0: number, z1: number, out: Triangles): boolean {
  if (!Array.isArray(base) || !Array.isArray(top) || base.length < 3 || top.length !== base.length || !base.every(finitePt) || !top.every(finitePt)) return false;
  if (!(typeof z0 === "number" && typeof z1 === "number" && Math.abs(z0) <= LIMIT && Math.abs(z1) <= LIMIT && z1 > z0)) return false;
  const b = base as Pt[], t = top as Pt[], n = b.length, before = out.position.length;
  const at = (q: Pt, z: number) => [q[0], z, q[1]];
  const mid = (r: Pt[]): Pt => [r.reduce((s, q) => s + q[0], 0) / n, r.reduce((s, q) => s + q[1], 0) / n];
  const cb = mid(b), ct = mid(t);
  for (let i = 1; i + 1 < n; i++) {
    emit(out, at(t[0], z1), at(t[i], z1), at(t[i + 1], z1), [0, 1, 0]);
    emit(out, at(b[0], z0), at(b[i], z0), at(b[i + 1], z0), [0, -1, 0]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = at(b[i], z0), c = at(b[j], z0), d = at(t[j], z1), e = at(t[i], z1);
    // The side faces away from the middle of the ring: the way from the centre to the edge's middle, in the plan, picks the sign.
    const ox = (b[i][0] + b[j][0] + t[i][0] + t[j][0]) / 4 - (cb[0] + ct[0]) / 2, oy = (b[i][1] + b[j][1] + t[i][1] + t[j][1]) / 4 - (cb[1] + ct[1]) / 2;
    for (const tri of [[a, c, d], [a, d, e]]) {
      const u = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]], v = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]];
      const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0], len = Math.hypot(nx, ny, nz);
      if (!(len > 1e-9)) continue;
      const s = nx * ox + nz * oy < 0 ? -1 : 1; // three's z is the plan's y
      emit(out, tri[0], tri[1], tri[2], [(s * nx) / len, (s * ny) / len, (s * nz) / len]);
    }
  }
  return out.position.length > before;
}
