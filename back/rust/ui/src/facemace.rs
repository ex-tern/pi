// FaceMace in Rust: sort photos by face (facemace.js and facemace/worker.js of the old page; a browser port of
// neurophilic/FaceID's face_sorter.py, step for step):
//   1. each photo is shrunk to fit 600×600 (the browser decodes it: host "rgba") and turned to greyscale here;
//   2. faces are found with OpenCV's Haar cascade (haarcascade_frontalface_default, front/facemace/cascade.json),
//      scale step 1.1, at least 5 neighbours;
//   3. each face is resized to 200×200 and described as OpenCV's LBPH recogniser does (radius 1, 8 neighbours, an
//      8×8 grid of 256-bin histograms);
//   4. a face goes to the nearest known person (chi-square) if closer than the strictness, otherwise it starts a new
//      person, and every face seen is remembered.
// Everything runs on this device: no photo is uploaded. The result downloads as a ZIP of folders
// (Auto_Sorted_Faces/Person_1, …, No_Faces_Detected), built here. Included into app.rs.

struct Haar {
    w: usize,
    stages: Vec<(f64, Vec<(Vec<[f64; 5]>, f64, f64, f64)>)>,
}

fn haar_of(v: &Value) -> Option<Haar> {
    let w = v.get("width").f() as usize;
    if w == 0 {
        return None;
    }
    let stages = v
        .get("stages")
        .arr()
        .iter()
        .map(|st_| {
            let a = st_.arr();
            let thr = a.first().map(|x| x.f()).unwrap_or(0.0);
            let trees = a
                .get(1)
                .map(|t| t.arr())
                .unwrap_or(&[])
                .iter()
                .map(|tr| {
                    let t = tr.arr();
                    let rects = t.first().map(|r| r.arr()).unwrap_or(&[]).iter().map(|r| {
                        let q = r.arr();
                        let g = |i: usize| q.get(i).map(|x| x.f()).unwrap_or(0.0);
                        [g(0), g(1), g(2), g(3), g(4)]
                    }).collect();
                    (rects, t.get(1).map(|x| x.f()).unwrap_or(0.0), t.get(2).map(|x| x.f()).unwrap_or(0.0), t.get(3).map(|x| x.f()).unwrap_or(0.0))
                })
                .collect();
            (thr, trees)
        })
        .collect();
    Some(Haar { w, stages })
}

struct Grey {
    g: Vec<u8>,
    w: usize,
    h: usize,
}

fn round_f(x: f64) -> f64 {
    floor_f(x + 0.5)
}

fn integrals(img: &Grey) -> (Vec<f64>, Vec<f64>, usize) {
    let ww = img.w + 1;
    let mut ii = alloc::vec![0.0f64; ww * (img.h + 1)];
    let mut sq = alloc::vec![0.0f64; ww * (img.h + 1)];
    for y in 0..img.h {
        let (mut rs, mut rq) = (0.0, 0.0);
        for x in 0..img.w {
            let v = img.g[y * img.w + x] as f64;
            rs += v;
            rq += v * v;
            ii[(y + 1) * ww + x + 1] = ii[y * ww + x + 1] + rs;
            sq[(y + 1) * ww + x + 1] = sq[y * ww + x + 1] + rq;
        }
    }
    (ii, sq, ww)
}

fn rsum(t: &[f64], ww: usize, x: usize, y: usize, w: usize, h: usize) -> f64 {
    t[(y + h) * ww + x + w] - t[y * ww + x + w] - t[(y + h) * ww + x] + t[y * ww + x]
}

fn detect(img: &Grey, c: &Haar) -> Vec<[f64; 4]> {
    let (ii, sq, ww) = integrals(img);
    let mut found: Vec<[f64; 4]> = Vec::new();
    let mut s = 1.0f64;
    while round_f(c.w as f64 * s) as usize <= img.w.min(img.h) {
        let win = round_f(c.w as f64 * s) as usize;
        // the cascade at this scale; the first weight re-balanced so a flat patch still sums to zero, as OpenCV does
        let sc: Vec<(f64, Vec<(Vec<(usize, usize, usize, usize, f64)>, f64, f64, f64)>)> = c
            .stages
            .iter()
            .map(|(thr, trees)| {
                (
                    *thr,
                    trees
                        .iter()
                        .map(|(rects, t, l, r)| {
                            let mut rr: Vec<(usize, usize, usize, usize, f64)> = rects
                                .iter()
                                .map(|q| (round_f(q[0] * s) as usize, round_f(q[1] * s) as usize, (round_f(q[2] * s) as usize).max(1), (round_f(q[3] * s) as usize).max(1), q[4]))
                                .collect();
                            if rr.len() > 1 {
                                let acc: f64 = rr[1..].iter().map(|q| (q.2 * q.3) as f64 * q.4).sum();
                                rr[0].4 = -acc / (rr[0].2 * rr[0].3) as f64;
                            }
                            (rr, *t, *l, *r)
                        })
                        .collect(),
                )
            })
            .collect();
        let step = (round_f(2.0 * s) as usize).max(1);
        let inv = 1.0 / (win * win) as f64;
        let mut y = 0;
        while y + win <= img.h {
            let mut x = 0;
            while x + win <= img.w {
                let sum = rsum(&ii, ww, x, y, win, win);
                let sqs = rsum(&sq, ww, x, y, win, win);
                let mean = sum * inv;
                let v = sqs * inv - mean * mean;
                let std = if v > 0.0 { sqrt_f(v) } else { 1.0 };
                let mut pass = true;
                for (thr, trees) in &sc {
                    let mut stv = 0.0;
                    for (rr, t, l, r) in trees {
                        let mut f = 0.0;
                        for q in rr {
                            if x + q.0 + q.2 <= img.w && y + q.1 + q.3 <= img.h {
                                f += q.4 * rsum(&ii, ww, x + q.0, y + q.1, q.2, q.3);
                            }
                        }
                        stv += if f * inv < t * std { *l } else { *r };
                    }
                    if stv < *thr {
                        pass = false;
                        break;
                    }
                }
                if pass {
                    found.push([x as f64, y as f64, win as f64, win as f64]);
                }
                x += step;
            }
            y += step;
        }
        s *= 1.1;
    }
    group_rects(&found, 5, 0.2)
}

/// OpenCV's groupRectangles: cluster near-identical hits, keep clusters with more than `min_n` members.
fn group_rects(rects: &[[f64; 4]], min_n: usize, eps: f64) -> Vec<[f64; 4]> {
    let n = rects.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(p: &mut [usize], i: usize) -> usize {
        let mut r = i;
        while p[r] != r {
            r = p[r];
        }
        let mut j = i;
        while p[j] != r {
            let nx = p[j];
            p[j] = r;
            j = nx;
        }
        r
    }
    let similar = |a: &[f64; 4], b: &[f64; 4]| {
        let d = eps * (a[2].min(b[2]) + a[3].min(b[3])) * 0.5;
        (a[0] - b[0]).abs() <= d && (a[1] - b[1]).abs() <= d && (a[0] + a[2] - b[0] - b[2]).abs() <= d && (a[1] + a[3] - b[1] - b[3]).abs() <= d
    };
    for i in 0..n {
        for j in i + 1..n {
            if similar(&rects[i], &rects[j]) {
                let (a, b) = (find(&mut parent, i), find(&mut parent, j));
                parent[a] = b;
            }
        }
    }
    let mut acc: BTreeMap<usize, [f64; 5]> = BTreeMap::new();
    for (i, r) in rects.iter().enumerate() {
        let k = find(&mut parent, i);
        let a = acc.entry(k).or_insert([0.0; 5]);
        a[0] += r[0];
        a[1] += r[1];
        a[2] += r[2];
        a[3] += r[3];
        a[4] += 1.0;
    }
    acc.values().filter(|a| a[4] as usize > min_n).map(|a| [round_f(a[0] / a[4]), round_f(a[1] / a[4]), round_f(a[2] / a[4]), round_f(a[3] / a[4])]).collect()
}

/// A face, cropped and resized to 200×200 (bilinear, like cv2.resize INTER_LINEAR).
fn crop_resize(img: &Grey, x: usize, y: usize, w: usize, h: usize) -> Vec<f64> {
    const S: usize = 200;
    let mut out = alloc::vec![0.0; S * S];
    let (sx, sy) = (w as f64 / S as f64, h as f64 / S as f64);
    for j in 0..S {
        let fy = ((j as f64 + 0.5) * sy - 0.5).clamp(0.0, (h - 1) as f64);
        let y0 = floor_f(fy) as usize;
        let y1 = (y0 + 1).min(h - 1);
        let ty = fy - y0 as f64;
        for i in 0..S {
            let fx = ((i as f64 + 0.5) * sx - 0.5).clamp(0.0, (w - 1) as f64);
            let x0 = floor_f(fx) as usize;
            let x1 = (x0 + 1).min(w - 1);
            let tx = fx - x0 as f64;
            let p = |yy: usize, xx: usize| img.g[(y + yy) * img.w + x + xx] as f64;
            out[j * S + i] = round_f((p(y0, x0) * (1.0 - tx) + p(y0, x1) * tx) * (1.0 - ty) + (p(y1, x0) * (1.0 - tx) + p(y1, x1) * tx) * ty);
        }
    }
    out
}

fn lbph(src: &[f64]) -> Vec<f32> {
    const S: usize = 200;
    const R: usize = 1;
    const NB: usize = 8;
    const G: usize = 8;
    let l = S - 2 * R;
    let mut code = alloc::vec![0u8; l * l];
    let eps = 1.192_092_9e-7;
    for n in 0..NB {
        let a = 2.0 * core::f64::consts::PI * n as f64 / NB as f64;
        let (x, y) = (R as f64 * cos_f(a), -(R as f64) * sin_f(a));
        let (fx, fy) = (floor_f(x), floor_f(y));
        let (cxx, cyy) = (if x > fx { fx + 1.0 } else { fx }, if y > fy { fy + 1.0 } else { fy });
        let (tx, ty) = (x - fx, y - fy);
        let (w1, w2, w3, w4) = ((1.0 - tx) * (1.0 - ty), tx * (1.0 - ty), (1.0 - tx) * ty, tx * ty);
        let at = |i: isize, j: isize| src[(i as usize) * S + j as usize];
        for i in R..S - R {
            for j in R..S - R {
                let (ii, jj) = (i as isize, j as isize);
                let t = w1 * at(ii + fy as isize, jj + fx as isize) + w2 * at(ii + fy as isize, jj + cxx as isize) + w3 * at(ii + cyy as isize, jj + fx as isize) + w4 * at(ii + cyy as isize, jj + cxx as isize);
                let c = src[i * S + j];
                if t > c || (t - c).abs() < eps {
                    code[(i - R) * l + (j - R)] |= 1 << n;
                }
            }
        }
    }
    let (cw, ch) = (l / G, l / G);
    let mut hist = alloc::vec![0.0f32; G * G * 256];
    for gy in 0..G {
        for gx in 0..G {
            let base = (gy * G + gx) * 256;
            for yy in gy * ch..(gy + 1) * ch {
                for xx in gx * cw..(gx + 1) * cw {
                    hist[base + code[yy * l + xx] as usize] += 1.0;
                }
            }
            for b in 0..256 {
                hist[base + b] /= (cw * ch) as f32;
            }
        }
    }
    hist
}

/// How far apart two faces are, and whether that is the same person at this strictness: SFace descriptions (128
/// numbers, unit length) by cosine (OpenCV's threshold 0.363 at the default strictness), LBPH histograms by
/// chi-square, as before. A lower strictness is stricter for both.
fn face_dist(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() {
        return f64::INFINITY;
    }
    if a.len() == 128 {
        let dot: f64 = a.iter().zip(b).map(|(x, y)| (*x as f64) * (*y as f64)).sum();
        return 1.0 - dot;
    }
    chi2(a, b)
}

fn face_thr(strict: f64, emb: bool) -> f64 {
    if emb { 1.0 - (0.363 + (75.0 - strict) * 0.004).clamp(0.15, 0.7) } else { strict }
}

fn chi2(a: &[f32], b: &[f32]) -> f64 {
    let mut d = 0.0f64;
    for i in 0..a.len() {
        let s = (a[i] + b[i]) as f64;
        if s > 0.0 {
            let df = (a[i] - b[i]) as f64;
            d += df * df / s;
        }
    }
    2.0 * d
}

// ---------------------------------------------------------------------------------------------- the tool

#[derive(Default)]
pub struct Face {
    files: Vec<(u32, f64, String)>,
    strict: f64,
    cascade: Option<Haar>,
    cascade_busy: bool,
    running: bool,
    at: usize,
    /// per photo: its faces' histograms (None: unreadable), found once for these files
    faces: Vec<Option<Vec<Vec<f32>>>>,
    started: f64,
    result: Option<FaceResult>,
    msg: String,
    zip: Vec<(String, Vec<u8>)>,
    /// names given to the people found (by group, "Person_3" → "Anna")
    names: BTreeMap<String, String>,
    /// the ZIP as one folder of copies renamed by date: 0000001-Anna.jpg, 0000002-unknown.jpg, …
    by_date: bool,
    /// reading when each one was taken: the files in turn (k), what is being read of the current one
    date_list: Vec<usize>,
    date_k: usize,
    date_step: u8,
    date_pos: u64,
    dates: Vec<(usize, u64)>,
    /// a folder on this computer the results are written into as they come (owner, 2026-10-15: "add uploading
    /// pictures as they get processed to a new folder real time"): its name, how many are written, what went wrong
    out_dir: Option<String>,
    out_asked: usize,
    out_saved: usize,
    out_msg: String,
    /// sorting into it as each photo is scanned: the faces known so far (person, histogram), the next person's
    /// number, the names already used in each person's folder
    live_known: Vec<(usize, Vec<f32>)>,
    live_next: usize,
    live_used: BTreeMap<String, Vec<String>>,
    /// leaving out duplicates (owner, 2026-10-15: "add delete duplicates option"): per file, a picture hash (256
    /// bits) and the decoded size; the live index while scanning
    dedupe: bool,
    pics: Vec<Option<([u64; 4], usize, usize, u8)>>,
    live_idx: BTreeMap<(u8, u64), Vec<usize>>,
    /// the neural engines (owner, 2026-10-15: "improve the face detection engine using many opensource engines"):
    /// 0 not asked, 1 loading, 2 ready, 3 not available (the cascades and LBPH are used, as before)
    ml: u8,
    ml_err: String,
    profile: Option<Haar>,
    profile_busy: bool,
    profile_tried: bool,
    /// the photo being worked on: its pixels, size, the frontal cascade's boxes, the faces to describe, and what
    /// they gave
    cur: Vec<u8>,
    cur_w: usize,
    cur_h: usize,
    cur_haar: Vec<[f64; 4]>,
    cur_pic: Option<([u64; 4], usize, usize, u8)>,
    ml_in: Vec<f32>,
    ml_faces: Vec<[f64; 14]>,
    ml_embs: Vec<Vec<f32>>,
    ml_stage: u8,
    engines_used: String,
}

struct FaceResult {
    groups: Vec<(String, Vec<usize>)>,
    people: usize,
    faces: usize,
    unreadable: usize,
    ms: f64,
    strict: f64,
    thumbs: Vec<(usize, String)>,
    /// (left out, the one kept)
    dups: Vec<(usize, usize)>,
}

const FACE_TOKEN: u32 = 1_000_000;
const ML_TOKEN: u32 = 6_000_000;
const YN: usize = 640;
const ZIP_TOKEN: u32 = 2_000_000;

fn face_load() {
    let s = st();
    if s.face.strict == 0.0 {
        s.face.strict = 75.0;
    }
    if s.face.cascade.is_none() && !s.face.cascade_busy {
        s.face.cascade_busy = true;
        request(Want::Tool(Tool::Face, 0), "GET", "/facemace/cascade.json", "", 0);
    }
    if s.face.profile.is_none() && !s.face.profile_busy && !s.face.profile_tried {
        s.face.profile_busy = true;
        request(Want::Tool(Tool::Face, 1), "GET", "/facemace/cascade-profile.json", "", 0);
    }
}

/// Everything needed to start scanning has come (or failed to): the cascades, and the neural engines' answer.
fn face_ready(f: &Face) -> bool {
    f.cascade.is_some() && !f.profile_busy && f.ml >= 2
}

fn face_apply(what: u8, v: Value, err: Option<String>) {
    let f = &mut st().face;
    if what == 1 {
        f.profile_busy = false;
        f.profile_tried = true;
        if err.is_none() {
            f.profile = haar_of(&v);
        }
    } else {
        f.cascade_busy = false;
        match err {
            Some(e) => {
                f.msg = format!("The face model could not be loaded: {}", e);
                return;
            }
            None => f.cascade = haar_of(&v),
        }
    }
    if f.running && f.at == 0 && f.faces.is_empty() && face_ready(f) {
        face_next();
    }
}

/// The neural engines' answer: loaded, or not available here (then the cascades and LBPH do the work).
fn ml_loaded(m: &str) {
    let f = &mut st().face;
    if m == "ok" {
        f.ml = 2;
    } else {
        f.ml = 3;
        f.ml_err = m.trim_start_matches("error ").to_string();
    }
    if f.running && f.at == 0 && f.faces.is_empty() && face_ready(f) {
        face_next();
    }
}

fn face_ext(name: &str) -> String {
    name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default()
}

/// The videos Face Mace takes (owner, 2026-10-15: "add renaming different video formats too"): faces are looked for
/// on one frame where the browser can play it; renamed whatever happens.
const FACE_VIDEO: [&str; 15] = ["mp4", "m4v", "mov", "3gp", "3g2", "avi", "mkv", "webm", "wmv", "mts", "m2ts", "mpg", "mpeg", "flv", "ogv"];

fn face_is_video(name: &str) -> bool {
    FACE_VIDEO.contains(&face_ext(name).as_str())
}

fn face_is_img(name: &str) -> bool {
    // HEIC/HEIF: an iPhone's photos (owner, 2026-10-15: "add HEIC format too")
    matches!(face_ext(name).as_str(), "jpg" | "jpeg" | "png" | "heic" | "heif") || face_is_video(name)
}

fn face_update(a: u16, v: String) {
    let s = st();
    let f = &mut s.face;
    match a {
        1 => {
            let mut list: Vec<(u32, f64, String)> = v
                .lines()
                .filter_map(|l| {
                    let p: Vec<&str> = l.splitn(3, '\t').collect();
                    match p.as_slice() {
                        [h, sz, name] if face_is_img(name) => Some((h.parse().ok()?, sz.parse().unwrap_or(0.0), name.to_string())),
                        _ => None,
                    }
                })
                .collect();
            list.sort_by(|a, b| a.2.cmp(&b.2));
            f.files = list;
            f.faces.clear();
            f.pics.clear();
            f.result = None;
            f.msg = if f.files.is_empty() { "No photos (JPG, PNG, HEIC) or videos found there.".into() } else { String::new() };
        }
        2 => f.strict = v.parse().unwrap_or(75.0),
        3 => {
            if f.files.is_empty() || f.running {
                return;
            }
            f.running = true;
            f.started = host::now();
            f.live_known.clear();
            f.live_next = 1;
            f.live_used.clear();
            f.live_idx.clear();
            // faces already found for these files: sorted again at once, then written to the folder from the result
            let rescan = f.faces.len() == f.files.len();
            if rescan && f.out_dir.is_some() && !f.by_date {
                face_finish();
                face_save_sorted();
                return;
            }
            if f.faces.len() == f.files.len() {
                face_finish();
            } else {
                f.faces.clear();
                f.pics.clear();
                f.at = 0;
                if f.ml == 0 {
                    f.ml = 1;
                    host::call("ml-load", "");
                }
                face_load();
                f.engines_used = String::new();
                if face_ready(f) {
                    face_next();
                }
            }
        }
        4 => face_zip(),
        7 => {
            f.out_msg.clear();
            let day = date_of_epoch(host::now() / 1000.0).replace(' ', "-");
            if host::call("pickdir", &format!("Face Mace {}", day)).is_none() {
                f.out_msg = "This browser cannot save into a folder (Chrome and Edge can): use the ZIP instead.".into();
            }
        }
        8 => {
            f.out_dir = None;
            f.out_msg.clear();
        }
        9 => {
            f.dedupe = !f.dedupe;
            // faces and fingerprints are kept: the result is worked out again at once
            if f.result.is_some() && f.faces.len() == f.files.len() && !f.running {
                face_finish();
            }
        }
        10 => {
            let Some(r) = &f.result else { return };
            let lines: Vec<String> = r.dups.iter().map(|(d, k)| format!("{}\tthe same as\t{}", f.files[*d].2, f.files[*k].2)).collect();
            host::download("Face Mace duplicates.txt", "text/plain", format!("Duplicates Face Mace left out ({}): delete these from the original folder if you wish.\n\n{}\n", lines.len(), lines.join("\n")).as_bytes());
        }
        5 => f.by_date = !f.by_date,
        // a name for the person of group a - 1000
        a if a >= 1000 => {
            let Some(k) = f.result.as_ref().and_then(|r| r.groups.get((a - 1000) as usize)).map(|g| g.0.clone()) else { return };
            let n: String = v.chars().take(60).collect();
            if n.trim().is_empty() {
                f.names.remove(&k);
            } else {
                f.names.insert(k, n);
            }
        }
        _ => {}
    }
}

/// Asks the browser for the next photo's pixels (shrunk to fit 600×600).
fn face_next() {
    let f = &mut st().face;
    if f.at >= f.files.len() {
        face_finish();
        return;
    }
    let (h, _, _) = f.files[f.at];
    host::call("rgba", &format!("{}\t{}\t600", FACE_TOKEN + f.at as u32, h));
}

/// Pixels arrived (w = 0: the file could not be read).
pub fn on_pixels(token: u32, data: Vec<u8>, w: u32, h: u32) {
    if token >= ML_TOKEN {
        if token == ML_TOKEN {
            ml_loaded(&String::from_utf8(data).unwrap_or_default());
        } else {
            ml_got(data);
        }
        render();
        return;
    }
    if token >= INTERN_TOKEN {
        intern_pixels(token - INTERN_TOKEN, data);
        render();
        return;
    }
    if token >= HAL_TOKEN {
        hal_pixels(token, data, w, h);
        render();
        return;
    }
    if token >= ETH_TOKEN {
        eth_got(data);
        render();
        return;
    }
    if token >= ZIP_TOKEN {
        if token == ZIP_TOKEN {
            date_got(data);
        } else if token == ZIP_TOKEN + 2 {
            out_answer(&String::from_utf8(data).unwrap_or_default());
        } else {
            zip_progress(&String::from_utf8(data).unwrap_or_default());
        }
        render();
        return;
    }
    let f = &mut st().face;
    let i = (token - FACE_TOKEN) as usize;
    if i != f.at || !f.running {
        return;
    }
    let mut pic = None;
    let found = if w == 0 || h == 0 {
        if face_is_video(&f.files[i].2) { Some(Vec::new()) } else { None }
    } else {
        let (w, h) = (w as usize, h as usize);
        let mut g = alloc::vec![0u8; w * h];
        for k in 0..w * h {
            let p = k * 4;
            if p + 2 < data.len() {
                g[k] = ((data[p] as u32 * 299 + data[p + 1] as u32 * 587 + data[p + 2] as u32 * 114 + 500) / 1000) as u8;
            }
        }
        let img = Grey { g, w, h };
        let mean = (img.g.iter().map(|&v| v as u64).sum::<u64>() / (img.g.len().max(1) as u64)) as u8;
        pic = Some((pic_hash(&img), w, h, mean));
        let boxes = f.cascade.as_ref().map(|c| detect(&img, c)).unwrap_or_default();
        if f.ml == 2 {
            // the neural way: YuNet looks, the cascades check it, SFace describes (ml_got goes on from here)
            f.cur = data;
            f.cur_w = w;
            f.cur_h = h;
            f.cur_haar = boxes;
            f.cur_pic = pic;
            ml_detect_start(&img);
            return;
        }
        if f.engines_used.is_empty() {
            f.engines_used = "OpenCV Haar cascade (frontal) and LBPH".into();
        }
        Some(
            boxes
                .iter()
                .map(|b| {
                    let (x, y) = (b[0] as usize, b[1] as usize);
                    let (bw, bh) = ((b[2] as usize).min(img.w - x), (b[3] as usize).min(img.h - y));
                    lbph(&crop_resize(&img, x, y, bw.max(1), bh.max(1)))
                })
                .collect(),
        )
    };
    f.faces.push(found);
    f.pics.push(pic);
    live_save(f.faces.len() - 1);
    f.at += 1;
    face_next();
    render();
}

/// A picture's fingerprint: the difference hash on a 16 × 16 grid (256 bits). The same photo copied, saved again
/// or resized gives the same, or almost the same, bits; different photos differ in many.
fn pic_hash(img: &Grey) -> [u64; 4] {
    let (gw, gh) = (17usize, 16usize);
    let mut cell = [0f64; 17 * 16];
    for cy in 0..gh {
        for cx in 0..gw {
            let (x0, x1) = (cx * img.w / gw, ((cx + 1) * img.w / gw).max(cx * img.w / gw + 1).min(img.w));
            let (y0, y1) = (cy * img.h / gh, ((cy + 1) * img.h / gh).max(cy * img.h / gh + 1).min(img.h));
            let (mut sum, mut n) = (0f64, 0f64);
            for y in y0..y1 {
                for x in x0..x1 {
                    sum += img.g[y * img.w + x] as f64;
                    n += 1.0;
                }
            }
            cell[cy * gw + cx] = if n > 0.0 { sum / n } else { 0.0 };
        }
    }
    let mut h = [0u64; 4];
    for cy in 0..gh {
        for cx in 0..16 {
            let bit = cy * 16 + cx;
            if cell[cy * gw + cx] > cell[cy * gw + cx + 1] {
                h[bit / 64] |= 1 << (bit % 64);
            }
        }
    }
    h
}

/// Whether file i is a duplicate of one seen before it (which one), adding it to the index when it is not: the
/// same picture (at most 15 of 256 bits apart, the same shape and brightness; copies measured 0 to 8 apart,
/// different photos over 100), or for a video with no picture read, the same type and the same size to the byte.
fn dup_check(f: &Face, i: usize, idx: &mut BTreeMap<(u8, u64), Vec<usize>>) -> Option<usize> {
    let (_, size, name) = &f.files[i];
    let Some(pic) = f.pics.get(i).copied().flatten() else {
        if !face_is_video(name) {
            return None;
        }
        let key = (200u8, *size as u64);
        let hit = idx.get(&key).and_then(|v| v.iter().find(|&&j| face_ext(&f.files[j].2) == face_ext(name)).copied());
        if hit.is_none() {
            idx.entry(key).or_default().push(i);
        }
        return hit;
    };
    let (h, w, ht, mean) = pic;
    // fifteen bits apart at most: one of the sixteen 16-bit pieces is then the same, so only those are compared
    let piece = |h: &[u64; 4], k: usize| (h[k / 4] >> ((k % 4) * 16)) & 0xFFFF;
    for k in 0..16usize {
        if let Some(c) = idx.get(&(k as u8, piece(&h, k))) {
            for &j in c {
                let Some((hj, wj, htj, mj)) = f.pics.get(j).copied().flatten() else { continue };
                let dist: u32 = (0..4).map(|q| (h[q] ^ hj[q]).count_ones()).sum();
                let same_shape = ((w * htj) as i64 - (wj * ht) as i64).abs() as f64 <= 0.02 * (w * htj) as f64;
                let same_light = (mean as i32 - mj as i32).abs() <= 10;
                let video_ok = !face_is_video(name) || f.files[j].1 == *size;
                if dist <= 15 && same_shape && same_light && video_ok {
                    return Some(j);
                }
            }
        }
    }
    for k in 0..16usize {
        let e = idx.entry((k as u8, piece(&h, k))).or_default();
        if !e.contains(&i) {
            e.push(i);
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------- the neural engines

/// The photo into YuNet's input: 640 × 640, BGR, 0–255, the picture scaled to fit at the top left.
fn ml_detect_start(_img: &Grey) {
    let f = &mut st().face;
    let (w, h) = (f.cur_w, f.cur_h);
    let k = YN as f64 / w.max(h) as f64;
    let (nw, nh) = ((round_f(w as f64 * k) as usize).min(YN), (round_f(h as f64 * k) as usize).min(YN));
    f.ml_in.clear();
    f.ml_in.resize(3 * YN * YN, 0.0);
    for y in 0..nh {
        for x in 0..nw {
            let (r, g, b) = bilinear(&f.cur, w, h, (x as f64 + 0.5) / k - 0.5, (y as f64 + 0.5) / k - 0.5);
            let p = y * YN + x;
            f.ml_in[p] = b;
            f.ml_in[YN * YN + p] = g;
            f.ml_in[2 * YN * YN + p] = r;
        }
    }
    f.ml_stage = 0;
    ml_run("yunet", &[1, 3, YN, YN]);
}

fn ml_run(model: &str, dims: &[usize]) {
    let f = &st().face;
    let d: Vec<String> = dims.iter().map(|x| x.to_string()).collect();
    if host::call("infer", &format!("{}\t{}\t{}\t{}", model, f.ml_in.as_ptr() as usize, f.ml_in.len(), d.join(","))).is_none() {
        // the engine is gone: this photo with no faces, and the rest the old way
        st().face.ml = 3;
        ml_photo_done();
    }
}

/// A pixel of RGBA `p` (w × h) at (x, y), bilinear, black outside.
fn bilinear(p: &[u8], w: usize, h: usize, x: f64, y: f64) -> (f32, f32, f32) {
    let (x0, y0) = (floor_f(x), floor_f(y));
    let (fx, fy) = (x - x0, y - y0);
    let px = |xi: f64, yi: f64| -> [f64; 3] {
        if xi < 0.0 || yi < 0.0 || xi >= w as f64 || yi >= h as f64 {
            return [0.0; 3];
        }
        let o = (yi as usize * w + xi as usize) * 4;
        if o + 2 >= p.len() {
            return [0.0; 3];
        }
        [p[o] as f64, p[o + 1] as f64, p[o + 2] as f64]
    };
    let (a, b, c, d) = (px(x0, y0), px(x0 + 1.0, y0), px(x0, y0 + 1.0), px(x0 + 1.0, y0 + 1.0));
    let mut o = [0f32; 3];
    for i in 0..3 {
        o[i] = (a[i] * (1.0 - fx) * (1.0 - fy) + b[i] * fx * (1.0 - fy) + c[i] * (1.0 - fx) * fy + d[i] * fx * fy) as f32;
    }
    (o[0], o[1], o[2])
}

fn iou(a: &[f64], b: &[f64]) -> f64 {
    let (x1, y1) = (a[0].max(b[0]), a[1].max(b[1]));
    let (x2, y2) = ((a[0] + a[2]).min(b[0] + b[2]), (a[1] + a[3]).min(b[1] + b[3]));
    let i = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let u = a[2] * a[3] + b[2] * b[3] - i;
    if u > 0.0 { i / u } else { 0.0 }
}

/// YuNet's output (its twelve tensors, one after the other) as faces: box and five landmarks in the photo's
/// pixels, and a score.
fn yunet_decode(o: &[f32], k: f64) -> Vec<([f64; 14], f64)> {
    let mut out: Vec<([f64; 14], f64)> = Vec::new();
    let strides = [8usize, 16, 32];
    let n: Vec<usize> = strides.iter().map(|s| (YN / s) * (YN / s)).collect();
    let total: usize = n.iter().sum();
    if o.len() < total * 16 {
        return out;
    }
    let (mut cls, mut obj, mut bb, mut kp) = (0usize, total, 2 * total, 6 * total);
    for (si, &s) in strides.iter().enumerate() {
        let cols = YN / s;
        for i in 0..n[si] {
            let sc = ((o[cls + i].clamp(0.0, 1.0) * o[obj + i].clamp(0.0, 1.0)) as f64).sqrt_c();
            if sc >= 0.45 {
                let (r, c) = ((i / cols) as f64, (i % cols) as f64);
                let b = &o[bb + i * 4..bb + i * 4 + 4];
                let (cx, cy) = ((c + b[0] as f64) * s as f64, (r + b[1] as f64) * s as f64);
                let (bw, bh) = (exp_f(b[2] as f64) * s as f64, exp_f(b[3] as f64) * s as f64);
                let mut f = [0f64; 14];
                f[0] = (cx - bw / 2.0) / k;
                f[1] = (cy - bh / 2.0) / k;
                f[2] = bw / k;
                f[3] = bh / k;
                for m in 0..5 {
                    f[4 + 2 * m] = (o[kp + i * 10 + 2 * m] as f64 + c) * s as f64 / k;
                    f[5 + 2 * m] = (o[kp + i * 10 + 2 * m + 1] as f64 + r) * s as f64 / k;
                }
                out.push((f, sc));
            }
        }
        cls += n[si];
        obj += n[si];
        bb += n[si] * 4;
        kp += n[si] * 10;
    }
    out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(core::cmp::Ordering::Equal));
    let mut keep: Vec<([f64; 14], f64)> = Vec::new();
    for c in out {
        if keep.iter().all(|k| iou(&k.0[..4], &c.0[..4]) < 0.3) {
            keep.push(c);
        }
    }
    keep
}

/// Landmarks where they usually are in a face's box (SFace's template, scaled): for a face only a cascade found.
fn landmarks_of_box(b: &[f64; 4]) -> [f64; 14] {
    let t = [(0.342, 0.462), (0.657, 0.460), (0.500, 0.641), (0.371, 0.825), (0.631, 0.824)];
    let mut f = [0f64; 14];
    f[..4].copy_from_slice(b);
    for (m, (rx, ry)) in t.iter().enumerate() {
        f[4 + 2 * m] = b[0] + rx * b[2];
        f[5 + 2 * m] = b[1] + ry * b[3];
    }
    f
}

/// What the engines saw, put together: YuNet's sure faces; its less sure ones a cascade also found; faces both
/// cascades (frontal and profile) found; and, when nothing else was found, a profile face (a face turned aside).
fn ml_ensemble(yn: Vec<([f64; 14], f64)>) -> Vec<[f64; 14]> {
    let f = &st().face;
    let mut out: Vec<[f64; 14]> = Vec::new();
    for (face, sc) in &yn {
        let confirmed = f.cur_haar.iter().any(|h| iou(h, &face[..4]) >= 0.3);
        if *sc >= 0.7 || confirmed {
            out.push(*face);
        }
    }
    let profile: Vec<[f64; 4]> = if out.is_empty() { profile_boxes(f) } else { Vec::new() };
    for h in &f.cur_haar {
        if out.iter().any(|o| iou(&o[..4], h) >= 0.3) {
            continue;
        }
        if profile.iter().any(|p| iou(p, h) >= 0.3) {
            out.push(landmarks_of_box(h));
        }
    }
    if out.is_empty() {
        for p in profile.iter().filter(|p| p[2] >= 40.0) {
            if out.iter().all(|o| iou(&o[..4], p) < 0.3) {
                out.push(landmarks_of_box(p));
            }
        }
    }
    out.retain(|o| o[2] >= 20.0 && o[3] >= 20.0);
    out
}

/// The profile cascade on the photo and on its mirror image (it knows faces turned one way only).
fn profile_boxes(f: &Face) -> Vec<[f64; 4]> {
    let Some(c) = &f.profile else { return Vec::new() };
    let (w, h) = (f.cur_w, f.cur_h);
    let mut g = alloc::vec![0u8; w * h];
    for k in 0..w * h {
        let p = k * 4;
        if p + 2 < f.cur.len() {
            g[k] = ((f.cur[p] as u32 * 299 + f.cur[p + 1] as u32 * 587 + f.cur[p + 2] as u32 * 114 + 500) / 1000) as u8;
        }
    }
    let mut out: Vec<[f64; 4]> = detect(&Grey { g: g.clone(), w, h }, c);
    let mut m = alloc::vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            m[y * w + x] = g[y * w + (w - 1 - x)];
        }
    }
    for b in detect(&Grey { g: m, w, h }, c) {
        out.push([w as f64 - b[0] - b[2], b[1], b[2], b[3]]);
    }
    out
}

/// A face, aligned on its landmarks to SFace's 112 × 112 template (a similarity transform, least squares), as RGB.
fn ml_align(face: &[f64; 14]) {
    let f = &mut st().face;
    let t = [(38.2946, 51.6963), (73.5318, 51.5014), (56.0252, 71.7366), (41.5493, 92.3655), (70.7299, 92.2041)];
    let src: Vec<(f64, f64)> = (0..5).map(|m| (face[4 + 2 * m], face[5 + 2 * m])).collect();
    let (ms, md) = (
        (src.iter().map(|p| p.0).sum::<f64>() / 5.0, src.iter().map(|p| p.1).sum::<f64>() / 5.0),
        (t.iter().map(|p| p.0).sum::<f64>() / 5.0, t.iter().map(|p| p.1).sum::<f64>() / 5.0),
    );
    let (mut num_a, mut num_b, mut den) = (0.0, 0.0, 0.0);
    for m in 0..5 {
        let (xs, ys) = (src[m].0 - ms.0, src[m].1 - ms.1);
        let (xd, yd) = (t[m].0 - md.0, t[m].1 - md.1);
        num_a += xs * xd + ys * yd;
        num_b += xs * yd - ys * xd;
        den += xs * xs + ys * ys;
    }
    let (a, b) = if den > 0.0 { (num_a / den, num_b / den) } else { (1.0, 0.0) };
    let (tx, ty) = (md.0 - (a * ms.0 - b * ms.1), md.1 - (b * ms.0 + a * ms.1));
    let n2 = (a * a + b * b).max(1e-12);
    f.ml_in.clear();
    f.ml_in.resize(3 * 112 * 112, 0.0);
    for v in 0..112 {
        for u in 0..112 {
            let (dx, dy) = (u as f64 - tx, v as f64 - ty);
            let (sx, sy) = ((a * dx + b * dy) / n2, (-b * dx + a * dy) / n2);
            let (r, g, bl) = bilinear(&f.cur, f.cur_w, f.cur_h, sx, sy);
            let p = v * 112 + u;
            f.ml_in[p] = r;
            f.ml_in[112 * 112 + p] = g;
            f.ml_in[2 * 112 * 112 + p] = bl;
        }
    }
}

/// An engine answered: YuNet's faces (stage 0) or one face's SFace description (stage 1).
fn ml_got(data: Vec<u8>) {
    let f = &mut st().face;
    if !f.running {
        return;
    }
    let floats: Vec<f32> = data.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    if f.ml_stage == 0 {
        let k = YN as f64 / f.cur_w.max(f.cur_h).max(1) as f64;
        let yn = yunet_decode(&floats, k);
        let faces = ml_ensemble(yn);
        let f = &mut st().face;
        f.ml_faces = faces;
        f.ml_embs.clear();
        if f.engines_used.is_empty() {
            f.engines_used = "YuNet, OpenCV Haar cascades (frontal and profile), SFace".into();
        }
        ml_next_face();
    } else {
        if floats.len() == 128 {
            let n = floats.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>().sqrt_c().max(1e-9);
            f.ml_embs.push(floats.iter().map(|v| (*v as f64 / n) as f32).collect());
        }
        ml_next_face();
    }
}

fn ml_next_face() {
    let f = &mut st().face;
    if let Some(face) = f.ml_faces.pop() {
        ml_align(&face);
        st().face.ml_stage = 1;
        ml_run("sface", &[1, 3, 112, 112]);
    } else {
        ml_photo_done();
    }
}

/// The photo is done: its faces' descriptions are kept, and the next one is asked for.
fn ml_photo_done() {
    let f = &mut st().face;
    let embs = core::mem::take(&mut f.ml_embs);
    f.faces.push(Some(embs));
    f.pics.push(f.cur_pic.take());
    f.cur.clear();
    live_save(f.faces.len() - 1);
    let f = &mut st().face;
    f.at += 1;
    face_next();
}

/// The discover-as-you-go pass of face_sorter.py, at the chosen strictness.
fn face_finish() {
    let f = &mut st().face;
    let mut known: Vec<(usize, &Vec<f32>)> = Vec::new();
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let (mut none, mut unreadable, mut next, mut nfaces) = (Vec::new(), 0usize, 1usize, 0usize);
    let mut dups: Vec<(usize, usize)> = Vec::new();
    if f.dedupe {
        // the biggest file of each set is the one kept (normally the original; a copy made smaller is let go)
        let mut order: Vec<usize> = (0..f.faces.len()).collect();
        order.sort_by(|&a, &b| f.files[b].1.partial_cmp(&f.files[a].1).unwrap_or(core::cmp::Ordering::Equal).then_with(|| f.files[a].2.cmp(&f.files[b].2)));
        let mut idx = BTreeMap::new();
        for i in order {
            if let Some(j) = dup_check(f, i, &mut idx) {
                dups.push((i, j));
            }
        }
        dups.sort_by(|a, b| f.files[a.0].2.cmp(&f.files[b.0].2));
    }
    let f = &mut st().face;
    for (i, hs) in f.faces.iter().enumerate() {
        if dups.iter().any(|d| d.0 == i) {
            continue;
        }
        let Some(hs) = hs else {
            unreadable += 1;
            continue;
        };
        if hs.is_empty() {
            none.push(i);
            continue;
        }
        for h in hs {
            nfaces += 1;
            let mut best = 0usize;
            let mut best_d = f64::INFINITY;
            for (id, k) in &known {
                let d = face_dist(h, k);
                if d < best_d {
                    best_d = d;
                    best = *id;
                }
            }
            let id = if best > 0 && best_d < face_thr(f.strict, h.len() == 128) {
                best
            } else {
                next += 1;
                next - 1
            };
            known.push((id, h));
            let g = groups.entry(id).or_default();
            if !g.contains(&i) {
                g.push(i);
            }
        }
    }
    let mut out: Vec<(String, Vec<usize>)> = groups.into_iter().map(|(id, v)| (format!("Person_{}", id), v)).collect();
    if !none.is_empty() {
        out.push(("No_Faces_Detected".to_string(), none));
    }
    // thumbnails: the first twelve of each group, as object URLs of the files themselves
    let mut thumbs = Vec::new();
    let dup_list: Vec<usize> = dups.iter().map(|d| d.0).collect();
    for idx in out.iter().map(|g| &g.1).chain(core::iter::once(&dup_list)) {
        for &i in idx.iter().take(12) {
            if !thumbs.iter().any(|(j, _)| *j == i) {
                let url = host::call("fileurl", &format!("{}", f.files[i].0)).unwrap_or_default();
                thumbs.push((i, url));
            }
        }
    }
    f.result = Some(FaceResult { groups: out, people: next - 1, faces: nfaces, unreadable, ms: host::now() - f.started, strict: f.strict, thumbs, dups });
    f.running = false;
}

// ---------------------------------------------------------------------------------------------- the ZIP (stored, as the original's folders)

fn face_zip() {
    let f = &mut st().face;
    let Some(r) = &f.result else { return };
    if f.by_date {
        // every photo and video once; named when its date is known
        let mut seen: Vec<usize> = Vec::new();
        for (_, idx) in &r.groups {
            for &i in idx {
                if !seen.contains(&i) {
                    seen.push(i);
                }
            }
        }
        f.date_list = seen;
        f.date_k = 0;
        f.dates.clear();
        f.msg = "Reading when each was taken…".to_string();
        date_begin();
        return;
    }
    let mut want = Vec::new();
    for (k, idx) in &r.groups {
        let mut used: Vec<String> = Vec::new();
        for &i in idx {
            let base = f.files[i].2.rsplit('/').next().unwrap_or("photo").replace(['\t', '\n'], " ");
            let mut name = base.clone();
            let mut n = 1;
            while used.contains(&name) {
                n += 1;
                name = match base.rsplit_once('.') {
                    Some((a, e)) => format!("{} ({}).{}", a, n, e),
                    None => format!("{} ({})", base, n),
                };
            }
            used.push(name.clone());
            want.push((format!("Auto_Sorted_Faces/{}/{}", k, name), f.files[i].0));
        }
    }
    zip_start("Auto_Sorted_Faces.zip", want);
}

/// A unique file name for `base` among those already in a folder.
fn unique_in(used: &mut Vec<String>, base: &str) -> String {
    let base = base.replace(['\t', '\n', '/', '\\'], " ");
    let mut name = base.clone();
    let mut n = 1;
    while used.contains(&name) {
        n += 1;
        name = match base.rsplit_once('.') {
            Some((a, e)) => format!("{} ({}).{}", a, n, e),
            None => format!("{} ({})", base, n),
        };
    }
    used.push(name.clone());
    name
}

/// One photo, just scanned: into its person's folder at once, by the same discover-as-you-go rule face_finish
/// uses (so the folder matches the result).
fn live_save(i: usize) {
    let f = &mut st().face;
    if f.out_dir.is_none() || f.by_date {
        return;
    }
    if f.dedupe {
        let mut idx = core::mem::take(&mut f.live_idx);
        let d = dup_check(f, i, &mut idx);
        f.live_idx = idx;
        if d.is_some() {
            return;
        }
    }
    let Some(Some(hs)) = f.faces.get(i).cloned() else { return };
    let mut people: Vec<usize> = Vec::new();
    for h in hs.iter() {
        let mut best = 0usize;
        let mut best_d = f64::INFINITY;
        for (id, k) in &f.live_known {
            let d = face_dist(h, k);
            if d < best_d {
                best_d = d;
                best = *id;
            }
        }
        let id = if best > 0 && best_d < face_thr(f.strict, h.len() == 128) {
            best
        } else {
            f.live_next += 1;
            f.live_next - 1
        };
        f.live_known.push((id, h.clone()));
        if !people.contains(&id) {
            people.push(id);
        }
    }
    let groups: Vec<String> = if people.is_empty() { alloc::vec!["No_Faces_Detected".to_string()] } else { people.iter().map(|p| format!("Person_{}", p)).collect() };
    let base = f.files[i].2.rsplit('/').next().unwrap_or("photo").to_string();
    for g in groups {
        let name = unique_in(f.live_used.entry(g.clone()).or_default(), &base);
        out_save(&format!("{}/{}", g, name), f.files[i].0);
    }
}

fn out_save(path: &str, handle: u32) {
    let f = &mut st().face;
    f.out_asked += 1;
    host::call("save", &format!("{}\t{}", path, handle));
}

/// The whole result into the folder (a strictness tried again, without scanning).
fn face_save_sorted() {
    let f = &mut st().face;
    let Some(r) = &f.result else { return };
    let mut list: Vec<(String, u32)> = Vec::new();
    for (k, idx) in &r.groups {
        let mut used = Vec::new();
        for &i in idx {
            let base = f.files[i].2.rsplit('/').next().unwrap_or("photo").to_string();
            list.push((format!("{}/{}", k, unique_in(&mut used, &base)), f.files[i].0));
        }
    }
    for (p, h) in list {
        out_save(&p, h);
    }
}

fn out_answer(m: &str) {
    let f = &mut st().face;
    if let Some(n) = m.strip_prefix("dir ") {
        f.out_dir = Some(n.to_string());
        f.out_asked = 0;
        f.out_saved = 0;
        f.out_msg.clear();
    } else if let Some(n) = m.strip_prefix("saved ") {
        f.out_saved = n.parse().unwrap_or(f.out_saved);
    } else if let Some(e) = m.strip_prefix("error ") {
        if e == "cancelled" {
            return;
        }
        f.out_msg = format!("Saving into the folder stopped: {}", e);
    }
}

/// The ZIP is made by the browser from the files themselves (host "zip"), so a set of any size, videos included,
/// never has to fit in this program's memory.
fn zip_start(name: &str, want: Vec<(String, u32)>) {
    let f = &mut st().face;
    let mut list = String::from(name);
    for (p, h) in &want {
        list.push('\n');
        list.push_str(p);
        list.push('\t');
        list.push_str(&h.to_string());
    }
    f.msg = format!("Packing {} files…", want.len());
    host::call("zip", &list);
}

fn zip_progress(m: &str) {
    let f = &mut st().face;
    f.msg = if let Some(n) = m.strip_prefix("done ") {
        format!("Downloaded {} files.", n)
    } else if let Some(e) = m.strip_prefix("error ") {
        format!("The ZIP could not be made: {}", e)
    } else {
        format!("Packing {}…", m)
    };
}

// ---------------------------------------------------------------------------------------------- when each was taken

const DATE_HEAD: u64 = 262_144;

fn date_ask(i: usize, start: u64, len: u64) {
    let h = st().face.files[i].0;
    host::call("slice", &format!("{}\t{}\t{}\t{}", ZIP_TOKEN, h, start, len));
}

fn date_begin() {
    let f = &mut st().face;
    if f.date_k >= f.date_list.len() {
        date_done();
        return;
    }
    let i = f.date_list[f.date_k];
    f.date_step = 0;
    f.date_pos = 0;
    if f.date_k % 25 == 0 {
        f.msg = format!("Reading when each was taken: {} of {}…", f.date_k + 1, f.date_list.len());
    }
    date_ask(i, 0, DATE_HEAD);
}

fn date_finish(when: Option<u64>) {
    let f = &mut st().face;
    let i = f.date_list[f.date_k];
    let when = when.unwrap_or_else(|| {
        let ms: f64 = host::call("filetime", &format!("{}", f.files[i].0)).and_then(|t| t.parse().ok()).unwrap_or(0.0);
        local_stamp(ms)
    });
    f.dates.push((i, when));
    f.date_k += 1;
    date_begin();
}

/// A part of the current file arrived: its start (step 0), a box header further on (1), the movie's header box (2)
/// or a HEIC's EXIF item (3).
fn date_got(data: Vec<u8>) {
    let f = &mut st().face;
    let Some(&i) = f.date_list.get(f.date_k) else { return };
    let (name, size) = (f.files[i].2.clone(), f.files[i].1 as u64);
    let ext = face_ext(&name);
    match f.date_step {
        0 => match ext.as_str() {
            "heic" | "heif" => match heif_exif_at(&data) {
                Some((at, len)) if at + len <= data.len() => date_finish(exif_item(&data[at..at + len])),
                Some((at, len)) => {
                    f.date_step = 3;
                    date_ask(i, at as u64, len.min(1 << 20) as u64);
                }
                None => date_finish(None),
            },
            "mp4" | "m4v" | "mov" | "3gp" | "3g2" => {
                // the boxes at the top: moov (the movie's header) may come after gigabytes of data
                let mut p = 0usize;
                loop {
                    let Some((kind, sz, _)) = box_head(&data, p) else {
                        if (p as u64) < size && p > 0 {
                            f.date_step = 1;
                            f.date_pos = p as u64;
                            date_ask(i, p as u64, 16);
                        } else {
                            date_finish(None);
                        }
                        return;
                    };
                    if &kind == b"moov" {
                        if p as u64 + sz <= data.len() as u64 {
                            date_finish(moov_date(&data[p..p + sz as usize]));
                        } else {
                            f.date_step = 2;
                            date_ask(i, p as u64, sz.min(32 << 20));
                        }
                        return;
                    }
                    if sz < 8 {
                        date_finish(None);
                        return;
                    }
                    p = match p.checked_add(sz as usize) { Some(x) => x, None => { date_finish(None); return; } };
                    if p as u64 >= size {
                        date_finish(None);
                        return;
                    }
                    if p >= data.len() {
                        f.date_step = 1;
                        f.date_pos = p as u64;
                        date_ask(i, p as u64, 16);
                        return;
                    }
                }
            }
            "mkv" | "webm" => date_finish(mkv_date(&data)),
            "avi" => date_finish(avi_date(&data)),
            _ if face_is_video(&name) => date_finish(None),
            _ => date_finish(exif_date(&data)),
        },
        1 => match box_head(&data, 0) {
            Some((kind, sz, _)) if &kind == b"moov" => {
                f.date_step = 2;
                date_ask(i, f.date_pos, sz.min(32 << 20));
            }
            Some((_, sz, _)) if sz >= 8 && f.date_pos + sz < size => {
                f.date_pos += sz;
                date_ask(i, f.date_pos, 16);
            }
            _ => date_finish(None),
        },
        2 => date_finish(moov_date(&data)),
        _ => date_finish(exif_item(&data)),
    }
}

/// Every file dated: numbered in that order and named after who is in it.
fn date_done() {
    let f = &mut st().face;
    let labels = face_labels(f);
    let mut items: Vec<(u64, String, usize)> = f.dates.iter().map(|(i, w)| (*w, f.files[*i].2.clone(), *i)).collect();
    items.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let want: Vec<(String, u32)> = items
        .into_iter()
        .enumerate()
        .map(|(k, (when, name, i))| {
            let ext = face_ext(&name);
            let ext = if ext.is_empty() || ext.len() > 5 { "jpg".to_string() } else { ext };
            let who = labels.get(&i).map(|l| l.join("-")).unwrap_or_else(|| "unknown".into());
            // then the year, Persian (Solar Hijri) and Gregorian (owner, 2026-10-15: "0000001-unknown-1382-2004")
            let years = years_of(when).map(|(p, g)| format!("-{}-{}", p, g)).unwrap_or_default();
            // in folders of a thousand, named by their range (owner, 2026-10-15: "make the photos in batch on 1000
            // output folders"): Renamed_by_date/0000001-0001000/0000001-Anna-1382-2004.jpg, then 0001001-0002000/…
            let n = k + 1;
            let first = (n - 1) / 1000 * 1000 + 1;
            (format!("Renamed_by_date/{:07}-{:07}/{:07}-{}{}.{}", first, first + 999, n, who, years, ext), f.files[i].0)
        })
        .collect();
    if f.out_dir.is_some() {
        f.msg = format!("Saving {} files into the folder…", want.len());
        for (p, h) in want {
            out_save(&p, h);
        }
        return;
    }
    zip_start("Renamed_by_date.zip", want);
}

/// A box of an ISO media file at `p`: its type, its whole size, the size of its header.
fn box_head(b: &[u8], p: usize) -> Option<([u8; 4], u64, usize)> {
    let h = b.get(p..p + 8)?;
    let kind = [h[4], h[5], h[6], h[7]];
    let sz = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as u64;
    if sz == 1 {
        let x = b.get(p + 8..p + 16)?;
        return Some((kind, u64::from_be_bytes([x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]]), 16));
    }
    Some((kind, if sz == 0 { u64::MAX / 2 } else { sz }, 8))
}

fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    if n.is_empty() || h.len() < n.len() {
        return None;
    }
    (0..=h.len() - n.len()).find(|&k| &h[k..k + n.len()] == n)
}

/// "YYYY-MM-DDThh:mm:ss" (or with ':' between the date's parts) at `k`, as a stamp.
fn iso_at(b: &[u8], k: usize) -> Option<u64> {
    let s = b.get(k..k + 19)?;
    let d = |a: usize, n: usize| -> Option<u64> { let t = core::str::from_utf8(&s[a..a + n]).ok()?; if t.bytes().all(|c| c.is_ascii_digit()) { t.parse().ok() } else { None } };
    if !(s[4] == b'-' || s[4] == b':') || !(s[10] == b'T' || s[10] == b' ') {
        return None;
    }
    let y = d(0, 4)?;
    if !(1900..2200).contains(&y) {
        return None;
    }
    Some(stamp(y, d(5, 2)?, d(8, 2)?, d(11, 2)?, d(14, 2)?, d(17, 2)?))
}

/// When a movie (MP4, MOV, 3GP) was made: a phone's local creation date where it wrote one
/// (com.apple.quicktime.creationdate), otherwise the movie header's creation time (UTC).
fn moov_date(m: &[u8]) -> Option<u64> {
    if let Some(k) = find(m, b"com.apple.quicktime.creationdate") {
        let from = find(&m[k..], b"ilst").map(|x| k + x).unwrap_or(k);
        for j in from..m.len().saturating_sub(19) {
            if m[j].is_ascii_digit() {
                if let Some(v) = iso_at(m, j) {
                    return Some(v);
                }
            }
        }
    }
    let j = find(m, b"mvhd")?;
    let v = *m.get(j + 4)?;
    let secs = if v == 1 {
        let x = m.get(j + 8..j + 16)?;
        u64::from_be_bytes([x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]])
    } else {
        let x = m.get(j + 8..j + 12)?;
        u32::from_be_bytes([x[0], x[1], x[2], x[3]]) as u64
    };
    // seconds since 1904
    let unix = secs.checked_sub(2_082_844_800)?;
    if unix < 86_400 {
        return None;
    }
    Some(local_stamp(unix as f64 * 1000.0))
}

/// Matroska / WebM: the segment's DateUTC (nanoseconds since 2001).
fn mkv_date(b: &[u8]) -> Option<u64> {
    let mut from = 0;
    while let Some(k) = find(&b[from..], &[0x44, 0x61, 0x88]).map(|x| from + x) {
        if let Some(x) = b.get(k + 3..k + 11) {
            let ns = i64::from_be_bytes([x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]]);
            let unix = ns / 1_000_000_000 + 978_307_200;
            if unix > 86_400 {
                return Some(local_stamp(unix as f64 * 1000.0));
            }
        }
        from = k + 1;
    }
    None
}

/// AVI: the IDIT chunk ("Mon Mar 10 15:04:43 2008", or "2008:03:10 15:04:43").
fn avi_date(b: &[u8]) -> Option<u64> {
    let k = find(b, b"IDIT")? + 8;
    let s = core::str::from_utf8(b.get(k..(k + 40).min(b.len()))?).ok()?.trim_matches(char::from(0)).trim().to_string();
    if let Some(v) = iso_at(s.as_bytes(), 0) {
        return Some(v);
    }
    let p: Vec<&str> = s.split_whitespace().collect();
    if p.len() < 5 {
        return None;
    }
    let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let m = months.iter().position(|x| p[1].to_lowercase().starts_with(x))? as u64 + 1;
    let t: Vec<u64> = p[3].split(':').filter_map(|x| x.parse().ok()).collect();
    Some(stamp(p[4].parse().ok()?, m, p[2].parse().ok()?, *t.first()?, *t.get(1)?, *t.get(2).unwrap_or(&0)))
}

/// Who is in each photo, as its file name will say: the names given, "unknown" for a face not named or a photo
/// with none.
fn face_labels(f: &Face) -> BTreeMap<usize, Vec<String>> {
    let mut out: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    if let Some(r) = &f.result {
        for (k, idx) in &r.groups {
            let label = f.names.get(k).map(|n| file_safe(n)).filter(|n| !n.is_empty()).unwrap_or_else(|| "unknown".to_string());
            for &i in idx {
                let l = out.entry(i).or_default();
                if !l.contains(&label) {
                    l.push(label.clone());
                }
            }
        }
    }
    // a named person first; "unknown" only when nobody in it is named
    for l in out.values_mut() {
        if l.len() > 1 {
            l.retain(|x| x != "unknown");
        }
    }
    out
}

/// A name that is safe as part of a file name anywhere (Windows included).
fn file_safe(n: &str) -> String {
    let t: String = n.trim().chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '.' || c == '_' || c == '\'' { c } else { ' ' }).collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ").trim_matches('.').to_string()
}

/// A stamp's year in the Persian (Solar Hijri) calendar and in the Gregorian one: 2004-01-15 is (1382, 2004),
/// 2004-03-25 (1383, 2004). None for a file with no date at all.
fn years_of(st_: u64) -> Option<(u64, u64)> {
    let gy = st_ / 10_000_000_000;
    let gm = st_ / 100_000_000 % 100;
    let gd = st_ / 1_000_000 % 100;
    if gy < 700 || !(1..=12).contains(&gm) || !(1..=31).contains(&gd) {
        return None;
    }
    // the usual Gregorian to Jalali conversion (the 33-year cycle arithmetic)
    let g_d_m: [i64; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let (gy, gm, gd) = (gy as i64, gm as i64, gd as i64);
    let gy2 = if gm > 2 { gy + 1 } else { gy };
    let mut days = 355_666 + 365 * gy + (gy2 + 3) / 4 - (gy2 + 99) / 100 + (gy2 + 399) / 400 + gd + g_d_m[(gm - 1) as usize];
    let mut jy = -1595 + 33 * (days / 12_053);
    days %= 12_053;
    jy += 4 * (days / 1461);
    days %= 1461;
    if days > 365 {
        jy += (days - 1) / 365;
    }
    Some((jy.max(0) as u64, gy as u64))
}

/// YYYYMMDDhhmmss as one number, so photo dates sort.
fn stamp(y: u64, mo: u64, d: u64, h: u64, mi: u64, s: u64) -> u64 {
    ((((y * 100 + mo) * 100 + d) * 100 + h) * 100 + mi) * 100 + s
}

/// A moment (ms since 1970) as a stamp in this computer's local time, as the camera's own dates are.
fn local_stamp(ms: f64) -> u64 {
    if ms <= 0.0 {
        return 0;
    }
    let off: f64 = host::call("tzoff", &format!("{:.0}", ms)).and_then(|t| t.parse().ok()).unwrap_or(0.0);
    stamp_of_ms(ms + off)
}

/// A file's time (ms since 1970, UTC) as a stamp.
fn stamp_of_ms(ms: f64) -> u64 {
    if ms <= 0.0 {
        return 0;
    }
    let secs = (ms / 1000.0) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400) as u64;
    // days since 1970 to a civil date (Howard Hinnant's algorithm)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u64;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u64;
    let y = (yoe + era * 400 + if m <= 2 { 1 } else { 0 }) as u64;
    stamp(y, m, d, rem / 3600, rem / 60 % 60, rem % 60)
}

/// When a JPEG was taken, from its EXIF (DateTimeOriginal, else DateTime): "YYYY:MM:DD hh:mm:ss" as a stamp.
fn exif_date(b: &[u8]) -> Option<u64> {
    if b.len() >= 12 && &b[4..8] == b"ftyp" {
        let (at, len) = heif_exif_at(b)?;
        return exif_item(b.get(at..at + len)?);
    }
    if b.len() < 4 || b[0] != 0xFF || b[1] != 0xD8 {
        return None;
    }
    let mut p = 2usize;
    while p + 4 <= b.len() && b[p] == 0xFF {
        let marker = b[p + 1];
        let len = ((b[p + 2] as usize) << 8) | b[p + 3] as usize;
        if marker == 0xDA || len < 2 {
            break;
        }
        if marker == 0xE1 && p + 10 <= b.len() && &b[p + 4..p + 10] == b"Exif\0\0" {
            return exif_tiff(b.get(p + 10..(p + 2 + len).min(b.len()))?);
        }
        p += 2 + len;
    }
    None
}

/// The boxes of an ISO media file (HEIC/HEIF) inside `b`: (type, content).
fn bmff_boxes(b: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    let mut p = 0usize;
    while p + 8 <= b.len() {
        let mut size = u32::from_be_bytes([b[p], b[p + 1], b[p + 2], b[p + 3]]) as u64;
        let kind = [b[p + 4], b[p + 5], b[p + 6], b[p + 7]];
        let mut head = 8usize;
        if size == 1 && p + 16 <= b.len() {
            size = u64::from_be_bytes([b[p + 8], b[p + 9], b[p + 10], b[p + 11], b[p + 12], b[p + 13], b[p + 14], b[p + 15]]);
            head = 16;
        } else if size == 0 {
            size = (b.len() - p) as u64;
        }
        if size < head as u64 || p as u64 + size > b.len() as u64 {
            break;
        }
        out.push((kind, &b[p + head..p + size as usize]));
        p += size as usize;
    }
    out
}

/// A HEIC's EXIF item: four bytes saying how far in its TIFF header starts, then the EXIF.
fn exif_item(d: &[u8]) -> Option<u64> {
    let skip = u32::from_be_bytes([*d.first()?, *d.get(1)?, *d.get(2)?, *d.get(3)?]) as usize;
    exif_tiff(d.get(4 + skip..)?)
}

/// Where a HEIC's EXIF item is (offset, length in the file): the "Exif" item named in iinf, found through iloc.
fn heif_exif_at(b: &[u8]) -> Option<(usize, usize)> {
    let meta = bmff_boxes(b).into_iter().find(|x| &x.0 == b"meta")?.1;
    let kids = bmff_boxes(meta.get(4..)?);
    let be = |s: &[u8], o: usize, n: usize| -> Option<u64> { let x = s.get(o..o + n)?; Some(x.iter().fold(0u64, |a, v| (a << 8) | *v as u64)) };
    // iinf: which item is the EXIF
    let iinf = kids.iter().find(|x| &x.0 == b"iinf")?.1;
    let start = if iinf.first() == Some(&0) { 6 } else { 8 };
    let mut exif_id = None;
    for (k, infe) in bmff_boxes(iinf.get(start..)?) {
        if &k != b"infe" || infe.len() < 12 {
            continue;
        }
        let v = infe[0];
        let (id, t) = if v >= 3 { (be(infe, 4, 4)?, infe.get(10..14)?) } else if v == 2 { (be(infe, 4, 2)?, infe.get(8..12)?) } else { continue };
        if t == b"Exif" {
            exif_id = Some(id);
        }
    }
    let exif_id = exif_id?;
    // iloc: where it is
    let iloc = kids.iter().find(|x| &x.0 == b"iloc")?.1;
    let v = *iloc.first()?;
    let (os, ls) = ((iloc.get(4)? >> 4) as usize, (iloc.get(4)? & 15) as usize);
    let (bs, is) = ((iloc.get(5)? >> 4) as usize, if v >= 1 { (iloc.get(5)? & 15) as usize } else { 0 });
    let mut p = 6usize;
    let n = if v < 2 { let n = be(iloc, p, 2)?; p += 2; n } else { let n = be(iloc, p, 4)?; p += 4; n };
    for _ in 0..n.min(10_000) {
        let id = if v < 2 { let x = be(iloc, p, 2)?; p += 2; x } else { let x = be(iloc, p, 4)?; p += 4; x };
        let method = if v >= 1 { let m = be(iloc, p, 2)? & 15; p += 2; m } else { 0 };
        p += 2; // data reference index
        let base = if bs > 0 { be(iloc, p, bs)? } else { 0 };
        p += bs;
        let ext = be(iloc, p, 2)?;
        p += 2;
        let mut first: Option<(u64, u64)> = None;
        for _ in 0..ext {
            p += is;
            let off = if os > 0 { be(iloc, p, os)? } else { 0 };
            p += os;
            let len = if ls > 0 { be(iloc, p, ls)? } else { 0 };
            p += ls;
            if first.is_none() {
                first = Some((off, len));
            }
        }
        if id == exif_id && method == 0 {
            let (off, len) = first?;
            return Some(((base + off) as usize, len as usize));
        }
    }
    None
}

fn exif_tiff(t: &[u8]) -> Option<u64> {
    if t.len() < 8 {
        return None;
    }
    let le = &t[0..2] == b"II";
    let u16_at = |o: usize| -> Option<u32> { let x = t.get(o..o + 2)?; Some(if le { u16::from_le_bytes([x[0], x[1]]) } else { u16::from_be_bytes([x[0], x[1]]) } as u32) };
    let u32_at = |o: usize| -> Option<u32> { let x = t.get(o..o + 4)?; Some(if le { u32::from_le_bytes([x[0], x[1], x[2], x[3]]) } else { u32::from_be_bytes([x[0], x[1], x[2], x[3]]) }) };
    // the entries of one directory: (tag, value or offset)
    let entries = |ifd: usize| -> Vec<(u32, u32)> {
        let n = u16_at(ifd).unwrap_or(0) as usize;
        (0..n.min(400)).filter_map(|k| { let e = ifd + 2 + k * 12; Some((u16_at(e)?, u32_at(e + 8)?)) }).collect()
    };
    let text_at = |off: u32| -> Option<u64> {
        let s = t.get(off as usize..off as usize + 19)?;
        let d = |a: usize, n: usize| -> Option<u64> { core::str::from_utf8(&s[a..a + n]).ok()?.trim().parse().ok() };
        let v = stamp(d(0, 4)?, d(5, 2)?, d(8, 2)?, d(11, 2)?, d(14, 2)?, d(17, 2)?);
        if d(0, 4)? < 1900 { None } else { Some(v) }
    };
    let ifd0 = entries(u32_at(4)? as usize);
    if let Some((_, exif)) = ifd0.iter().find(|e| e.0 == 0x8769) {
        for (tag, off) in entries(*exif as usize) {
            if tag == 0x9003 || tag == 0x9004 {
                if let Some(v) = text_at(off) {
                    return Some(v);
                }
            }
        }
    }
    ifd0.iter().find(|e| e.0 == 0x0132).and_then(|e| text_at(e.1))
}

// ---------------------------------------------------------------------------------------------- the view

fn face_view(s: &State) -> N {
    let f = &s.face;
    let strict = if f.strict == 0.0 { 75.0 } else { f.strict };
    let mut root = el("div")
        .cls("tool fm")
        .kid(el("p").cls("lede").kid(txt("Sort photos and videos by face. Choose a folder or some files: Face Mace finds the faces, learns who is who, and groups the photos by person. ")).kid(el("b").text("Everything happens on this device; no photo is uploaded.")))
        // the desktop program (owner, 2026-10-15: "a downloadable version of FaceMace in .exe file for Windows"),
        // built by GitHub on Windows from back/rust/facemace-desktop
        .kid_if(!s.app_mode, || {
            el("p")
                .cls("fm-get")
                .kid(el("a").cls("btn").attr("href", "https://github.com/ex-tern/pi/releases/download/facemace-windows/FaceMace.exe").attr("rel", "noopener").text("Download for Windows (.exe)"))
                .kid(txt(" Runs on its own, without the site or a network."))
                .into()
        })
        .kid(
            el("div")
                .cls("fm-drop")
                .on("drop", Msg::TV(Tool::Face, 1))
                .kid(el("p").text("Drop photos here"))
                .kid(
                    el("div")
                        .cls("row")
                        .kid(el("label").cls("btn").kid(txt("Choose a folder")).kid(el("input").attr("type", "file").attr("webkitdirectory", "").attr("multiple", "").attr("hidden", "").on("files", Msg::TV(Tool::Face, 1))))
                        .kid(el("label").cls("btn").kid(txt("Choose photos")).kid(el("input").attr("type", "file").attr("accept", ".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif,video/*,.mp4,.m4v,.mov,.3gp,.3g2,.avi,.mkv,.webm,.wmv,.mts,.m2ts,.mpg,.mpeg,.flv,.ogv").attr("multiple", "").attr("hidden", "").on("files", Msg::TV(Tool::Face, 1)))),
                )
                .kid(el("p").cls("hint").text(if f.files.is_empty() { f.msg.clone() } else { format!("{} photo{} ready", f.files.len(), if f.files.len() == 1 { "" } else { "s" }) })),
        )
        .kid(
            el("div")
                .cls("fm-settings")
                .kid(
                    el("label")
                        .kid(txt(format!("Match strictness {} ", strict as i64)))
                        .kid(el("input").attr("type", "range").attr("min", "40").attr("max", "120").prop("value", format!("{}", strict as i64)).on("input", Msg::TV(Tool::Face, 2))),
                )
                .kid(el("p").cls("hint").text("Lower is stricter (more people, each photo set smaller); higher is looser (more photos grouped together). Faces are found once, so trying another strictness is quick."))
                .kid(
                    el("label")
                        .cls("fm-option")
                        .kid(el("input").attr("type", "checkbox").prop("checked", if f.dedupe { "1" } else { "0" }).on("change", Msg::T(Tool::Face, 9, String::new())))
                        .kid(txt(" Delete duplicates: a photo or video that is there twice (copied, saved again or resized) is kept once, everywhere Face Mace saves. Your original folder is not changed.")),
                ),
        )
        .kid({
            let can = host::call("canpick", "").as_deref() == Some("1");
            let mut d = el("div").cls("fm-out");
            d = match &f.out_dir {
                Some(n) => d
                    .kid(el("p").kid(txt("Saving into the new folder ")).kid(el("b").text(n.clone())).kid(txt(if f.by_date { ": the renamed files, as soon as their names are known." } else { ": each photo into its person's folder as soon as it is scanned." })))
                    .kid_if(f.out_asked > 0, || el("p").cls("hint").text(format!("{} of {} saved", f.out_saved, f.out_asked)).into())
                    .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 8, String::new())).text("Stop saving to the folder")),
                None if can => d
                    .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 7, String::new())).text("Save into a folder as they are done…"))
                    .kid(el("span").cls("hint").text(" Pick where: a new folder is made there, and filled while Face Mace works.")),
                None => d.kid(el("p").cls("hint").text("Saving straight into a folder needs Chrome or Edge; here the result downloads as a ZIP.")),
            };
            d.kid_if(!f.out_msg.is_empty(), || el("p").cls("hint warn").text(f.out_msg.clone()).into())
        })
        .kid(el("button").attr("type", "button").cls("btn primary").attr_if(f.files.is_empty() || f.running, "disabled", "").on("click", Msg::T(Tool::Face, 3, String::new())).text("Sort by face"));
    if f.running {
        let total = f.files.len().max(1);
        root = root.kid(
            el("div")
                .cls("fm-progress")
                .kid(el("span").cls("md-bar").kid(el("i").style(format!("width:{:.0}%", 100.0 * f.at as f64 / total as f64))))
                .kid(el("p").cls("hint").text(if !face_ready(f) { "Loading the face engines…".to_string() } else { format!("Scanning {} of {}…", f.at + 1, f.files.len()) })),
        );
    }
    if let Some(r) = &f.result {
        let label = |k: &str| if k == "No_Faces_Detected" { "No faces found".to_string() } else { k.replace('_', " ") };
        root = root
            .kid(
                el("div")
                    .cls("md-stats")
                    .kid(el("div").kid(el("b").text(format!("{}", f.files.len()))).kid(el("span").text("photos")))
                    .kid(el("div").kid(el("b").text(format!("{}", r.people))).kid(el("span").text("people found")))
                    .kid(el("div").kid(el("b").text(format!("{}", r.faces))).kid(el("span").text("faces")))
                    .kid(el("div").kid(el("b").text(format!("{:.1} s", r.ms / 1000.0))).kid(el("span").text(format!("at strictness {}", r.strict as i64)))),
            )
            .kid(
                el("label")
                    .cls("fm-option")
                    .kid(el("input").attr("type", "checkbox").prop("checked", if f.by_date { "1" } else { "0" }).on("change", Msg::T(Tool::Face, 5, String::new())))
                    .kid(txt(" Rename the photos and videos by date: numbered in the order they were taken, then who is in them and the year, Persian and Gregorian (0000001-Anna-1382-2004.jpg, 0000002-unknown-1403-2024.mp4), in folders of a thousand (0000001-0001000, 0001001-0002000, …)")),
            )
            .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 4, String::new())).text(match (f.by_date, f.out_dir.is_some()) { (true, true) => "Save renamed into the folder", (true, false) => "Download renamed (ZIP)", _ => "Download as ZIP" })).kid(el("span").cls("hint").text(f.msg.clone())))
            .kid_if(f.by_date, || el("p").cls("hint").text("Name the people below; anyone not named is \"unknown\". The date is the one the camera or phone wrote into the photo or video where there is one, otherwise the file's. A video's faces are looked for on one frame; one the browser cannot play is renamed as unknown.").into())
            .kid_if(!f.engines_used.is_empty(), || {
                el("p").cls("hint").text(format!("Engines: {}{}.", f.engines_used, if f.ml == 3 && !f.ml_err.is_empty() { format!(" (the neural ones could not start here: {})", f.ml_err) } else { String::new() })).into()
            })
            .kid_if(r.unreadable > 0, || el("p").cls("hint").text(format!("{} file(s) could not be read and were skipped.", r.unreadable)).into())
            .kid_if(!r.dups.is_empty(), || {
                el("section")
                    .cls("fm-group fm-dups")
                    .kid(el("div").cls("fm-head").kid(el("h3").text(format!("Duplicates left out · {}", r.dups.len()))).kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 10, String::new())).text("Download the list")))
                    .kid(el("p").cls("hint").text("Each is the same picture as one kept. A browser cannot delete files from your folders: the list says which ones to delete there, if you want to."))
                    .kid(el("div").cls("fm-thumbs").kids(r.dups.iter().take(12).map(|(d, k)| -> N {
                        let url = r.thumbs.iter().find(|(j, _)| j == d).map(|x| x.1.clone()).unwrap_or_default();
                        let title = format!("{} (the same as {})", f.files[*d].2, f.files[*k].2);
                        if url.is_empty() { el("span").cls("fm-tile").attr("title", title).text(face_ext(&f.files[*d].2).to_uppercase()).into() } else { el("img").attr("loading", "lazy").attr("alt", title.clone()).attr("title", title).attr("src", url).into() }
                    })).kid_if(r.dups.len() > 12, || el("span").cls("fm-more").text(format!("+{}", r.dups.len() - 12)).into()))
                    .into()
            });
        for (gi, (k, idx)) in r.groups.iter().enumerate() {
            root = root.kid(
                el("section")
                    .cls("fm-group")
                    .kid(
                        el("div")
                            .cls("fm-head")
                            .kid(el("h3").text(format!("{} · {} photo{}", f.names.get(k).cloned().unwrap_or_else(|| label(k)), idx.len(), if idx.len() == 1 { "" } else { "s" })))
                            .kid_if(k != "No_Faces_Detected", || {
                                el("input")
                                    .cls("input fm-name")
                                    .attr("type", "text")
                                    .attr("placeholder", "Name this person")
                                    .attr("aria-label", format!("Name for {}", label(k)))
                                    .prop("value", f.names.get(k).cloned().unwrap_or_default())
                                    .on("input", Msg::TV(Tool::Face, 1000 + gi as u16))
                                    .into()
                            }),
                    )
                    .kid(
                        el("div")
                            .cls("fm-thumbs")
                            .kids(idx.iter().take(12).map(|i| -> N {
                                let url = r.thumbs.iter().find(|(j, _)| j == i).map(|x| x.1.clone()).unwrap_or_default();
                                if url.is_empty() {
                                    el("span").cls("fm-tile").attr("title", f.files[*i].2.clone()).text(face_ext(&f.files[*i].2).to_uppercase()).into()
                                } else {
                                    el("img").attr("loading", "lazy").attr("alt", f.files[*i].2.clone()).attr("title", f.files[*i].2.clone()).attr("src", url).into()
                                }
                            }))
                            .kid_if(idx.len() > 12, || el("span").cls("fm-more").text(format!("+{}", idx.len() - 12)).into()),
                    ),
            );
        }
    }
    root.into()
}

const FACE_CSS: &str = "\
.fm-drop{border:1.5px dashed var(--line2);background:#fff;padding:18px;margin:14px 0;text-align:center}\
.fm-drop .row{justify-content:center}.fm-drop label.btn{cursor:pointer}\
.fm-settings{margin:12px 0}.fm-settings input{vertical-align:middle;width:220px}\
.fm-progress{margin:14px 0}\
.fm-group{margin:16px 0}.fm-group h3{margin:0 0 8px}\
.fm-thumbs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.fm-thumbs img{width:88px;height:88px;object-fit:cover;border:1px solid var(--line)}\
.fm-more{font-size:13px;color:var(--muted);padding:0 8px}\
.fm-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:8px}.fm-head h3{margin:0}.fm-name{max-width:220px;padding:6px 10px}\
.fm-tile{width:88px;height:88px;display:grid;place-items:center;border:1px solid var(--line);background:#222;color:#fff;font-size:12px;font-weight:600}\
.fm-out{margin:10px 0 14px;display:grid;gap:6px;justify-items:start}.fm-out p{margin:0}\
.fm-option{display:flex;gap:8px;align-items:flex-start;margin:12px 0 8px;font-size:14px}\
";
