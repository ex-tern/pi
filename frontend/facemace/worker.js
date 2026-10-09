// facemace/worker.js — FaceMace's engine, off the main thread.
//
// A browser port of neurophilic/FaceID (face_sorter.py), step for step:
//   1. each photo is shrunk to fit 600×600 and turned to greyscale (as PIL "L");
//   2. faces are found with OpenCV's Haar cascade (haarcascade_frontalface_default,
//      scale step 1.1, at least 5 neighbours), evaluated here in plain JS;
//   3. each face is resized to 200×200 and described the way OpenCV's LBPH
//      recogniser does (radius 1, 8 neighbours, 8×8 grid of 256-bin histograms);
//   4. a face goes to the nearest known person (chi-square distance) if it is
//      closer than the strictness threshold, otherwise it starts a new person,
//      and every face seen is remembered, just as recognizer.update() does.
// Nothing leaves the device: the photos are read here and never sent anywhere.
"use strict";
let cascade = null;
let cache = null;                 // {sig, faces: [[hist,...] per photo]} reused when only the threshold changes

async function loadCascade() {
  if (cascade) return cascade;
  const c = await (await fetch("cascade.json")).json();
  cascade = c;
  return c;
}

// ------------------------------------------------------------ image → grey
async function greyOf(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 600 / Math.max(bmp.width, bmp.height));   // thumbnail: only ever shrink
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = new OffscreenCanvas(w, h), ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114 + 500) / 1000 | 0;
  return { g, w, h };
}

// ------------------------------------------------------------ Haar cascade
function integrals(g, w, h) {
  const W = w + 1, ii = new Float64Array(W * (h + 1)), sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]; rs += v; rq += v * v;
      ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + rs;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rq;
    }
  }
  return { ii, sq, W };
}
const rsum = (t, W, x, y, w, h) => t[(y + h) * W + x + w] - t[y * W + x + w] - t[(y + h) * W + x] + t[y * W + x];

function scaledCascade(c, s) {
  // rects at this scale; the first weight is re-balanced so the rounded
  // rectangles still sum to zero over a flat patch (as OpenCV does)
  return c.stages.map(([thr, trees]) => [thr, trees.map(([rects, t, l, r]) => {
    const rr = rects.map(([x, y, w, h, wt]) => [Math.round(x * s), Math.round(y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), wt]);
    if (rr.length > 1) {
      let acc = 0;
      for (let i = 1; i < rr.length; i++) acc += rr[i][2] * rr[i][3] * rr[i][4];
      rr[0][4] = -acc / (rr[0][2] * rr[0][3]);
    }
    return [rr, t, l, r];
  })]);
}

function detect(img, c) {
  const { g, w, h } = img;
  const { ii, sq, W } = integrals(g, w, h);
  const found = [];
  for (let s = 1; Math.round(c.width * s) <= Math.min(w, h); s *= 1.1) {
    const win = Math.round(c.width * s), sc = scaledCascade(c, s);
    const step = Math.max(1, Math.round(2 * s)), inv = 1 / (win * win);
    for (let y = 0; y + win <= h; y += step) {
      for (let x = 0; x + win <= w; x += step) {
        const sum = rsum(ii, W, x, y, win, win), sqs = rsum(sq, W, x, y, win, win);
        const mean = sum * inv, v = sqs * inv - mean * mean, std = v > 0 ? Math.sqrt(v) : 1;
        let pass = true;
        for (let k = 0; k < sc.length; k++) {
          const [thr, trees] = sc[k];
          let st = 0;
          for (let t = 0; t < trees.length; t++) {
            const [rr, tt, l, r] = trees[t];
            let f = 0;
            for (let q = 0; q < rr.length; q++) { const R = rr[q]; f += R[4] * rsum(ii, W, x + R[0], y + R[1], R[2], R[3]); }
            st += f * inv < tt * std ? l : r;
          }
          if (st < thr) { pass = false; break; }
        }
        if (pass) found.push([x, y, win, win]);
      }
    }
  }
  return group(found, 5, 0.2);
}

// OpenCV's groupRectangles: cluster near-identical hits, keep clusters with more than minNeighbors
function group(rects, minNeighbors, eps) {
  const n = rects.length, parent = rects.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const similar = (a, b) => {
    const d = eps * (Math.min(a[2], b[2]) + Math.min(a[3], b[3])) * 0.5;
    return Math.abs(a[0] - b[0]) <= d && Math.abs(a[1] - b[1]) <= d &&
           Math.abs(a[0] + a[2] - b[0] - b[2]) <= d && Math.abs(a[1] + a[3] - b[1] - b[3]) <= d;
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (similar(rects[i], rects[j])) parent[find(i)] = find(j);
  const acc = new Map();
  rects.forEach((r, i) => {
    const k = find(i), a = acc.get(k) || [0, 0, 0, 0, 0];
    a[0] += r[0]; a[1] += r[1]; a[2] += r[2]; a[3] += r[3]; a[4]++; acc.set(k, a);
  });
  const out = [];
  for (const a of acc.values()) if (a[4] > minNeighbors) out.push([a[0] / a[4], a[1] / a[4], a[2] / a[4], a[3] / a[4]].map(Math.round));
  return out;
}

// ------------------------------------------------------------ LBPH
function cropResize(img, x, y, w, h, S = 200) {
  // bilinear, like cv2.resize(..., INTER_LINEAR)
  const out = new Float32Array(S * S), sx = w / S, sy = h / S;
  for (let j = 0; j < S; j++) {
    const fy = Math.min(h - 1, Math.max(0, (j + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let i = 0; i < S; i++) {
      const fx = Math.min(w - 1, Math.max(0, (i + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const p = (yy, xx) => img.g[(y + yy) * img.w + (x + xx)];
      out[j * S + i] = Math.round((p(y0, x0) * (1 - tx) + p(y0, x1) * tx) * (1 - ty) + (p(y1, x0) * (1 - tx) + p(y1, x1) * tx) * ty);
    }
  }
  return out;
}
function lbphHistogram(src, S = 200, R = 1, N = 8, GX = 8, GY = 8) {
  const L = S - 2 * R, lbp = new Uint8Array(L * L), EPS = 1.1920929e-7;
  for (let n = 0; n < N; n++) {
    const x = R * Math.cos(2 * Math.PI * n / N), y = -R * Math.sin(2 * Math.PI * n / N);
    const fx = Math.floor(x), fy = Math.floor(y), cx = Math.ceil(x), cy = Math.ceil(y);
    const tx = x - fx, ty = y - fy;
    const w1 = (1 - tx) * (1 - ty), w2 = tx * (1 - ty), w3 = (1 - tx) * ty, w4 = tx * ty;
    for (let i = R; i < S - R; i++) for (let j = R; j < S - R; j++) {
      const t = w1 * src[(i + fy) * S + j + fx] + w2 * src[(i + fy) * S + j + cx] + w3 * src[(i + cy) * S + j + fx] + w4 * src[(i + cy) * S + j + cx];
      const c = src[i * S + j];
      if (t > c || Math.abs(t - c) < EPS) lbp[(i - R) * L + (j - R)] |= 1 << n;
    }
  }
  const cw = Math.floor(L / GX), ch = Math.floor(L / GY), hist = new Float32Array(GX * GY * 256);
  for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
    const base = (gy * GX + gx) * 256;
    for (let yy = gy * ch; yy < (gy + 1) * ch; yy++) for (let xx = gx * cw; xx < (gx + 1) * cw; xx++) hist[base + lbp[yy * L + xx]]++;
    for (let b = 0; b < 256; b++) hist[base + b] /= cw * ch;
  }
  return hist;
}
function chi2(a, b) {               // OpenCV HISTCMP_CHISQR_ALT
  let d = 0;
  for (let i = 0; i < a.length; i++) { const s = a[i] + b[i]; if (s > 0) { const df = a[i] - b[i]; d += df * df / s; } }
  return 2 * d;
}

// ------------------------------------------------------------ the sort
onmessage = async e => {
  const { files, threshold, sig, debug } = e.data;
  try {
    const c = await loadCascade();
    const t0 = performance.now();
    if (!cache || cache.sig !== sig) {
      const faces = [], boxes = [];
      for (let i = 0; i < files.length; i++) {
        let hs = [], bx = [];
        try {
          const img = await greyOf(files[i]);
          bx = detect(img, c);
          hs = bx.map(([x, y, w, h]) => lbphHistogram(cropResize(img, x, y, Math.min(w, img.w - x), Math.min(h, img.h - y))));
        } catch (_) { hs = null; }              // unreadable file
        faces.push(hs); boxes.push(bx);
        postMessage({ type: "progress", done: i + 1, total: files.length, stage: "finding faces" });
      }
      cache = { sig, faces, boxes };
    }
    // recognition: the same discover-as-you-go pass as face_sorter.py
    const known = [], groups = { "No_Faces_Detected": [] }, unreadable = [], dists = [];
    let next = 1;
    cache.faces.forEach((hs, i) => {
      if (hs === null) { unreadable.push(i); return; }
      if (!hs.length) { groups["No_Faces_Detected"].push(i); return; }
      for (const h of hs) {
        let best = -1, bestD = Infinity;
        for (const k of known) { const d = chi2(h, k.h); if (d < bestD) { bestD = d; best = k.id; } }
        if (best > 0) dists.push([i, best, Math.round(bestD * 100) / 100]);
        let id;
        if (best > 0 && bestD < threshold) id = best;
        else id = next++;
        known.push({ id, h });
        const key = "Person_" + id;
        (groups[key] = groups[key] || []);
        if (!groups[key].includes(i)) groups[key].push(i);
      }
    });
    if (!groups["No_Faces_Detected"].length) delete groups["No_Faces_Detected"];
    postMessage({ type: "done", groups, people: next - 1, unreadable, ms: performance.now() - t0,
                  debug: debug ? { boxes: cache.boxes, dists } : undefined,
                  faces: cache.faces.reduce((a, hs) => a + (hs ? hs.length : 0), 0) });
  } catch (err) {
    postMessage({ type: "error", message: String(err && err.message || err) });
  }
};
