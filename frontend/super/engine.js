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
// a deep warm light, as in the owner's reference: amber, honey and sage glows over a warm ground, darker at the edges
vec3 light(vec2 uv, float t) {
  float a = uRes.x / uRes.y;
  #define G(p, r) exp(-dot((uv - p) * vec2(a, 1.0), (uv - p) * vec2(a, 1.0)) / (r * r))
  vec2 p1 = vec2(0.18 + 0.06 * sin(t * 0.050), 0.22 + 0.05 * cos(t * 0.043));
  vec2 p2 = vec2(0.82 + 0.05 * cos(t * 0.047), 0.78 + 0.06 * sin(t * 0.058));
  vec2 p3 = vec2(0.70 + 0.07 * sin(t * 0.033), 0.18 + 0.04 * cos(t * 0.071));
  vec2 p4 = vec2(0.26 + 0.06 * cos(t * 0.029), 0.86 + 0.05 * sin(t * 0.066));
  vec2 p5 = vec2(0.52 + 0.05 * sin(t * 0.019), 0.48 + 0.05 * cos(t * 0.023));
  vec3 c = vec3(0.80, 0.66, 0.52);                                        // the warm ground
  c = mix(c, vec3(0.72, 0.40, 0.18), 0.85 * G(p1, 0.46));                // amber
  c = mix(c, vec3(0.52, 0.55, 0.44), 0.70 * G(p2, 0.44));                // sage
  c = mix(c, vec3(0.93, 0.70, 0.42), 0.80 * G(p3, 0.36));                // honey
  c = mix(c, vec3(0.60, 0.46, 0.40), 0.60 * G(p4, 0.42));                // umber
  c = mix(c, vec3(0.97, 0.90, 0.80), 0.85 * G(p5, 0.40));                // the light in the middle
  vec2 v = (uv - 0.5) * vec2(a, 1.0);
  c *= 1.0 - 0.32 * smoothstep(0.25, 1.05, length(v));                    // a soft vignette
  return c;
}`;
const BG_VS = `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BG_FS = `uniform vec2 uRes; uniform float uTime; varying vec2 vP; ${LIGHT}
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
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
  vec3 c = light(uv, uTime) + embers(gl_FragCoord.xy, uTime);
  c += (h21(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.022;        // a fine film grain
  gl_FragColor = vec4(c, 1.0);
}`;

// a pane: a superellipse |x/a|^n + |y/b|^n = 1 drawn from its distance field: frosted fill, ink edge, sheen, shadow
const PANE_VS = `uniform vec2 uSize; varying vec2 vL; void main() { vL = position.xy * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PANE_FS = `
uniform vec2 uRes; uniform float uTime; uniform vec2 uHalf; uniform float uN; uniform float uFill; uniform vec3 uEdge;
uniform float uEdgeW; uniform float uSheen; uniform float uShadow; uniform float uDpr; varying vec2 vL; ${LIGHT}
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
    float ds = sdf(vL - vec2(0.0, 9.0));
    float sh = uShadow * 0.26 * exp(-max(ds, 0.0) / 11.0) * smoothstep(-aa, aa, d) * (1.0 - smoothstep(14.0, 24.0, ds));   // fades out well inside its quad: no box edge
    OVER(vec3(0.22, 0.12, 0.05), sh);
  }
  // the glass: the light behind it, frosted (brightened, a touch whitened), lighter at the top, with a bright rim
  float inside = 1.0 - smoothstep(-aa, aa, d);
  vec2 uv = gl_FragCoord.xy / uRes; uv.y = 1.0 - uv.y;
  float ny = clamp(vL.y / (2.0 * uHalf.y) + 0.5, 0.0, 1.0);              // 0 at the top, 1 at the bottom
  if (uFill > 0.0 && inside > 0.0) {
    vec3 behind = light(uv, uTime);
    vec3 glass = mix(behind * 1.10 + 0.06, vec3(1.0), uFill);
    glass = mix(glass, vec3(1.0), 0.10 * (1.0 - ny));                     // the top catches more light
    OVER(glass, inside * (0.42 + 0.48 * uFill));
    // the others, reflected: each neighbour's light glows into the glass along the edge facing it, and its edge
    // shows as a faint mirror image in the rim (the point mirrored across this pane's edge, read in its shape)
    if (uNbN > 0) {
      vec2 gx = vec2(1.5, 0.0), gy = vec2(0.0, 1.5);
      vec2 nrm = normalize(vec2(sdf(vL + gx) - sdf(vL - gx), sdf(vL + gy) - sdf(vL - gy)) + 1e-5);
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
  }
  // the prism: the edge splits the light a little, red outside, blue inside, always faint
  float rr = 1.0 - smoothstep(0.0, 1.4, abs(d - 1.3)), bb = 1.0 - smoothstep(0.0, 1.4, abs(d + 1.6));
  float lit = 0.5 + 0.5 * (-vL.x / uHalf.x - vL.y / uHalf.y) * 0.5;      // the light comes from the top left
  OVER(vec3(1.0, 0.45, 0.30), rr * 0.18 * lit * step(0.0001, uFill));
  OVER(vec3(0.35, 0.55, 1.0), bb * 0.16 * lit * step(0.0001, uFill));
  // the edge: a fine line in the edge colour, a little see-through so the glass reads
  float e = 1.0 - smoothstep(uEdgeW * 0.5 - aa, uEdgeW * 0.5 + aa, abs(d));
  OVER(uEdge, e * (uFill > 0.0 ? 0.62 : 0.85));
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
const uRes = { value: new THREE.Vector2(1, 1) }, uTime = { value: 0 };
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
  bg = new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader: BG_VS, fragmentShader: BG_FS, uniforms: { uRes, uTime }, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
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
const PANE_M = 28;                                       // room round a pane for its shadow and sheen
function paneMesh(key) {
  let m = panes.get(key);
  if (!m) {
    const u = { uRes, uTime, uSize: { value: new THREE.Vector2(1, 1) }, uHalf: { value: new THREE.Vector2(1, 1) }, uN: { value: Math.PI }, uFill: { value: 0.4 },
      uEdge: { value: new THREE.Color() }, uEdgeW: { value: 1.5 }, uSheen: { value: 0 }, uShadow: { value: 1 }, uDpr: { value: 1 },
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
  u.uSize.value.set(2 * (a + M), 2 * (b + M)); u.uHalf.value.set(a, b); u.uN.value = Math.max(1.2, Math.min(60, n));
  u.uFill.value = o.fill; u.uEdge.value.copy(o.edge); u.uEdgeW.value = o.edgeW; u.uShadow.value = o.shadow || 0;
  m._sheen += ((o.sheen ? 1 : 0) - m._sheen) * 0.08;            // the sheen fades in and out slowly
  u.uSheen.value = m._sheen; m.renderOrder = o.order;
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
        { fill: holder ? 0 : K.fill * op, edge, edgeW: Math.max(1, bw || 1.5), shadow: holder ? 0 : K.shadow * op, sheen: sel || hov, order: K.order });
      if (panes.has(key)) all.push({ m: panes.get(key), cx, cy, a, b, holder });
    });
  }
  // the nearest few within reach, nearest first (a holder's glass reflects nothing, but its edge shows in others)
  const REACH = 150;
  for (const p of all) {
    const u = p.m.material.uniforms; let n = 0;
    if (!p.holder) {
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
    setPane("main", g.cx, g.cy + top, g.a, g.b, g.n, { fill: 0, edge: sel ? tokens.cobalt : hov ? tokens.hint : tokens.ink, edgeW: 2, shadow: 0, sheen: sel, order: 1, margin: 6 });
  }
  if (sb && sb.a && window.SeSite) {
    const f = sb.fit || 1, cx = sb.px + (sb.cx - sb.px) * f, cy = sb.py + (sb.cy - sb.py) * f;
    const sel = html.classList.contains("se-sel-site"), hov = html.classList.contains("se-on-site"), busy = html.classList.contains("se-site-thinking");
    setPane("site", cx, cy, sb.a * f, sb.b * f, sb.n, { fill: 0.03, edge: sel || busy ? tokens.cobalt : hov ? tokens.hint : tokens.ink, edgeW: sel ? 2.5 : 1.5, shadow: 0, sheen: sel || busy, order: 2, margin: 6 });
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
let wk = 0;
function drawWires() {
  document.querySelectorAll(WIRE_SEL).forEach(g => {
    const bed = g.querySelector(".wire-bed"); if (!bed) return;
    const key = g._seKey || (g._seKey = "w" + (++wk));
    const sel = g.classList.contains("is-sel"), hov = g.matches(":hover"), live = g.classList.contains("live");
    setWire(key, bed, { w: 2.2, color: sel ? tokens.cobalt : hov ? tokens.hint : tokens.ink, alpha: 0.82, flow: hov || live, order: 4 });   // more visible (owner, 2026-10-12)
  });
  document.querySelectorAll(".sl-layer .wire-temp").forEach(p => { const key = p._seKey || (p._seKey = "t" + (++wk)); setWire(key, p, { w: 1.5, color: tokens.cobalt, flow: true, order: 5 }); });
  document.querySelectorAll(".om-site .om-lattice").forEach(p => {
    if (!p.getClientRects().length) return;
    const key = p._seKey || (p._seKey = "l" + (++wk));
    setWire(key, p, { w: 2.2, color: tokens.ink, alpha: 0.82, flow: false, order: 3 });   // drawn as the wires are (owner, 2026-10-12: "the wires are not real wires and not visible")
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
