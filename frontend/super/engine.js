// super/engine.js: the superellipse look drawn by an open-source graphics engine, three.js (r185, MIT,
// frontend/vendor/three; owner, 2026-10-12: "use an open source graphical engine", "everything at once").
//
// One WebGL canvas under the page draws everything you see of the diagram: the light behind the glass, the main
// super and the inner super, every super's pane of frosted glass (bubbles, windows, the project super, Super AI
// supers, the title), their ink edges and the iridescent sheen of the hovered or selected one, their soft shadows,
// every wire (with the flow of dots on hover), the lattice lines and every port sparkle. The page's elements stay
// where they are and keep doing everything they did (layout, scroll, wiring, text, forms): they only stop painting
// their own chrome (html.se-gl, super/glass.css). Each frame the engine reads where they are and draws them there.
// Without WebGL nothing changes: the CSS glass look stays.
//
//   window.SeEngine.ready     true once drawing
//   window.SeEngine.stop()    back to the CSS look
import * as THREE from "../vendor/three/three.module.min.js";

const html = document.documentElement;
const on = () => html.classList.contains("shape-se");
const O = () => window.PiOrbit || {};

// ---------------------------------------------------------------- shaders
// the light behind the glass: soft warm and cool glows drifting slowly (the same function lights the panes)
const LIGHT = `
uniform float uNight;                                                     // 0 by day, 1 by night (the visitor's own clock)
// sunshine through glass (owner, 2026-10-12: "make background so sunshines like this glasses", a photo of an evening
// sky): a cool grey-blue overcast above, a warm peach glow along a low horizon, a low sun to the right of the middle
// whose golden light rakes across the page in soft slanting rays, a light vignette; the panes show it through their
// frost (the same function lights them), so the sun shines in the glass
// where the sun is, in the page's uv (0,0 top left): low, to the right of the middle, drifting very slowly
vec2 sunAt(float t) { return mix(vec2(0.68 + 0.01 * sin(t * 0.02), 0.74 + 0.006 * sin(t * 0.03) - 0.035), vec2(0.74 + 0.006 * sin(t * 0.015), 0.20), uNight); }   // by night, the moon high on the right
// the light's own colour on the glass: gold by day, a cool silver by night
vec3 tint(vec3 warm) { return mix(warm, vec3(0.78, 0.85, 1.0) * (0.55 + 0.45 * dot(warm, vec3(0.333))), uNight); }
vec3 light(vec2 uv, float t) {
  float a = uRes.x / uRes.y;
  vec2 v = (uv - 0.5) * vec2(a, 1.0);
  float y = uv.y;                                                          // 0 at the top, 1 at the bottom
  // by day (less bright, owner, 2026-10-12: "make it less brighter"): a grey-blue overcast, a soft peach horizon
  vec3 sky = mix(vec3(0.77, 0.80, 0.84), vec3(0.87, 0.86, 0.85), smoothstep(0.0, 0.62, y));
  float hz = 0.74 + 0.006 * sin(t * 0.03);                                 // the horizon, low on the page
  float band = exp(-pow((y - hz) / 0.075, 2.0));
  vec3 c = mix(sky, vec3(0.95, 0.84, 0.71), 0.60 * band);                  // the peach glow along it
  c = mix(c, vec3(0.90, 0.85, 0.77), smoothstep(hz, 1.0, y) * 0.9);        // warm ground light below it
  // by night: a deep blue-grey sky, a faint cool band where the horizon is, a darker ground
  vec3 nsky = mix(vec3(0.17, 0.20, 0.27), vec3(0.25, 0.28, 0.35), smoothstep(0.0, 0.70, y));
  nsky = mix(nsky, vec3(0.33, 0.36, 0.44), 0.45 * band);
  nsky = mix(nsky, vec3(0.20, 0.21, 0.25), smoothstep(hz, 1.0, y) * 0.8);
  c = mix(c, nsky, uNight);
  // the low sun (by night the moon, high), drifting very slowly, and its glow
  vec2 sp = (sunAt(t) - 0.5) * vec2(a, 1.0);
  vec2 d = v - sp; float r = length(d);
  c += mix(vec3(1.0, 0.80, 0.52) * (0.12 * exp(-r * r / 0.012) + 0.09 * exp(-r / 0.32)),
           vec3(0.86, 0.90, 1.0) * (0.85 * (1.0 - smoothstep(0.022, 0.026, r)) + 0.16 * exp(-r * r / 0.01) + 0.07 * exp(-r / 0.30)), uNight);
  // rays fanning out of it, slanting across the page, breathing slowly (fainter, and fainter still by moonlight)
  float ang = atan(d.y, d.x);
  float rays = 0.5 + 0.5 * sin(ang * 23.0 + t * 0.06) * sin(ang * 9.0 - t * 0.045);
  c += tint(vec3(1.0, 0.84, 0.60)) * mix(0.05, 0.016, uNight) * pow(rays, 3.0) * exp(-r / 0.55) * smoothstep(0.03, 0.2, r);
  // a light vignette toward the edges ("add light vignette")
  c *= 1.0 - 0.10 * smoothstep(0.38, 1.05, length(v));
  return min(c, vec3(1.0));
}`;
const BG_VS = `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BG_FS = `uniform vec2 uRes; uniform float uTime; varying vec2 vP; ${LIGHT}
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
// embers: tiny glowing motes drifting slowly up through the light
vec3 embers(vec2 px, float t) {
  vec3 acc = vec3(0.0);
  for (int L = 0; L < 3; L++) {
    float sc = 90.0 + float(L) * 55.0, sp = 6.0 + float(L) * 4.0;
    vec2 q = px / sc; q.y += t * sp / sc; q.x += sin(t * 0.07 + float(L)) * 0.3;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float r = h21(id + float(L) * 17.0);
    if (r > 0.42) continue;                                                 // most cells are empty
    vec2 o = vec2(h21(id + 3.1), h21(id + 7.7)) - 0.5;
    float dd = length((f - o * 0.7) * sc);
    float tw = 0.55 + 0.45 * sin(t * (0.6 + r * 1.7) + r * 40.0);
    acc += vec3(1.0, 0.55, 0.30) * exp(-dd * dd / 3.0) * 0.55 * tw + vec3(1.0, 0.8, 0.6) * exp(-dd / 6.0) * 0.06 * tw;
  }
  return acc;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes; uv.y = 1.0 - uv.y;
  vec3 c = light(uv, uTime);                                              // sunshine, with its grain (owner, 2026-10-12: "keep the grains")
  // soft stratocumulus drifting slowly across the upper sky, lit gold on their undersides near the horizon
  vec2 q = vec2(uv.x * uRes.x / uRes.y, uv.y) * vec2(2.2, 5.5) + vec2(uTime * 0.004, 0.0);
  float cl = 0.5 * vn(q) + 0.3 * vn(q * 2.1 + 3.7) + 0.2 * vn(q * 4.3 - 1.9);
  float sky = 1.0 - smoothstep(0.55, 0.76, uv.y);
  float mass = smoothstep(0.36, 0.70, cl) * sky;
  vec3 cloud = mix(mix(vec3(0.68, 0.71, 0.76), vec3(0.92, 0.84, 0.74), smoothstep(0.35, 0.72, uv.y)), vec3(0.28, 0.31, 0.38), uNight);   // by night, dark clouds
  c = mix(c, cloud, 0.68 * mass);
  c += mix(vec3(1.0, 1.0, 0.98) * 0.07, vec3(0.70, 0.78, 0.95) * 0.06, uNight) * smoothstep(0.30, 0.10, abs(cl - 0.42)) * sky * (1.0 - mass);   // bright gaps (silver by moonlight)
  // stars by night, where no cloud is
  { vec2 g = gl_FragCoord.xy / 3.0; float st = step(0.9975, h21(floor(g))) * (0.6 + 0.4 * sin(uTime * 0.7 + h21(floor(g) + 5.0) * 30.0));
    c += vec3(0.85, 0.9, 1.0) * st * 0.55 * uNight * sky * (1.0 - mass); }
  c += (h21(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.03;
  gl_FragColor = vec4(c, 1.0);
}`;

// a pane: a superellipse |x/a|^n + |y/b|^n = 1 drawn from its distance field: frosted fill, ink edge, sheen, shadow
const PANE_VS = `uniform vec2 uSize; varying vec2 vL; void main() { vL = position.xy * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PANE_FS = `
uniform vec2 uRes; uniform float uTime; uniform vec2 uHalf; uniform float uN; uniform float uFill; uniform vec3 uEdge;
uniform float uEdgeW; uniform float uSheen; uniform float uShadow; uniform float uLift; uniform float uDpr; varying vec2 vL; ${LIGHT}
// its neighbours (owner, 2026-10-12: "improve the glass effect to reflect off each other"): up to NB nearby panes,
// as (centre relative to this one, half size) in px; each shows in this pane's glass near the edge facing it
#define NB 6
uniform vec4 uNb[NB]; uniform int uNbN;
float boxd(vec2 p, vec2 h) { float r = min(h.x, h.y) * 0.42; vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdf(vec2 p) {                                   // the superellipse's distance in px (first order, from its gradient)
  // normalised by the larger coordinate, so a large n on a small pane never overflows (which drew a coloured box)
  vec2 q = max(abs(p) / max(uHalf, vec2(1.0)), vec2(1e-4));
  float m = max(q.x, q.y);
  vec2 u = q / m;                                     // both in (0, 1]
  float s = pow(u.x, uN) + pow(u.y, uN);              // in [1, 2]
  float f = m * pow(s, 1.0 / uN);
  vec2 g = pow(s, 1.0 / uN - 1.0) * pow(u, vec2(uN - 1.0)) / max(uHalf, vec2(1.0));
  return (f - 1.0) / max(length(g), 1e-4);
}
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  float d = sdf(vL), aa = 0.75;
  vec4 acc = vec4(0.0);                                 // premultiplied: each layer goes over what is below it
  #define OVER(C_, A_) acc = vec4((C_) * (A_) + acc.rgb * (1.0 - (A_)), (A_) + acc.a * (1.0 - (A_)))
  // the shadow under it: wide, soft and warm, a little below (outside the pane only)
  if (uShadow > 0.0) {
    // a super on top casts a bigger, softer, farther shadow; one underneath a small close one (owner, 2026-10-12)
    float off = 3.0 + 15.0 * uLift, fall = 5.0 + 13.0 * uLift, cap = 36.0 - off;
    float ds = sdf(vL - vec2(0.0, off));
    float sh = uShadow * (0.26 + 0.22 * uLift) * exp(-max(ds, 0.0) / fall) * smoothstep(-aa, aa, d) * (1.0 - smoothstep(cap * 0.55, cap, ds));   // fades out well inside its quad
    OVER(vec3(0.10, 0.10, 0.10), sh);
  }
  // the glass: the light behind it, frosted (brightened, a touch whitened), lighter at the top, with a bright rim
  float inside = 1.0 - smoothstep(-aa, aa, d);
  vec2 uv = gl_FragCoord.xy / uRes; uv.y = 1.0 - uv.y;
  float ny = clamp(vL.y / (2.0 * uHalf.y) + 0.5, 0.0, 1.0);              // 0 at the top, 1 at the bottom
  // the sun on the glass (owner, 2026-10-12: "make the sun rays hit the glass"): which way the sun is from here, how
  // strongly it reaches this pane, and the outward normal of the pane's edge
  vec2 toSunPx = (sunAt(uTime) - uv) * uRes;
  float sunD = length(toSunPx) / uRes.y;
  vec2 toSun = toSunPx / max(length(toSunPx), 1e-3);
  float sunK = (0.45 + 0.55 * exp(-sunD / 0.55)) * mix(0.62, 0.45, uNight);   // nearer the sun, stronger; softer overall (owner: "make it less brighter")
  vec2 nrm = normalize(vec2(sdf(vL + vec2(1.5, 0.0)) - sdf(vL - vec2(1.5, 0.0)), sdf(vL + vec2(0.0, 1.5)) - sdf(vL - vec2(0.0, 1.5))) + 1e-5);
  float facing = max(dot(nrm, toSun), 0.0), away = max(-dot(nrm, toSun), 0.0);
  if (uFill > 0.0 && inside > 0.0) {
    vec3 behind = light(uv, uTime);
    vec3 glass = mix(behind * 0.985, vec3(1.0), uFill + (1.0 - uFill) * 0.42 * uNight);   // by night the frost is lit by the moon: light enough to read on
    glass = mix(glass, vec3(1.0), 0.10 * (1.0 - ny));                     // the top catches more light
    OVER(glass, inside * (0.42 + 0.48 * uFill));
    // the others, reflected: each neighbour's light glows into the glass along the edge facing it, and its edge
    // shows as a faint mirror image in the rim (the point mirrored across this pane's edge, read in its shape)
    if (uNbN > 0) {
      float depth = max(-d, 0.0), band = 1.0 - smoothstep(0.0, 52.0, depth);
      vec2 mir = vL + nrm * 7.0 * depth;                                    // where this point sees in the edge's curved mirror (compressed, as a convex glass shows it)
      float ga = 0.0, ghost = 0.0, rimW = min(34.0, 0.22 * min(uHalf.x, uHalf.y));   // a small super keeps its middle clear
      vec3 rc = mix(light(uv, uTime) * 1.15 + 0.08, vec3(1.0), 0.55);     // a neighbour's frosted light, brighter than this pane's
      for (int i = 0; i < NB; i++) {
        if (i >= uNbN) break;
        vec4 nb = uNb[i];
        float dn = boxd(vL - nb.xy, nb.zw);                                 // how far the neighbour is from this point
        vec2 dir = normalize(nb.xy - vL + 1e-5);
        float face = smoothstep(0.15, 0.9, dot(nrm, dir));                 // only the edge that faces it
        float w = exp(-max(dn, 0.0) / 90.0) * face * band;
        ga += w;
        float dm = boxd(mir - nb.xy, nb.zw);                               // the neighbour's edge, seen in the mirror
        ghost += (1.0 - smoothstep(3.0, 9.0, abs(dm))) * face * smoothstep(1.5, 4.0, depth) * (1.0 - smoothstep(rimW * 0.4, rimW, depth));   // the neighbour's edge, a soft line in the rim
      }
      ga = min(ga, 1.0);
      if (ga > 0.0) OVER(rc, ga * 0.55 * inside);
      OVER(mix(uEdge, rc, 0.45), min(ghost, 1.0) * 0.28 * inside);
    }
    // the bevel: a bright inner line all round, strongest along the top
    float rim = (1.0 - smoothstep(0.6, 2.2, -d)) * inside;
    OVER(vec3(1.0), rim * mix(0.85, 0.30, ny));
    // the sun hitting it: rays crossing the glass, slanting from the sun, slowly breathing
    vec2 fromSun = -toSunPx;
    float ang = atan(fromSun.y, fromSun.x);
    float rays = 0.5 + 0.5 * sin(ang * 23.0 + uTime * 0.06) * sin(ang * 9.0 - uTime * 0.045);
    OVER(tint(vec3(1.0, 0.86, 0.60)), inside * 0.16 * pow(rays, 4.0) * sunK);
    // a warm wash over the side facing the sun, fading across the pane
    float side = clamp(dot(vL / max(uHalf, vec2(1.0)), toSun) * 0.5 + 0.5, 0.0, 1.0);
    OVER(tint(vec3(1.0, 0.88, 0.66)), inside * 0.14 * side * side * sunK);
    // the light gathered at the far inner edge, as a lens focuses it (a soft caustic)
    float depthIn = max(-d, 0.0);
    OVER(tint(vec3(1.0, 0.82, 0.52)), inside * 0.30 * pow(away, 3.0) * (1.0 - smoothstep(0.0, 16.0, depthIn)) * smoothstep(0.5, 3.0, depthIn) * sunK);
    // the gold rim where the sun strikes the edge, and a bright glint where it catches square on
    float band = 1.0 - smoothstep(1.0, 8.0, depthIn);
    OVER(tint(vec3(1.0, 0.74, 0.36)), inside * band * 0.85 * pow(facing, 1.6) * sunK);
    OVER(tint(vec3(1.0, 0.97, 0.86)), inside * (1.0 - smoothstep(0.5, 4.0, depthIn)) * pow(facing, 14.0) * sunK);
  }
  // the prism: the edge splits the light a little, red outside, blue inside, always faint
  float rr = 1.0 - smoothstep(0.0, 1.4, abs(d - 1.3)), bb = 1.0 - smoothstep(0.0, 1.4, abs(d + 1.6));
  float lit = 0.35 + 1.4 * facing * sunK;                                  // the light comes from the sun: the edge facing it splits it most
  OVER(vec3(1.0, 0.45, 0.30), rr * 0.18 * lit * step(0.0001, uFill));
  OVER(vec3(0.35, 0.55, 1.0), bb * 0.16 * lit * step(0.0001, uFill));
  // the sun spilling past the lit edge, a soft gold halo just outside it
  if (uFill > 0.0) OVER(tint(vec3(1.0, 0.78, 0.42)), step(0.0, d) * (1.0 - smoothstep(0.0, 9.0, d)) * pow(facing, 2.0) * 0.40 * sunK);
  // the edge: a fine line in the edge colour, a little see-through so the glass reads
  float e = 1.0 - smoothstep(uEdgeW * 0.5 - aa, uEdgeW * 0.5 + aa, abs(d));
  OVER(mix(uEdge, tint(vec3(0.62, 0.40, 0.12)), 0.55 * pow(facing, 2.0) * sunK * step(0.0001, uFill)), e * (uFill > 0.0 ? 0.92 : 0.95));   // a dark edge on paper, warmed to bronze where the sun strikes it
  // the sheen: an iridescent light running round the edge (hovered or selected)
  if (uSheen > 0.001) {
    float ang = atan(vL.y / uHalf.y, vL.x / uHalf.x) / 6.2831853 + 0.5;
    float head = fract(uTime * 0.12);
    float k = abs(fract(ang - head + 0.5) - 0.5);
    float w = (1.0 - smoothstep(0.0, 0.24, k)) * (1.0 - smoothstep(uEdgeW * 0.5, uEdgeW * 0.5 + 2.5, abs(d))) * uSheen;
    OVER(hue(ang * 1.5 - uTime * 0.05) * 0.85 + 0.15, w);
  }
  gl_FragColor = acc;
}`;

// a wire: a strip along its path, antialiased across, with dots flowing along it on hover
const WIRE_VS = `attribute float aSide; attribute float aLen; varying float vSide; varying float vLen;
void main() { vSide = aSide; vLen = aLen; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WIRE_FS = `uniform vec3 uColor; uniform float uW; uniform float uFlow; uniform float uTime; uniform float uAlpha; varying float vSide; varying float vLen;
void main() {
  float half_ = uW * 0.5 + 1.0, dist = abs(vSide) * half_;
  float a = 1.0 - smoothstep(uW * 0.5 - 0.5, uW * 0.5 + 0.5, dist);
  if (uFlow > 0.0) { float ph = fract((vLen - uTime * 34.0) / 10.0); a *= mix(1.0, smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.45, 0.6, ph)), uFlow); }
  gl_FragColor = vec4(uColor, a * uAlpha);
}`;

// a port sparkle: a four-pointed star (an astroid, the superellipse at n = 2/3)
const SPARK_VS = `attribute vec3 aColor; varying vec2 vU; varying vec3 vC;
void main() { vU = position.xy * 2.0; vC = aColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const SPARK_FS = `varying vec2 vU; varying vec3 vC;
void main() { vec2 q = abs(vU); float s = pow(q.x, 0.62) + pow(q.y, 0.62); float a = 1.0 - smoothstep(0.86, 1.0, s); if (a <= 0.0) discard; gl_FragColor = vec4(vC, a); }`;

// ---------------------------------------------------------------- the scene
let slowCheck = true, frameTimes = [];
let renderer, scene, camera, bg, sparks, raf = 0, W = 0, H = 0, dpr = 1, t0 = performance.now(), failed = false;
const uRes = { value: new THREE.Vector2(1, 1) }, uTime = { value: 0 }, uNight = { value: 0 };
document.addEventListener("se:sky", () => { uNight._t = -99; });           // dark mode switched, or the hour turned: look again now
const panes = new Map(), wires = new Map();
const quad = new THREE.PlaneGeometry(1, 1);
let tokens = { ink: new THREE.Color("#191919"), cobalt: new THREE.Color("#2f40e8"), hint: new THREE.Color("#8f97d8"), graphite: new THREE.Color("#6e6e6a"), hair: new THREE.Color("#c9c9c4") }, tokensAt = 0;

function readTokens() {
  const cs = getComputedStyle(html), get = (v, d) => (cs.getPropertyValue(v) || "").trim() || d;
  const probe = document.createElement("i");
  const resolve = v => { probe.style.color = v; document.body.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; };
  const col = c => { const m = String(c).match(/[\d.]+/g); return m ? new THREE.Color(+m[0] / 255, +m[1] / 255, +m[2] / 255) : null; };
  tokens = {
    ink: col(resolve(get("--ink", "#191919"))) || tokens.ink,
    cobalt: col(resolve(get("--cobalt", "#2f40e8"))) || tokens.cobalt,
    hint: col(resolve("var(--se-hint)")) || tokens.hint,
    graphite: col(resolve(get("--graphite", "#6e6e6a"))) || tokens.graphite,
    hair: col(resolve("var(--hair-strong)")) || tokens.hair,
  };
  tokensAt = performance.now();
}

function start() {
  if (renderer || failed || !on()) return;
  THREE.ColorManagement.enabled = false;                       // colours are the page's own sRGB values, drawn as they are
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch (e) { failed = true; return; }
  // a device without a graphics processor (a software renderer) would draw every frame slowly: the CSS look is
  // kinder there (?gl=1 forces the engine anyway)
  const force = /[?&]gl=1\b/.test(location.search);
  try {
    const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    if (!force && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) { renderer.dispose(); renderer = null; failed = true; return; }
  } catch (_) { /* the name is not told: go on */ }
  slowCheck = !force;
  // a shader that does not compile on this device: back to the CSS look rather than a page without its chrome
  renderer.debug.onShaderError = (gl, program, vs, fs) => { console.warn("SuperAI engine: a shader did not compile here; back to the CSS look", gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs)); failed = true; setTimeout(stop, 0); };
  const cv = renderer.domElement;
  cv.className = "se-gl-canvas"; cv.setAttribute("aria-hidden", "true");
  document.body.prepend(cv);
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(0, 1, 0, 1, -100, 100);
  bg = new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader: BG_VS, fragmentShader: BG_FS, uniforms: { uRes, uTime, uNight }, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  bg.renderOrder = 0; scene.add(bg);
  const sg = new THREE.PlaneGeometry(1, 1);
  sg.setAttribute("aColor", new THREE.InstancedBufferAttribute(new Float32Array(600 * 3), 3));
  sparks = new THREE.InstancedMesh(sg, new THREE.ShaderMaterial({ vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }), 600);
  sparks.renderOrder = 50; sparks.frustumCulled = false; scene.add(sparks);
  readTokens();
  resize();
  window.addEventListener("resize", resize);
  html.classList.add("se-gl");
  window.SeEngine.ready = true;
  loop();
}
function resize() {
  if (!renderer) return;
  W = window.innerWidth; H = window.innerHeight; dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
  renderer.domElement.style.width = W + "px"; renderer.domElement.style.height = H + "px";
  camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = H; camera.updateProjectionMatrix();
  uRes.value.set(W * dpr, H * dpr);
  bg.position.set(W / 2, H / 2, 0); bg.scale.set(W, H, 1);
}
function stop() {
  cancelAnimationFrame(raf); raf = 0;
  html.classList.remove("se-gl");
  if (renderer) { renderer.domElement.remove(); renderer.dispose(); renderer = null; }
  panes.clear(); wires.clear();
  window.SeEngine.ready = false;
}

// ---------------------------------------------------------------- panes
const PANE_M = 40;                                       // room round a pane for its shadow and sheen
function paneMesh(key) {
  let m = panes.get(key);
  if (!m) {
    const u = { uRes, uTime, uNight, uSize: { value: new THREE.Vector2(1, 1) }, uHalf: { value: new THREE.Vector2(1, 1) }, uN: { value: Math.PI }, uFill: { value: 0.4 },
      uEdge: { value: new THREE.Color() }, uEdgeW: { value: 1.5 }, uSheen: { value: 0 }, uShadow: { value: 1 }, uLift: { value: 0.5 }, uDpr: { value: 1 },
      uNb: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) }, uNbN: { value: 0 } };
    m = new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader: PANE_VS, fragmentShader: PANE_FS, uniforms: u, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, premultipliedAlpha: true }));
    m.frustumCulled = false; m._sheen = 0;
    scene.add(m); panes.set(key, m);
  }
  m._seen = true;
  return m;
}
function setPane(key, cx, cy, a, b, n, o) {
  if (!(a > 5 && b > 5) || !isFinite(a + b + cx + cy + n)) return;   // too small to be a pane (or not a number): nothing drawn
  const m = paneMesh(key), u = m.material.uniforms, M = o.margin != null ? o.margin : PANE_M;
  m.position.set(cx, cy, 0); m.scale.set(2 * (a + M), 2 * (b + M), 1);
  u.uSize.value.set(2 * (a + M), 2 * (b + M)); u.uHalf.value.set(a, b); u.uN.value = Math.max(0.3, Math.min(60, n));   // a star too: the pane is the shape the super has
  u.uFill.value = o.fill; u.uEdge.value.copy(o.edge); u.uEdgeW.value = o.edgeW; u.uShadow.value = o.shadow || 0;
  m._sheen += ((o.sheen ? 1 : 0) - m._sheen) * 0.08;            // the sheen fades in and out slowly
  u.uSheen.value = m._sheen; m.renderOrder = o.order;
  if (o.lift != null) u.uLift.value = o.lift;                     // a fixed height (the main and second supers lie lowest)
}
// a super's n from its CSS corner shape: superellipse(k) is n = 2^k; round is n = 2
function nOf(el) {
  const cs = getComputedStyle(el), s = cs.getPropertyValue("corner-shape") || "";
  const m = s.match(/superellipse\(\s*([-\d.]+)/);
  if (m) return Math.pow(2, +m[1]);
  if (/round/.test(s)) return 2;
  return Math.PI;
}
const KINDS = [
  { sel: ".orbit-bubble.is-group:not([hidden])", fill: 0.30, order: 10, shadow: 1 },
  { sel: ".se-project", fill: 0.30, order: 11, shadow: 1 },
  { sel: ".orbit-panel:not(.leaving)", fill: 0.72, order: 13, shadow: 1 },
  { sel: ".lv-node", fill: 0.45, order: 14, shadow: 0.6 },
  { sel: ".orbit-title .se-titlesuper", fill: 0.45, order: 15, shadow: 0.6 },
  { sel: ".lv-palette", fill: 0.45, order: 15, shadow: 0.6 },
];
// a super's height in the page: the z-index of the nearest stacked box round it, then its kind's order, then how
// deep it sits inside other supers (what a super holds lies on it)
function heightOf(el, order) {
  const now = performance.now();
  if (el._seH && now - el._seH.t < 300) return el._seH.v;          // looked at a few times a second, not every frame
  let z = 0;
  for (let e = el; e && e !== document.body; e = e.parentElement) { const v = getComputedStyle(e).zIndex; if (v !== "auto") { z = +v || 0; break; } }
  const held = window.SeHold && window.SeHold.hostOf ? (window.SeHold.hostOf(el) ? 1 : 0) : 0;
  const v = z * 1000 + held * 100 + order;
  el._seH = { t: now, v };
  return v;
}
// how deep a super lies inside others (what it was dropped into: super/hold.js), looked at a few times a second;
// a super is drawn above the one holding it
function depthOf(el) {
  const now = performance.now();
  if (el._seD && now - el._seD.t < 300) return el._seD.v;
  let d = 0, e = el;
  for (let i = 0; i < 6 && window.SeHold && window.SeHold.hostOf; i++) { const h = window.SeHold.hostOf(e); if (!h) break; d++; e = h; }
  el._seD = { t: now, v: d };
  return d;
}
function drawPanes() {
  const ids = new WeakMap(); let k = 0;
  const all = [];                                                   // every pane drawn this frame: each reflects its neighbours
  for (const K of KINDS) {
    document.querySelectorAll(K.sel).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < -40 || r.top > H + 40) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || +cs.opacity < 0.02 || cs.display === "none") return;
      const bw = parseFloat(cs.borderTopWidth) || 0;
      const holder = el.classList.contains("is-holder");
      if (!bw && !holder) return;                                  // a super that draws itself (an svg shape): left to the page
      const key = el._seKey || (el._seKey = "p" + (++k) + Math.random().toString(36).slice(2, 6));
      ids.set(el, key);
      const sel = el.classList.contains("se-sel"), hov = el.classList.contains("se-on") || el.matches(":hover");
      const edge = sel ? tokens.cobalt : hov ? tokens.hint : tokens.ink;
      const op = +cs.opacity;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, a = r.width / 2 - bw / 2, b = r.height / 2 - bw / 2;
      setPane(key, cx, cy, a, b, nOf(el),
        { fill: holder ? 0.26 * op : K.fill * op, edge, edgeW: Math.max(1, bw || 1.5), shadow: (holder ? 1 : K.shadow) * op, sheen: sel || hov, order: (holder ? 3 : K.order) + 20 * depthOf(el) });   // above the super it lies in   // a holder (the third super) is glass too, under what it holds
      if (panes.has(key)) all.push({ m: panes.get(key), cx, cy, a, b, holder, h: heightOf(el, K.order), i: all.length });
    });
  }
  // how high each super lies: its rank from the bottom (the page's stacking: z-index, then kind, then page order),
  // 0 for the lowest, 1 for the one on top; the shadow grows with it
  const byH = all.slice().sort((p, q) => p.h - q.h || p.i - q.i);
  byH.forEach((p, j) => { const u = p.m.material.uniforms, want = byH.length > 1 ? j / (byH.length - 1) : 0.5; u.uLift.value += (want - u.uLift.value) * 0.15; });   // eased: a super raised casts its shadow gradually
  // the nearest few within reach, nearest first (a holder's glass reflects nothing, but its edge shows in others)
  const REACH = 150;
  for (const p of all) {
    const u = p.m.material.uniforms; let n = 0;
    {                                                                   // every super reflects its neighbours, a holder too
      const near = [];
      for (const q of all) {
        if (q === p) continue;
        const gx = Math.max(0, Math.abs(q.cx - p.cx) - q.a - p.a), gy = Math.max(0, Math.abs(q.cy - p.cy) - q.b - p.b), gap = Math.hypot(gx, gy);
        const nested = Math.abs(q.cx - p.cx) + q.a <= p.a && Math.abs(q.cy - p.cy) + q.b <= p.b;   // inside it: seen through the glass, not in it
        if (gap < REACH && !nested) near.push({ q, gap });
      }
      near.sort((x, y) => x.gap - y.gap);
      for (const { q } of near.slice(0, 6)) u.uNb.value[n++].set(q.cx - p.cx, q.cy - p.cy, q.a, q.b);
    }
    u.uNbN.value = n;
  }
}
// the main super and the inner super: rings (the inner one a whisper of glass)
function drawLoops() {
  const g = O().loop ? O().loop() : null, sb = O().siteBox ? O().siteBox() : null;
  const top = (O().fit && O().fit().py != null && g) ? O().fit().py - g.cy : 0;
  if (g && g.a) {
    const sel = html.classList.contains("se-sel-loop"), hov = html.classList.contains("se-on-loop");
    // the main, second and third supers are supers like any other (owner, 2026-10-12: "all supers have the same
    // effect including main, second and third supers"): glass, a bevel, a shadow, the sheen when hovered or selected
    setPane("main", g.cx, g.cy + top, g.a, g.b, g.n, { fill: 0.12, edge: sel ? tokens.cobalt : hov ? tokens.hint : tokens.ink, edgeW: 2, shadow: 1, sheen: sel || hov, order: 1, lift: 0 });
  }
  if (sb && sb.a && window.SeSite) {
    const f = sb.fit || 1, cx = sb.px + (sb.cx - sb.px) * f, cy = sb.py + (sb.cy - sb.py) * f;
    const sel = html.classList.contains("se-sel-site"), hov = html.classList.contains("se-on-site"), busy = html.classList.contains("se-site-thinking");
    setPane("site", cx, cy, sb.a * f, sb.b * f, sb.n, { fill: 0.2, edge: sel || busy ? tokens.cobalt : hov ? tokens.hint : tokens.ink, edgeW: sel ? 2.5 : 1.5, shadow: 1, sheen: sel || busy || hov, order: 2, lift: 0.08 });
  }
}

// ---------------------------------------------------------------- wires
const WIRE_SEL = ".sl-layer g.wire, .lv-wires g.wire, .orbit-wires g.wire";
function sample(path) {                                  // points along an svg path, on screen
  const len = path.getTotalLength();
  if (!(len > 0.5)) return null;
  const m = path.getScreenCTM(); if (!m) return null;
  const n = Math.max(2, Math.min(500, Math.ceil(len / 3))), pts = [];
  for (let i = 0; i <= n; i++) { const p = path.getPointAtLength(len * i / n); pts.push([m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f]); }
  return pts;
}
function strip(pts, w) {                                  // a strip of quads along the points, with side and length
  const hw = w / 2 + 1, n = pts.length, pos = new Float32Array(n * 2 * 3), side = new Float32Array(n * 2), len = new Float32Array(n * 2), idx = [];
  let L = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    if (i) L += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const nx = -dy * hw, ny = dx * hw;
    pos.set([p[0] + nx, p[1] + ny, 0, p[0] - nx, p[1] - ny, 0], i * 6);
    side[i * 2] = 1; side[i * 2 + 1] = -1; len[i * 2] = L; len[i * 2 + 1] = L;
    if (i < n - 1) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aSide", new THREE.BufferAttribute(side, 1)); g.setAttribute("aLen", new THREE.BufferAttribute(len, 1));
  g.setIndex(idx);
  return g;
}
function wireMesh(key) {
  let m = wires.get(key);
  if (!m) {
    const u = { uColor: { value: new THREE.Color() }, uW: { value: 1.5 }, uFlow: { value: 0 }, uTime, uAlpha: { value: 1 } };
    m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ vertexShader: WIRE_VS, fragmentShader: WIRE_FS, uniforms: u, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    m.frustumCulled = false; m._sig = ""; m._flow = 0;
    scene.add(m); wires.set(key, m);
  }
  m._seen = true;
  return m;
}
function setWire(key, path, o) {
  const d = path.getAttribute("d") || ""; if (!d) return;
  const ctm = path.getScreenCTM(); if (!ctm) return;
  const sig = d + "|" + [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f].map(v => v.toFixed(2)).join(",") + "|" + o.w;
  const m = wireMesh(key);
  if (m._sig !== sig) {
    const pts = sample(path);
    if (!pts) { m.visible = false; return; }
    m.geometry.dispose(); m.geometry = strip(pts, o.w); m._sig = sig;
  }
  m.visible = true;
  const u = m.material.uniforms;
  u.uColor.value.copy(o.color); u.uW.value = o.w; u.uAlpha.value = o.alpha == null ? 1 : o.alpha;
  m._flow += ((o.flow ? 1 : 0) - m._flow) * 0.12; u.uFlow.value = m._flow;
  m.renderOrder = o.order;
}
// the data types' colours, as a flow language (LabVIEW) draws them, muted to sit with ink on paper: a whole number blue, a
// decimal orange, text pink, true/false green, a list violet and heavier, an AI answer teal
const TYPE_COLOR = { int: new THREE.Color("#2a5aa8"), number: new THREE.Color("#c0661c"), text: new THREE.Color("#b2457d"), bool: new THREE.Color("#3d7c3a"), list: new THREE.Color("#6b4fa2"), ai: new THREE.Color("#1f7a7e") };
let wk = 0;
function drawWires() {
  document.querySelectorAll(WIRE_SEL).forEach(g => {
    const bed = g.querySelector(".wire-bed"); if (!bed) return;
    const key = g._seKey || (g._seKey = "w" + (++wk));
    const sel = g.classList.contains("is-sel"), hov = g.matches(":hover"), live = g.classList.contains("live");
    // a data wire is thicker and coloured by its type (owner, 2026-10-12: "input output wire thicker and color data type specific")
    const data = g.classList.contains("sl-data"), tc = data ? TYPE_COLOR[g.dataset.type] || tokens.ink : tokens.ink;
    setWire(key, bed, { w: data ? (g.dataset.type === "list" ? 5.6 : 3.8) : 2.2, color: sel ? tokens.cobalt : hov ? (data ? tc.clone().lerp(tokens.hint, 0.35) : tokens.hint) : tc, alpha: data ? 0.9 : 0.82, flow: hov || live, order: 4 });
  });
  document.querySelectorAll(".sl-layer .wire-temp").forEach(p => { const key = p._seKey || (p._seKey = "t" + (++wk)); setWire(key, p, { w: 1.5, color: tokens.cobalt, flow: true, order: 5 }); });
  document.querySelectorAll(".om-site .om-lattice").forEach(p => {
    if (!p.getClientRects().length) return;
    const key = p._seKey || (p._seKey = "l" + (++wk));
    setWire(key, p, { w: 3.8, color: tokens.ink, alpha: 0.86, flow: false, order: 3 });   // the side wires join input and output: data wires, thick; drawn as the wires are (owner, 2026-10-12: "the wires are not real wires and not visible")
  });
}

// ---------------------------------------------------------------- sparkles (ports, wire ends)
const _m = new THREE.Matrix4();
function drawSparks() {
  let i = 0;
  const col = sparks.geometry.getAttribute("aColor");
  const add = (x, y, s, c) => {
    if (i >= 600) return;
    _m.makeScale(s, s, 1); _m.setPosition(x, y, 0); sparks.setMatrixAt(i, _m);
    col.setXYZ(i, c.r, c.g, c.b); i++;
  };
  document.querySelectorAll(".se-port:not(.is-covered) .se-port-dot, .orbit-title .sts-p").forEach(d => {
    const p = d.closest(".se-port");
    if (p && (getComputedStyle(p).opacity < 0.05 || p.style.display === "none")) return;
    const r = d.getBoundingClientRect(); if (!r.width) return;
    add(r.left + r.width / 2, r.top + r.height / 2, Math.max(9, r.width) + 1, tokens.ink);
  });
  document.querySelectorAll(".sl-layer .wire-term, .lv-wires .wire-term, .orbit-wires .wire-term").forEach(t => {
    const r = t.getBoundingClientRect(); if (!r.width) return;
    const sel = t.closest(".is-sel");
    add(r.left + r.width / 2, r.top + r.height / 2, Math.max(9, r.width), sel ? tokens.cobalt : tokens.ink);
  });
  sparks.count = i;
  sparks.instanceMatrix.needsUpdate = true; col.needsUpdate = true;
}

// ---------------------------------------------------------------- the frame
function sweep(map) { map.forEach((m, k) => { if (!m._seen) { scene.remove(m); m.geometry !== quad && m.geometry.dispose(); m.material.dispose(); map.delete(k); } m._seen = false; }); }
// calm, it draws a few times a second (the light drifts slowly); anything moving, every frame
let activeAt = performance.now(), tick = 0;
["pointermove", "pointerdown", "wheel", "keydown", "touchmove"].forEach(t => window.addEventListener(t, () => { activeAt = performance.now(); }, { passive: true, capture: true }));
document.addEventListener("se:frame", () => { activeAt = performance.now(); });
const busy = () => performance.now() - activeAt < 1500 || (window.SeMotion && window.SeMotion.busy && window.SeMotion.busy()) || [...panes.values()].some(m => m._sheen > 0.01 && m._sheen < 0.99) || [...wires.values()].some(m => m._flow > 0.01);
function frame() {
  raf = 0;
  if (!renderer) return;
  if (!on()) { stop(); return; }
  if (!busy() && (++tick % 2)) { loop(); return; }                  // calm: 30 frames a second, so the drifting light and embers stay smooth
  try {
    if (performance.now() - tokensAt > 3000) readTokens();
    uTime.value = (performance.now() - t0) / 1000;
    if (!(uTime.value - (uNight._t || -99) < 30)) { uNight._t = uTime.value; uNight.value = window.SeSky ? window.SeSky.night() : 0; }   // the sky by the visitor's clock, looked at every 30 s
    drawLoops(); drawWires(); drawPanes(); drawSparks();
    sweep(panes); sweep(wires);
    const t1 = performance.now();
    renderer.render(scene, camera);
    // too slow here (a weak or busy graphics processor): back to the CSS look after a few frames
    if (slowCheck) {
      frameTimes.push(performance.now() - t1 + (frame._read || 0));
      if (frameTimes.length >= 20) {
        const sorted = frameTimes.slice().sort((x, y) => x - y), med = sorted[10];
        slowCheck = false;
        if (med > 28) { console.warn("SuperAI engine: frames take " + med.toFixed(0) + " ms here; back to the CSS look"); failed = true; stop(); return; }
      }
    }
  } catch (e) {
    console.warn("SuperAI engine: back to the CSS look", e);
    failed = true; stop(); return;
  }
  loop();
}
function loop() { if (!raf) raf = requestAnimationFrame(frame); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && renderer) loop(); });

window.SeEngine = { ready: false, stop, start: () => { failed = false; start(); }, THREE };
const boot = () => { if (on()) start(); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
new MutationObserver(() => { if (on() && !renderer && !failed) start(); }).observe(html, { attributes: true, attributeFilter: ["class"] });
