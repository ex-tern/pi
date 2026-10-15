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
    zip_want: Vec<(String, u32)>,
    /// names given to the people found (by group, "Person_3" → "Anna")
    names: BTreeMap<String, String>,
    /// the ZIP as one folder of copies renamed by date: 0000001-Anna.jpg, 0000002-unknown.jpg, …
    by_date: bool,
    zip_by_date: bool,
}

struct FaceResult {
    groups: Vec<(String, Vec<usize>)>,
    people: usize,
    faces: usize,
    unreadable: usize,
    ms: f64,
    strict: f64,
    thumbs: Vec<(usize, String)>,
}

const FACE_TOKEN: u32 = 1_000_000;
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
}

fn face_apply(v: Value, err: Option<String>) {
    let f = &mut st().face;
    f.cascade_busy = false;
    match err {
        Some(e) => f.msg = format!("The face model could not be loaded: {}", e),
        None => {
            f.cascade = haar_of(&v);
            if f.running {
                face_next();
            }
        }
    }
}

fn face_is_img(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".jpg") || n.ends_with(".jpeg") || n.ends_with(".png")
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
            f.result = None;
            f.msg = if f.files.is_empty() { "No JPG or PNG files found there.".into() } else { String::new() };
        }
        2 => f.strict = v.parse().unwrap_or(75.0),
        3 => {
            if f.files.is_empty() || f.running {
                return;
            }
            f.running = true;
            f.started = host::now();
            if f.faces.len() == f.files.len() {
                face_finish();
            } else {
                f.faces.clear();
                f.at = 0;
                if f.cascade.is_some() {
                    face_next();
                } else {
                    face_load();
                }
            }
        }
        4 => face_zip(),
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
        zip_got(token - ZIP_TOKEN, data);
        render();
        return;
    }
    let f = &mut st().face;
    let i = (token - FACE_TOKEN) as usize;
    if i != f.at || !f.running {
        return;
    }
    let found = if w == 0 || h == 0 {
        None
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
        let boxes = f.cascade.as_ref().map(|c| detect(&img, c)).unwrap_or_default();
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
    f.at += 1;
    face_next();
    render();
}

/// The discover-as-you-go pass of face_sorter.py, at the chosen strictness.
fn face_finish() {
    let f = &mut st().face;
    let mut known: Vec<(usize, &Vec<f32>)> = Vec::new();
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let (mut none, mut unreadable, mut next, mut nfaces) = (Vec::new(), 0usize, 1usize, 0usize);
    for (i, hs) in f.faces.iter().enumerate() {
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
                let d = chi2(h, k);
                if d < best_d {
                    best_d = d;
                    best = *id;
                }
            }
            let id = if best > 0 && best_d < f.strict {
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
    for (_, idx) in &out {
        for &i in idx.iter().take(12) {
            if !thumbs.iter().any(|(j, _)| *j == i) {
                let url = host::call("fileurl", &format!("{}", f.files[i].0)).unwrap_or_default();
                thumbs.push((i, url));
            }
        }
    }
    f.result = Some(FaceResult { groups: out, people: next - 1, faces: nfaces, unreadable, ms: host::now() - f.started, strict: f.strict, thumbs });
    f.running = false;
}

// ---------------------------------------------------------------------------------------------- the ZIP (stored, as the original's folders)

fn face_zip() {
    let f = &mut st().face;
    let Some(r) = &f.result else { return };
    let mut want = Vec::new();
    f.zip_by_date = f.by_date;
    if f.by_date {
        // every photo once (the name is given when its date is known, after it is read): "#index" for now
        let mut seen: Vec<usize> = Vec::new();
        for (_, idx) in &r.groups {
            for &i in idx {
                if !seen.contains(&i) {
                    seen.push(i);
                    want.push((format!("#{}", i), f.files[i].0));
                }
            }
        }
        f.zip.clear();
        f.zip_want = want;
        f.msg = "Packing…".to_string();
        zip_next();
        return;
    }
    for (k, idx) in &r.groups {
        let mut used: Vec<String> = Vec::new();
        for &i in idx {
            let base = f.files[i].2.rsplit('/').next().unwrap_or("photo").to_string();
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
    f.zip.clear();
    f.zip_want = want;
    f.msg = "Packing…".to_string();
    zip_next();
}

fn zip_next() {
    let f = &mut st().face;
    let i = f.zip.len();
    if i >= f.zip_want.len() {
        let (folder, n) = if f.zip_by_date {
            face_rename_by_date();
            ("Renamed_by_date", st().face.zip.len())
        } else {
            ("Auto_Sorted_Faces", f.zip.len())
        };
        let f = &mut st().face;
        // a ZIP holds at most 65 535 files: more go in parts
        let parts: Vec<&[(String, Vec<u8>)]> = f.zip.chunks(60_000).collect();
        for (k, part) in parts.iter().enumerate() {
            let bytes = zip_build(part);
            let name = if parts.len() == 1 { format!("{}.zip", folder) } else { format!("{}-part{}.zip", folder, k + 1) };
            host::download(&name, "application/zip", &bytes);
        }
        f.msg = format!("Downloaded {} files{}.", n, if parts.len() > 1 { format!(" in {} ZIPs", parts.len()) } else { String::new() });
        f.zip.clear();
        return;
    }
    host::call("bytes", &format!("{}\t{}", ZIP_TOKEN + i as u32, f.zip_want[i].1));
}

fn zip_got(i: u32, data: Vec<u8>) {
    let f = &mut st().face;
    if i as usize != f.zip.len() {
        return;
    }
    let path = f.zip_want[i as usize].0.clone();
    f.zip.push((path, data));
    zip_next();
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

/// The photos in the order they were taken, numbered from 0000001 (to 1000000 and on), each named after who is in
/// it: 0000001-Anna.jpg, 0000002-Anna-Marco.jpg, 0000003-unknown.jpg (owner, 2026-10-15).
fn face_rename_by_date() {
    let f = &mut st().face;
    let labels = face_labels(f);
    let mut items: Vec<(u64, String, usize, Vec<u8>)> = core::mem::take(&mut f.zip)
        .into_iter()
        .filter_map(|(tag, data)| {
            let i: usize = tag.strip_prefix('#')?.parse().ok()?;
            let when = exif_date(&data).unwrap_or_else(|| {
                let ms: f64 = host::call("filetime", &format!("{}", f.files[i].0)).and_then(|t| t.parse().ok()).unwrap_or(0.0);
                stamp_of_ms(ms)
            });
            Some((when, f.files[i].2.clone(), i, data))
        })
        .collect();
    items.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    f.zip = items
        .into_iter()
        .enumerate()
        .map(|(k, (_, name, i, data))| {
            let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).filter(|e| e.len() <= 5 && !e.contains('/')).unwrap_or_else(|| "jpg".into());
            let who = labels.get(&i).map(|l| l.join("-")).unwrap_or_else(|| "unknown".into());
            (format!("Renamed_by_date/{:07}-{}.{}", k + 1, who, ext), data)
        })
        .collect();
}

/// YYYYMMDDhhmmss as one number, so photo dates sort.
fn stamp(y: u64, mo: u64, d: u64, h: u64, mi: u64, s: u64) -> u64 {
    ((((y * 100 + mo) * 100 + d) * 100 + h) * 100 + mi) * 100 + s
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

fn crc32(b: &[u8]) -> u32 {
    let mut c: u32 = 0xFFFF_FFFF;
    for &x in b {
        c ^= x as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    c ^ 0xFFFF_FFFF
}

fn zip_build(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    let u16le = |v: &mut Vec<u8>, x: u16| v.extend_from_slice(&x.to_le_bytes());
    let u32le = |v: &mut Vec<u8>, x: u32| v.extend_from_slice(&x.to_le_bytes());
    for (path, data) in files {
        let off = out.len() as u32;
        let name = path.as_bytes();
        let crc = crc32(data);
        u32le(&mut out, 0x0403_4b50);
        u16le(&mut out, 20);
        u16le(&mut out, 0x0800);
        u16le(&mut out, 0);
        u16le(&mut out, 0);
        u16le(&mut out, 0x21);
        u32le(&mut out, crc);
        u32le(&mut out, data.len() as u32);
        u32le(&mut out, data.len() as u32);
        u16le(&mut out, name.len() as u16);
        u16le(&mut out, 0);
        out.extend_from_slice(name);
        out.extend_from_slice(data);
        u32le(&mut central, 0x0201_4b50);
        u16le(&mut central, 20);
        u16le(&mut central, 20);
        u16le(&mut central, 0x0800);
        u16le(&mut central, 0);
        u16le(&mut central, 0);
        u16le(&mut central, 0x21);
        u32le(&mut central, crc);
        u32le(&mut central, data.len() as u32);
        u32le(&mut central, data.len() as u32);
        u16le(&mut central, name.len() as u16);
        for _ in 0..4 {
            u16le(&mut central, 0);
        }
        u32le(&mut central, 0);
        u32le(&mut central, off);
        central.extend_from_slice(name);
    }
    let cd_off = out.len() as u32;
    let cd_size = central.len() as u32;
    out.extend_from_slice(&central);
    u32le(&mut out, 0x0605_4b50);
    u16le(&mut out, 0);
    u16le(&mut out, 0);
    u16le(&mut out, files.len() as u16);
    u16le(&mut out, files.len() as u16);
    u32le(&mut out, cd_size);
    u32le(&mut out, cd_off);
    u16le(&mut out, 0);
    out
}

// ---------------------------------------------------------------------------------------------- the view

fn face_view(s: &State) -> N {
    let f = &s.face;
    let strict = if f.strict == 0.0 { 75.0 } else { f.strict };
    let mut root = el("div")
        .cls("tool fm")
        .kid(el("p").cls("lede").kid(txt("Sort photos by face. Choose a folder or some photos: Face Mace finds the faces, learns who is who, and groups the photos by person. ")).kid(el("b").text("Everything happens on this device; no photo is uploaded.")))
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
                        .kid(el("label").cls("btn").kid(txt("Choose photos")).kid(el("input").attr("type", "file").attr("accept", ".jpg,.jpeg,.png,image/jpeg,image/png").attr("multiple", "").attr("hidden", "").on("files", Msg::TV(Tool::Face, 1)))),
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
                .kid(el("p").cls("hint").text("Lower is stricter (more people, each photo set smaller); higher is looser (more photos grouped together). Faces are found once, so trying another strictness is quick.")),
        )
        .kid(el("button").attr("type", "button").cls("btn primary").attr_if(f.files.is_empty() || f.running, "disabled", "").on("click", Msg::T(Tool::Face, 3, String::new())).text("Sort by face"));
    if f.running {
        let total = f.files.len().max(1);
        root = root.kid(
            el("div")
                .cls("fm-progress")
                .kid(el("span").cls("md-bar").kid(el("i").style(format!("width:{:.0}%", 100.0 * f.at as f64 / total as f64))))
                .kid(el("p").cls("hint").text(if f.cascade.is_none() { "Loading the face model…".to_string() } else { format!("Scanning photo {} of {}…", f.at + 1, f.files.len()) })),
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
                    .kid(txt(" Rename the photos by date: numbered in the order they were taken, then who is in them (0000001-Anna.jpg, 0000002-unknown.jpg), all in one folder")),
            )
            .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 4, String::new())).text(if f.by_date { "Download renamed (ZIP)" } else { "Download as ZIP" })).kid(el("span").cls("hint").text(f.msg.clone())))
            .kid_if(f.by_date, || el("p").cls("hint").text("Name the people below; anyone not named is \"unknown\". The date is the camera's (EXIF) where the photo has one, otherwise the file's.").into())
            .kid_if(r.unreadable > 0, || el("p").cls("hint").text(format!("{} file(s) could not be read and were skipped.", r.unreadable)).into());
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
                                el("img").attr("loading", "lazy").attr("alt", f.files[*i].2.clone()).attr("title", f.files[*i].2.clone()).attr("src", url).into()
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
.fm-option{display:flex;gap:8px;align-items:flex-start;margin:12px 0 8px;font-size:14px}\
";
