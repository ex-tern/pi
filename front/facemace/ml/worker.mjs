// Face Mace's neural engines in a worker of their own (owner, 2026-10-15: "when the app works the pointer doesn't
// work"): ONNX Runtime runs YuNet and SFace here, off the page's thread, so the page keeps answering the mouse while
// faces are found and described. Messages: {id, kind: "load"} → {id, ok} or {id, error}; {id, kind: "run", model,
// data, dims} → {id, out} (the floats, handed over) or {id, error}.
let ml = null;
const ML_OUT = ["cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32"];
async function load() {
  if (ml) return;
  const ort = await import("./ort.wasm.min.mjs");
  ort.env.wasm.wasmPaths = new URL("./", import.meta.url).href;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  const opt = { executionProviders: ["wasm"], graphOptimizationLevel: "all", logSeverityLevel: 3 };
  const at = (n) => new URL(n, import.meta.url).href;
  const [yunet, sface] = await Promise.all([ort.InferenceSession.create(at("yunet.onnx"), opt), ort.InferenceSession.create(at("sface.onnx"), opt)]);
  ml = { ort, yunet, sface };
}
async function run(model, data, dims) {
  const t = new ml.ort.Tensor("float32", data, dims);
  if (model === "yunet") {
    const r = await ml.yunet.run({ input: t });
    const parts = ML_OUT.map((k) => r[k].data), n = parts.reduce((a, p) => a + p.length, 0), out = new Float32Array(n);
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const r = await ml.sface.run({ data: t });
  return Float32Array.from(r.fc1.data);
}
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.kind === "load") { await load(); self.postMessage({ id: m.id, ok: true }); }
    else if (m.kind === "run") { const out = await run(m.model, m.data, m.dims); self.postMessage({ id: m.id, out }, [out.buffer]); }
  } catch (err) { self.postMessage({ id: m.id, error: String((err && err.message) || err) }); }
};
