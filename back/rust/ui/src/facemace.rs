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
    /// the folder picker is open (the box shows ticked until it answers)
    out_picking: bool,
    /// sorting into it as each photo is scanned: the faces known so far (person, histogram), the next person's
    /// number, the names already used in each person's folder
    live_clusters: Clusters,
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
    /// stopped part way (owner, 2026-10-15: "add a stop button"): Sort goes on from where it was
    stopped: bool,
    /// thumbnails made so far (file → address), so the live view does not make them again
    thumb_cache: BTreeMap<usize, String>,
    /// renaming only, no sorting (owner, 2026-10-15: "a button ... to just rename and not sort"): the pictures are
    /// only looked at for duplicates (quick), and nobody's name goes into the file names
    rename_only: bool,
    quick: bool,
    /// renamed into the folder while it works (owner, 2026-10-15: "show the renamed pictures in the folder that's
    /// selected real time"): the dates are read first, the files put in that order, and each is written with its
    /// number as soon as it is looked at; a person named later has their files renamed in the folder
    pre_dating: bool,
    live_rename: bool,
    live_no: u64,
    file_when: Vec<u64>,
    live_written: BTreeMap<usize, (u64, Vec<usize>, String)>,
    /// thousands of photos (owner, 2026-10-15: "manage thousands of photos in batches and parts"): parts of so many
    /// files at a time (0: all at once), the parts done; people known from before (a saved file); the people last
    /// found, as they can be saved; all groups shown or the biggest only; when the live view was last worked out
    part_size: usize,
    parts_done: Vec<(usize, usize)>,
    imported: Vec<(usize, Vec<Vec<f32>>)>,
    last_people: Vec<(usize, Vec<Vec<f32>>)>,
    show_all: bool,
    last_preview: f64,
    /// what the person sorting says (owner, 2026-10-15: "make the person to be selected by the user ... just like
    /// Google Photos"): this photo is this person (also a photo moved here), this photo is not this person, this
    /// person is that one; their photos shown in full; and the files written into person folders, to follow
    confirm: BTreeMap<usize, usize>,
    reject: alloc::collections::BTreeSet<(usize, usize)>,
    merge: BTreeMap<usize, usize>,
    expanded: alloc::collections::BTreeSet<usize>,
    sorted_written: BTreeMap<usize, Vec<String>>,
    /// saving (owner, 2026-10-15: "add some saving capabilities"): people and settings remembered on this device
    /// (unless turned off), and the answers of a saved work file waiting for its photos to be chosen
    forget: bool,
    restored: bool,
    pending: Vec<(String, u64, usize, bool)>,
    /// duplicates, asked about (owner, 2026-10-15: "duplicate to ask for user to delete or not delete"): kept after
    /// all, to delete, already moved aside or deleted; whether the folder was opened so that it can be changed
    dup_keep: alloc::collections::BTreeSet<usize>,
    dup_del: alloc::collections::BTreeSet<usize>,
    dup_gone: alloc::collections::BTreeSet<usize>,
    src_folder: bool,
    dup_msg: String,
    /// keeping the computer awake while it works (on unless turned off), and whether it is being kept awake now
    no_wake: bool,
    awake: bool,
    /// saved by itself: duplicate answers waiting for their photos, and a scan being looked up in the store
    pending_dups: Vec<(String, u64, bool)>,
    cache_wait: bool,
    cache_hits: usize,
    /// where each face is in its photo (x, y, w, h, as parts of the picture), as the faces; the face being
    /// described; the faces just found (for the live bubbles); the photo open in the viewer, its address, and the
    /// group it is stepped through in (owner, 2026-10-15: "a bubble of the face it is recognizing", "when clicking a
    /// bubble its picture opens", "a photo previewer when clicking on the pictures")
    boxes: Vec<Vec<[f32; 4]>>,
    ml_boxes: Vec<[f32; 4]>,
    ml_cur_box: [f32; 4],
    recent: Vec<(usize, [f32; 4])>,
    viewer: Option<(usize, Option<usize>)>,
    viewer_url: String,
}

/// The people found so far, each kept as up to forty of their faces: a new face is matched against those (not
/// against every face ever seen, which would grow without end), and starts a new person when nobody is close.
#[derive(Default, Clone)]
pub struct Clusters {
    people: Vec<(usize, Vec<Vec<f32>>)>,
    next: usize,
}

impl Clusters {
    fn seeded(known: &[(usize, Vec<Vec<f32>>)]) -> Self {
        Clusters { people: known.to_vec(), next: known.iter().map(|p| p.0).max().unwrap_or(0) + 1 }
    }

    fn assign(&mut self, h: &[f32], strict: f64) -> usize {
        let thr = face_thr(strict, h.len() == 128);
        let (mut best, mut bd) = (usize::MAX, f64::INFINITY);
        for (k, (_, ex)) in self.people.iter().enumerate() {
            for e in ex {
                let d = face_dist(h, e);
                if d < bd {
                    bd = d;
                    best = k;
                }
            }
        }
        if best != usize::MAX && bd < thr {
            let p = &mut self.people[best];
            if p.1.len() < 40 {
                p.1.push(h.to_vec());
            }
            return p.0;
        }
        if self.next == 0 {
            self.next = 1;
        }
        let id = self.next;
        self.next += 1;
        self.people.push((id, alloc::vec![h.to_vec()]));
        id
    }
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
    /// how sure the recognition is (owner, 2026-10-15: "add how much accuracy in recognizing a person"): per
    /// group, and per photo in a group; and over everything
    conf: Vec<f64>,
    photo_conf: BTreeMap<(usize, usize), f64>,
    /// per person, the clearest face (photo, where); per (group, photo), where that person's face is
    avatars: BTreeMap<usize, (usize, [f32; 4])>,
    face_at: BTreeMap<(usize, usize), [f32; 4]>,
    /// the least sure matches not yet answered: (photo, person, how sure)
    review: Vec<(usize, usize, f64)>,
    overall: Option<f64>,
    done: bool,
}

const FACE_TOKEN: u32 = 1_000_000;
const ML_TOKEN: u32 = 6_000_000;
const YN: usize = 640;
const ZIP_TOKEN: u32 = 2_000_000;

fn face_load() {
    face_restore();
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
    f.quick || (f.cascade.is_some() && !f.profile_busy && f.ml >= 2)
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
    face_update_inner(a, v);
    face_wake_sync();
    work_autosave();
}

fn face_update_inner(a: u16, v: String) {
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
            f.boxes.clear();
            f.result = None;
            f.stopped = false;
            f.thumb_cache.clear();
            f.confirm.clear();
            f.reject.clear();
            f.sorted_written.clear();
            f.dup_keep.clear();
            f.dup_del.clear();
            f.dup_gone.clear();
            f.dup_msg.clear();
            f.src_folder = false;
            work_apply_pending();
            f.msg = if f.files.is_empty() { "No photos (JPG, PNG, HEIC) or videos found there.".into() } else { String::new() };
        }
        2 => {
            f.strict = v.parse().unwrap_or(75.0);
            face_remember();
        }
        3 => {
            if f.files.is_empty() || f.running {
                return;
            }
            if f.stopped && !f.faces.is_empty() && f.faces.len() < f.files.len() {
                // stopped part way: go on from the next one
                f.stopped = false;
                f.running = true;
                f.at = f.faces.len();
                if face_ready(f) {
                    face_next();
                }
                return;
            }
            f.stopped = false;
            f.rename_only = false;
            f.quick = false;
            f.live_rename = false;
            f.cache_hits = 0;
            f.cache_wait = false;
            if f.by_date && (f.out_dir.is_some() || f.part_size > 0) && f.faces.len() != f.files.len() {
                f.started = host::now();
                predate_start();
                return;
            }
            f.running = true;
            f.started = host::now();
            f.live_clusters = Clusters::seeded(&f.imported);
            f.parts_done.clear();
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
            f.boxes.clear();
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
            f.out_picking = true;
            if host::call("pickdir", &format!("Face Mace {}", day)).is_none() {
                f.out_picking = false;
                f.out_msg = "This browser cannot save into a folder (Chrome and Edge can): use the ZIP instead.".into();
            }
        }
        8 => {
            f.out_dir = None;
            f.out_msg.clear();
        }
        9 => {
            f.dedupe = !f.dedupe;
            face_remember();
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
        5 => {
            f.by_date = !f.by_date;
            face_remember();
        }
        // the person sorting: yes, this is them / no / move to / merge / all their photos
        20 | 21 | 22 | 23 | 24 => {
            let nums: Vec<usize> = v.split('\t').filter_map(|x| x.parse().ok()).collect();
            match (a, nums.as_slice()) {
                (20, [i, p]) => {
                    f.reject.remove(&(*i, *p));
                    f.confirm.insert(*i, *p);
                }
                (21, [i, p]) => {
                    if f.confirm.get(i) == Some(p) {
                        f.confirm.remove(i);
                    }
                    f.reject.insert((*i, *p));
                }
                (22, [i, from, to]) => {
                    let to = if *to == 0 { new_person_id(f) } else { *to };
                    if *from > 0 {
                        f.reject.insert((*i, *from));
                    }
                    f.reject.remove(&(*i, to));
                    f.confirm.insert(*i, to);
                }
                (23, [from, to]) if from != to => {
                    f.merge.insert(*from, *to);
                    if let (Some(n), false) = (f.names.get(&format!("Person_{}", from)).cloned(), f.names.contains_key(&format!("Person_{}", to))) {
                        f.names.insert(format!("Person_{}", to), n);
                    }
                }
                (24, [p]) => {
                    if !f.expanded.remove(p) {
                        f.expanded.insert(*p);
                    }
                }
                _ => {}
            }
            if !f.running {
                face_compute(true);
            }
        }
        // duplicates: keep, delete, all of them, and doing it
        40 | 41 => {
            let Ok(i) = v.parse::<usize>() else { return };
            if a == 40 {
                f.dup_del.remove(&i);
                f.dup_keep.insert(i);
                dup_kept_written(i);
            } else {
                f.dup_keep.remove(&i);
                f.dup_del.insert(i);
            }
            if a == 40 && !f.running {
                face_compute(true);
            }
        }
        42 | 43 => {
            let ids: Vec<usize> = f.result.as_ref().map(|r| r.dups.iter().map(|d| d.0).filter(|i| !f.dup_gone.contains(i)).collect()).unwrap_or_default();
            for i in ids {
                if a == 42 {
                    f.dup_del.remove(&i);
                    f.dup_keep.insert(i);
                    dup_kept_written(i);
                } else {
                    f.dup_del.insert(i);
                }
            }
            if a == 42 && !f.running {
                face_compute(true);
            }
        }
        44 | 45 => {
            let ids: Vec<String> = f.dup_del.iter().filter(|i| !f.dup_gone.contains(i)).map(|i| f.files[*i].0.to_string()).collect();
            if ids.is_empty() {
                return;
            }
            f.dup_msg = "Asking for permission to change the folder…".into();
            if host::call("srcdel", &format!("{}\t{}", if a == 44 { "move" } else { "delete" }, ids.join(","))).is_none() {
                f.dup_msg = "This folder cannot be changed from here: download the list and delete them there.".into();
            }
        }
        18 => {
            if host::call("pickfolder", "").is_none() {
                f.msg = "This browser cannot open a folder that way: use Choose files, or drop the folder here.".into();
            }
        }
        34 => f.no_wake = !f.no_wake,
        // the photo viewer: open (photo, group), close, previous, next
        50 => {
            let mut it = v.split('\t');
            let Some(i) = it.next().and_then(|x| x.parse::<usize>().ok()) else { return };
            let gi = it.next().and_then(|x| x.parse::<usize>().ok());
            if i >= f.files.len() {
                return;
            }
            f.viewer_url = host::call("fileraw", &format!("{}", f.files[i].0)).unwrap_or_default();
            if f.viewer_url.is_empty() {
                f.viewer_url = f.thumb_cache.get(&i).cloned().unwrap_or_default();
            }
            f.viewer = Some((i, gi));
        }
        51 => f.viewer = None,
        52 | 53 => {
            let Some((i, Some(g))) = f.viewer else { return };
            let Some(list) = f.result.as_ref().and_then(|r| r.groups.get(g)).map(|x| x.1.clone()) else { return };
            let Some(p) = list.iter().position(|x| *x == i) else { return };
            let np = if a == 52 { p.checked_sub(1) } else { Some(p + 1).filter(|q| *q < list.len()) };
            if let Some(q) = np {
                let j = list[q];
                f.viewer_url = host::call("fileraw", &format!("{}", f.files[j].0)).unwrap_or_default();
                if f.viewer_url.is_empty() {
                    f.viewer_url = f.thumb_cache.get(&j).cloned().unwrap_or_default();
                }
                f.viewer = Some((j, Some(g)));
            }
        }
        35 => {
            host::call("kvclear", "");
            for k in ["facemace:work", "facemace:people", "facemace:settings"] {
                host::store_del(k);
            }
            f.pending.clear();
            f.pending_dups.clear();
            f.imported.clear();
            f.msg = "Everything Face Mace saved in this browser is cleared.".into();
        }
        // saving
        30 => {
            f.forget = !f.forget;
            face_remember();
        }
        31 => {
            host::store_del("facemace:people");
            f.imported.clear();
            f.live_clusters = Clusters::default();
            f.msg = "The people remembered on this device are forgotten.".into();
        }
        32 => work_save(),
        33 => list_csv(),
        13 => {
            f.part_size = v.trim().parse::<usize>().unwrap_or(0).min(1_000_000);
            face_remember();
        }
        14 => f.show_all = !f.show_all,
        // the people found, saved as a file (their names and up to forty faces each, as numbers: no pictures)
        16 => {
            let people: Vec<String> = f
                .last_people
                .iter()
                .filter(|p| p.1.first().map(|e| e.len() == 128).unwrap_or(false))
                .map(|(id, ex)| {
                    let faces: Vec<String> = ex.iter().map(|e| format!("[{}]", e.iter().map(|v| format!("{:.4}", v)).collect::<Vec<_>>().join(","))).collect();
                    format!("{{\"id\":{},\"name\":{},\"faces\":[{}]}}", id, json::quote(f.names.get(&format!("Person_{}", id)).map(|s| s.as_str()).unwrap_or("")), faces.join(","))
                })
                .collect();
            if people.is_empty() {
                f.msg = "No people to save yet (it needs the neural engines' descriptions).".into();
                return;
            }
            host::download("Face Mace people.json", "application/json", format!("{{\"facemace_people\":1,\"engine\":\"sface\",\"people\":[{}]}}", people.join(",")).as_bytes());
            f.msg = format!("Saved {} people: load the file next time, and they are recognized and named.", people.len());
        }
        17 => {
            if let Some(h) = v.lines().next().and_then(|l| l.split('\t').next()).and_then(|h| h.parse::<u32>().ok()) {
                host::call("bytes", &format!("{}\t{}", ZIP_TOKEN + 4, h));
            }
        }
        // a part's own ZIP
        a if (2000..3000).contains(&a) => part_zip((a - 2000) as usize),
        12 => {
            if f.files.is_empty() || f.running {
                return;
            }
            f.rename_only = true;
            f.by_date = true;
            f.stopped = false;
            f.live_rename = false;
            f.started = host::now();
            if f.out_dir.is_some() || f.part_size > 0 {
                predate_start();
                return;
            }
            f.live_clusters = Clusters::seeded(&f.imported);
            f.parts_done.clear();
            f.live_idx.clear();
            f.faces.clear();
            f.pics.clear();
            f.boxes.clear();
            f.at = 0;
            if f.dedupe {
                // a quick look at each picture, for duplicates only, then the renaming
                f.quick = true;
                f.running = true;
                face_next();
            } else {
                // nothing to look at: straight to the dates
                f.quick = false;
                let all: Vec<usize> = (0..f.files.len()).collect();
                f.result = Some(FaceResult { groups: alloc::vec![("Not_Sorted".to_string(), all)], people: 0, faces: 0, unreadable: 0, ms: 0.0, strict: f.strict, thumbs: Vec::new(), dups: Vec::new(), conf: alloc::vec![0.0], photo_conf: BTreeMap::new(), overall: None, done: true, review: Vec::new(), avatars: BTreeMap::new(), face_at: BTreeMap::new() });
                face_zip();
            }
        }
        // Stop: scanning, reading dates, packing or saving, whichever is going on
        11 => {
            f.cache_wait = false;
            if f.running {
                f.running = false;
                f.stopped = true;
                f.cur.clear();
                f.ml_faces.clear();
                f.ml_embs.clear();
                face_compute(true);
                let f = &mut st().face;
                f.msg = format!("Stopped after {} of {}. Sort by face goes on from there.", f.faces.len(), f.files.len());
            }
            let f = &mut st().face;
            if f.pre_dating {
                f.pre_dating = false;
                f.running = false;
            }
            if f.date_k < f.date_list.len() {
                f.date_list.clear();
                f.date_k = 0;
                f.msg = "Stopped.".into();
            }
            host::call("zip-stop", "");
            host::call("save-stop", "");
            if f.out_asked > f.out_saved {
                f.out_asked = f.out_saved;
            }
        }
        // a name settled (the field left): their files already renamed into the folder take it
        a if a >= 3000 => {
            if !f.live_rename {
                return;
            }
            let Some(p) = f.result.as_ref().and_then(|r| r.groups.get((a - 3000) as usize)).and_then(|g| g.0.strip_prefix("Person_")).and_then(|x| x.parse::<usize>().ok()) else { return };
            let n: String = v.chars().take(60).collect();
            let k = format!("Person_{}", p);
            if n.trim().is_empty() {
                f.names.remove(&k);
            } else {
                f.names.insert(k, n);
            }
            let _ = p;
            live_relabel();
        }
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

/// A photo's place in the store: its name, size and date.
fn scan_key(f: &Face, i: usize) -> String {
    let ms = host::call("filetime", &format!("{}", f.files[i].0)).unwrap_or_default();
    format!("{}|{}|{}", f.files[i].2, f.files[i].1 as u64, ms)
}

fn hex_f32(v: &[f32]) -> String {
    let mut s = String::with_capacity(v.len() * 8);
    for x in v {
        for b in x.to_le_bytes() {
            s.push_str(&format!("{:02x}", b));
        }
    }
    s
}

fn f32_hex(s: &str) -> Vec<f32> {
    let b: Vec<u8> = (0..s.len() / 2).filter_map(|k| u8::from_str_radix(s.get(2 * k..2 * k + 2)?, 16).ok()).collect();
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

/// A photo's scan into the store: "1" (full: with SFace faces) or "q" (fingerprint only), the fingerprint, the faces.
fn scan_put(i: usize) {
    let f = &st().face;
    let (Some(faces), Some(pic)) = (f.faces.get(i), f.pics.get(i)) else { return };
    let kind = if f.quick { "q" } else if f.ml == 2 { "1" } else { return };
    let p = match pic {
        Some((h, w, ht, m)) => format!("{:016x}{:016x}{:016x}{:016x},{},{},{}", h[0], h[1], h[2], h[3], w, ht, m),
        None => "-".to_string(),
    };
    let fs = match faces {
        Some(v) => v.iter().filter(|e| e.len() == 128).map(|e| hex_f32(e)).collect::<Vec<_>>().join(","),
        None => "x".to_string(),
    };
    let bx = f.boxes.get(i).map(|v| v.iter().map(|b| format!("{:.4},{:.4},{:.4},{:.4}", b[0], b[1], b[2], b[3])).collect::<Vec<_>>().join("|")).unwrap_or_default();
    host::call("kvput", &format!("{}\t{};{};{};{}", scan_key(f, i), kind, p, fs, bx));
}

/// The store answered about the photo due next: what was kept is used (no decoding, no engines), or it is scanned.
fn scan_got(text: &str) {
    let f = &mut st().face;
    if !f.running || !f.cache_wait {
        return;
    }
    let parts: Vec<&str> = text.splitn(4, ';').collect();
    let usable = parts.len() >= 3 && (parts[0] == "1" || (parts[0] == "q" && f.quick));
    if !usable {
        // not kept (or only a fingerprint where faces are needed): scanned now
        face_next();
        return;
    }
    f.cache_wait = false;
    let pic = if parts[1] == "-" { None } else {
        let a: Vec<&str> = parts[1].split(',').collect();
        let h = a.first().copied().unwrap_or("");
        let word = |k: usize| u64::from_str_radix(h.get(16 * k..16 * k + 16).unwrap_or("0"), 16).unwrap_or(0);
        Some(([word(0), word(1), word(2), word(3)], a.get(1).and_then(|x| x.parse().ok()).unwrap_or(0), a.get(2).and_then(|x| x.parse().ok()).unwrap_or(0), a.get(3).and_then(|x| x.parse().ok()).unwrap_or(0)))
    };
    let faces = if parts[2] == "x" { None } else if f.quick { Some(Vec::new()) } else { Some(parts[2].split(',').filter(|x| !x.is_empty()).map(f32_hex).filter(|e| e.len() == 128).collect()) };
    f.cache_hits += 1;
    let bx: Vec<[f32; 4]> = parts.get(3).map(|t| t.split('|').filter_map(|b| { let v: Vec<f32> = b.split(',').filter_map(|x| x.parse().ok()).collect(); if v.len() == 4 { Some([v[0], v[1], v[2], v[3]]) } else { None } }).collect()).unwrap_or_default();
    let n = faces.as_ref().map(|v: &Vec<Vec<f32>>| v.len()).unwrap_or(0);
    f.boxes.push(if bx.len() == n { bx } else { Vec::new() });
    f.faces.push(faces);
    f.pics.push(pic);
    live_save(f.faces.len() - 1);
    face_preview();
    let f = &mut st().face;
    f.at += 1;
    if !part_break() {
        face_next();
    }
}

/// Asks the browser for the next photo's pixels (shrunk to fit 600×600) — unless it was scanned before (the store
/// in this browser keeps each photo's faces and fingerprint, so a sort closed part way goes on where it was).
fn face_next() {
    face_wake_sync();
    let f = &mut st().face;
    if f.at >= f.files.len() {
        face_finish();
        return;
    }
    if (f.ml == 2 || f.quick) && !f.cache_wait {
        f.cache_wait = true;
        let key = scan_key(f, f.at);
        host::call("kvget", &format!("{}\t{}", ZIP_TOKEN + 7, key));
        return;
    }
    f.cache_wait = false;
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
        } else if token == ZIP_TOKEN + 5 {
            // a folder opened with access: its files, as the file picker gives them
            face_update(1, String::from_utf8(data).unwrap_or_default());
            st().face.src_folder = true;
        } else if token == ZIP_TOKEN + 7 {
            scan_got(&String::from_utf8(data).unwrap_or_default());
        } else if token == ZIP_TOKEN + 6 {
            dup_answer(&String::from_utf8(data).unwrap_or_default());
        } else if token == ZIP_TOKEN + 4 {
            people_import(&String::from_utf8(data).unwrap_or_default());
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
    let mut cur_boxes: Vec<[f32; 4]> = Vec::new();
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
        if f.quick {
            // renaming only: the fingerprint for duplicates is all that is needed
            f.faces.push(Some(Vec::new()));
            f.boxes.push(Vec::new());
            f.pics.push(pic);
            scan_put(f.faces.len() - 1);
            live_save(st().face.faces.len() - 1);
            let f = &mut st().face;
            face_preview();
            let f = &mut st().face;
            f.at += 1;
            if !part_break() {
                face_next();
            }
            render();
            return;
        }
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
        cur_boxes = boxes.iter().map(|b| [(b[0] / img.w as f64) as f32, (b[1] / img.h as f64) as f32, (b[2] / img.w as f64) as f32, (b[3] / img.h as f64) as f32]).collect();
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
    f.boxes.push(cur_boxes);
    f.pics.push(pic);
    live_save(f.faces.len() - 1);
    face_preview();
    let f = &mut st().face;
    f.at += 1;
    if !part_break() {
        face_next();
    }
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
            let b = f.ml_cur_box;
            f.ml_boxes.push(b);
        }
        ml_next_face();
    }
}

fn ml_next_face() {
    let f = &mut st().face;
    if let Some(face) = f.ml_faces.pop() {
        let (w, h) = (f.cur_w.max(1) as f64, f.cur_h.max(1) as f64);
        f.ml_cur_box = [(face[0] / w) as f32, (face[1] / h) as f32, (face[2] / w) as f32, (face[3] / h) as f32];
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
    let bx = core::mem::take(&mut f.ml_boxes);
    let i_now = f.faces.len();
    for b in &bx {
        f.recent.push((i_now, *b));
    }
    let keep = f.recent.len().saturating_sub(14);
    f.recent.drain(..keep);
    f.faces.push(Some(embs));
    f.boxes.push(bx);
    f.pics.push(f.cur_pic.take());
    scan_put(f.faces.len() - 1);
    let f = &mut st().face;
    f.cur.clear();
    live_save(f.faces.len() - 1);
    face_preview();
    let f = &mut st().face;
    f.at += 1;
    if !part_break() {
        face_next();
    }
}

/// The discover-as-you-go pass of face_sorter.py, at the chosen strictness.
fn face_finish() {
    face_finish_inner();
    face_wake_sync();
}

fn face_finish_inner() {
    {
        let f = &mut st().face;
        if f.part_size > 0 && !f.files.is_empty() {
            let start = (f.files.len() - 1) / f.part_size * f.part_size;
            if !f.parts_done.contains(&(start, f.files.len())) {
                f.parts_done.push((start, f.files.len()));
            }
        }
    }
    face_compute(true);
    let f = &mut st().face;
    f.running = false;
    if f.live_rename {
        f.quick = false;
        f.msg = if f.out_dir.is_some() { format!("Renamed into the folder as it went: {} files.", f.live_no) } else { format!("Renamed {} files: download them part by part below.", f.live_no) };
        return;
    }
    if f.rename_only {
        f.quick = false;
        face_zip();
    }
}

/// While scanning, the result so far, so people and their photos show up as they are found.
fn face_preview() {
    let f = &mut st().face;
    let n = f.faces.len();
    // small sets every photo; big ones every second and a half at most, so the work is not spent redrawing
    let now = host::now();
    if n < 200 || now - f.last_preview > 1500.0 {
        f.last_preview = now;
        face_compute(false);
        st().face.last_preview = host::now();
    }
}

/// People saved before, loaded: they are matched first, and their names go into the results and file names.
/// The people found, as JSON: their names and up to `max` faces each (as numbers; no pictures).
fn people_json(f: &Face, max: usize, places: usize) -> (String, usize) {
    let mut list: Vec<(usize, Vec<Vec<f32>>)> = f.last_people.clone();
    for p in &f.imported {
        if !list.iter().any(|q| q.0 == p.0) {
            list.push(p.clone());
        }
    }
    let people: Vec<String> = list
        .iter()
        .filter(|p| p.1.first().map(|e| e.len() == 128).unwrap_or(false))
        .map(|(id, ex)| {
            let faces: Vec<String> = ex.iter().take(max).map(|e| format!("[{}]", e.iter().map(|v| format!("{:.*}", places, v)).collect::<Vec<_>>().join(","))).collect();
            format!("{{\"id\":{},\"name\":{},\"faces\":[{}]}}", id, json::quote(f.names.get(&format!("Person_{}", id)).map(|s| s.as_str()).unwrap_or("")), faces.join(","))
        })
        .collect();
    (format!("[{}]", people.join(",")), people.len())
}

/// What is kept between visits on this device: the settings, and (unless turned off) the people and their names.
fn face_remember() {
    let f = &st().face;
    host::store_set("facemace:settings", &format!("{}\t{}\t{}\t{}\t{}", f.strict, f.dedupe as u8, f.by_date as u8, f.part_size, f.forget as u8));
    if f.forget {
        host::store_del("facemace:people");
        return;
    }
    let (people, n) = people_json(f, 10, 3);
    if n > 0 {
        host::store_set("facemace:people", &format!("{{\"facemace_people\":1,\"engine\":\"sface\",\"people\":{}}}", people));
    }
}

/// On opening Face Mace: the settings and the people remembered last time.
fn face_restore() {
    let f = &mut st().face;
    if f.restored {
        return;
    }
    f.restored = true;
    if let Some(t) = host::store_get("facemace:settings") {
        let p: Vec<&str> = t.split('\t').collect();
        if p.len() >= 5 {
            f.strict = p[0].parse().unwrap_or(75.0);
            f.dedupe = p[1] == "1";
            f.by_date = p[2] == "1";
            f.part_size = p[3].parse().unwrap_or(0);
            f.forget = p[4] == "1";
        }
    }
    if let Some(v) = host::store_get("facemace:work").and_then(|t| json::parse(&t)) {
        if let Value::Obj(kv) = v.get("names") {
            for (k, n) in kv {
                f.names.insert(k.clone(), n.text());
            }
        }
        for m in v.get("merges").arr() {
            let a = m.arr();
            if let (Some(x), Some(y)) = (a.first(), a.get(1)) {
                f.merge.insert(x.f() as usize, y.f() as usize);
            }
        }
        f.pending = v.get("answers").arr().iter().filter_map(|a| { let a = a.arr(); Some((a.first()?.text(), a.get(1)?.f() as u64, a.get(2)?.f() as usize, a.get(3)?.f() >= 1.0)) }).collect();
        f.pending_dups = v.get("dups").arr().iter().filter_map(|a| { let a = a.arr(); Some((a.first()?.text(), a.get(1)?.f() as u64, a.get(2)?.f() >= 1.0)) }).collect();
    }
    if !f.forget {
        if let Some(t) = host::store_get("facemace:people") {
            people_import(&t);
            let f = &mut st().face;
            if !f.imported.is_empty() {
                f.msg = format!("{} people remembered from last time.", f.imported.len());
            }
        }
    }
}

/// The answers given (by file name and size, as the photos are chosen again): who is who, and duplicates.
fn answers_json(f: &Face) -> (String, String, usize) {
    let mut answers: Vec<String> = Vec::new();
    for (&i, &p) in f.confirm.iter() {
        if i < f.files.len() {
            answers.push(format!("[{},{},{},1]", json::quote(&f.files[i].2), f.files[i].1 as u64, p));
        }
    }
    for &(i, p) in f.reject.iter() {
        if i < f.files.len() {
            answers.push(format!("[{},{},{},0]", json::quote(&f.files[i].2), f.files[i].1 as u64, p));
        }
    }
    let mut dups: Vec<String> = Vec::new();
    for &i in f.dup_keep.iter() {
        if i < f.files.len() {
            dups.push(format!("[{},{},1]", json::quote(&f.files[i].2), f.files[i].1 as u64));
        }
    }
    for &i in f.dup_del.iter() {
        if i < f.files.len() {
            dups.push(format!("[{},{},0]", json::quote(&f.files[i].2), f.files[i].1 as u64));
        }
    }
    let n = answers.len();
    (answers.join(","), dups.join(","), n)
}

/// Saved by itself after every change: names, merges and every answer, so choosing the same photos again (after
/// closing Face Mace, or the computer going off) brings them back.
fn work_autosave() {
    let f = &st().face;
    if f.files.is_empty() {
        return;
    }
    let (answers, dups, _) = answers_json(f);
    // the answers about photos not chosen this time are kept too
    let mut old_a: Vec<String> = Vec::new();
    let mut old_d: Vec<String> = Vec::new();
    for (n, z, p, y) in &f.pending {
        old_a.push(format!("[{},{},{},{}]", json::quote(n), z, p, *y as u8));
    }
    for (n, z, k) in &f.pending_dups {
        old_d.push(format!("[{},{},{}]", json::quote(n), z, *k as u8));
    }
    let join = |a: String, b: Vec<String>| { let mut v: Vec<String> = Vec::new(); if !a.is_empty() { v.push(a); } v.extend(b); v.join(",") };
    let merges: Vec<String> = f.merge.iter().map(|(a, b)| format!("[{},{}]", a, b)).collect();
    let names: Vec<String> = f.names.iter().map(|(k, v)| format!("{}:{}", json::quote(k), json::quote(v))).collect();
    host::store_set(
        "facemace:work",
        &format!("{{\"names\":{{{}}},\"merges\":[{}],\"answers\":[{}],\"dups\":[{}]}}", names.join(","), merges.join(","), join(answers, old_a), join(dups, old_d)),
    );
}

/// Everything about this work, as a file to open again later (here or elsewhere): settings, people and names, and
/// every answer given (by file name and size, since the photos are chosen again).
fn work_save() {
    let f = &mut st().face;
    let (answers_s, dups_s, n_answers) = answers_json(f);
    let merges: Vec<String> = f.merge.iter().map(|(a, b)| format!("[{},{}]", a, b)).collect();
    let names: Vec<String> = f.names.iter().map(|(k, v)| format!("{}:{}", json::quote(k), json::quote(v))).collect();
    let (people, n) = people_json(f, 40, 4);
    let body = format!(
        "{{\"facemace_work\":1,\"facemace_people\":1,\"saved\":{:.0},\"settings\":{{\"strict\":{},\"dedupe\":{},\"by_date\":{},\"part_size\":{}}},\"people\":{},\"names\":{{{}}},\"answers\":[{}],\"dups\":[{}],\"merges\":[{}],\"files\":{}}}",
        host::now(),
        f.strict,
        f.dedupe,
        f.by_date,
        f.part_size,
        people,
        names.join(","),
        answers_s,
        dups_s,
        merges.join(","),
        f.files.len()
    );
    let day = date_of_epoch(host::now() / 1000.0).replace(' ', "-");
    host::download(&format!("Face Mace work {}.json", day), "application/json", body.as_bytes());
    f.msg = format!("Work saved: {} people, {} answers. Open it next time after choosing the same photos.", n, n_answers);
}

/// A saved work file's answers, put on the photos chosen now (matched by name and size).
fn work_apply_pending() {
    let f = &mut st().face;
    if (f.pending.is_empty() && f.pending_dups.is_empty()) || f.files.is_empty() {
        return;
    }
    let pending = core::mem::take(&mut f.pending);
    let mut hit = 0;
    let mut rest = Vec::new();
    for (name, size, p, yes) in pending.into_iter() {
        if let Some(i) = f.files.iter().position(|x| x.2 == name && x.1 as u64 == size) {
            hit += 1;
            if yes {
                f.confirm.insert(i, p);
            } else {
                f.reject.insert((i, p));
            }
        } else {
            rest.push((name, size, p, yes));
        }
    }
    let total = hit + rest.len();
    f.pending = rest;
    let dups = core::mem::take(&mut f.pending_dups);
    let mut drest = Vec::new();
    for (name, size, keep) in dups.into_iter() {
        if let Some(i) = f.files.iter().position(|x| x.2 == name && x.1 as u64 == size) {
            if keep {
                f.dup_keep.insert(i);
            } else {
                f.dup_del.insert(i);
            }
        } else {
            drest.push((name, size, keep));
        }
    }
    f.pending_dups = drest;
    if hit > 0 {
        f.msg = format!("{} of {} saved answers matched these photos.", hit, total);
    }
}

/// Every file, who is in it, how sure, and its new name: a list to open in a spreadsheet.
fn list_csv() {
    let f = &st().face;
    let Some(r) = &f.result else { return };
    let q = |x: &str| format!("\"{}\"", x.replace('"', "\"\""));
    let mut who: BTreeMap<usize, Vec<(String, Option<f64>)>> = BTreeMap::new();
    for (gi, (k, idx)) in r.groups.iter().enumerate() {
        let name = if k.starts_with("Person_") { f.names.get(k).cloned().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| k.replace('_', " ")) } else { k.replace('_', " ") };
        for &i in idx {
            let c = if f.confirm.get(&i).map(|p| format!("Person_{}", p)) == Some(k.clone()) { Some(1.0) } else { r.photo_conf.get(&(gi, i)).copied() };
            who.entry(i).or_default().push((name.clone(), c));
        }
    }
    let dups: BTreeMap<usize, usize> = r.dups.iter().copied().collect();
    let mut lines = alloc::vec!["file,people,confidence,new name,note".to_string()];
    for (i, file) in f.files.iter().enumerate().take(f.faces.len().max(if f.live_rename { f.files.len() } else { 0 })) {
        let w = who.get(&i);
        let people = w.map(|v| v.iter().map(|x| x.0.clone()).collect::<Vec<_>>().join("; ")).unwrap_or_default();
        let conf = w.and_then(|v| v.iter().filter_map(|x| x.1).fold(None, |a: Option<f64>, b| Some(a.map_or(b, |a| a.max(b))))).map(|c| format!("{:.0}%", c * 100.0)).unwrap_or_default();
        let new = f.live_written.get(&i).map(|e| e.2.rsplit('/').next().unwrap_or("").to_string()).unwrap_or_default();
        let note = if let Some(k) = dups.get(&i) { format!("duplicate of {}", f.files[*k].2) } else if f.confirm.contains_key(&i) { "confirmed".to_string() } else { String::new() };
        lines.push(format!("{},{},{},{},{}", q(&file.2), q(&people), conf, q(&new), q(&note)));
    }
    host::download("Face Mace list.csv", "text/csv", lines.join("\r\n").as_bytes());
}

fn people_import(text: &str) {
    let f = &mut st().face;
    let Some(v) = json::parse(text).filter(|v| v.get("facemace_people").f() >= 1.0) else {
        f.msg = "That file is not a Face Mace people or work file.".into();
        return;
    };
    // a work file: its settings, names, merges and answers too
    if v.get("facemace_work").f() >= 1.0 {
        let st_ = v.get("settings");
        f.strict = st_.get("strict").f().max(40.0).min(120.0);
        f.dedupe = st_.get("dedupe").truthy();
        f.by_date = st_.get("by_date").truthy();
        f.part_size = st_.get("part_size").f() as usize;
        if let Value::Obj(kv) = v.get("names") {
            for (k, n) in kv {
                f.names.insert(k.clone(), n.text());
            }
        }
        f.merge.clear();
        for m in v.get("merges").arr() {
            let a = m.arr();
            if let (Some(x), Some(y)) = (a.first(), a.get(1)) {
                f.merge.insert(x.f() as usize, y.f() as usize);
            }
        }
        f.pending = v.get("answers").arr().iter().filter_map(|a| { let a = a.arr(); Some((a.first()?.text(), a.get(1)?.f() as u64, a.get(2)?.f() as usize, a.get(3)?.f() >= 1.0)) }).collect();
        f.pending_dups = v.get("dups").arr().iter().filter_map(|a| { let a = a.arr(); Some((a.first()?.text(), a.get(1)?.f() as u64, a.get(2)?.f() >= 1.0)) }).collect();
        work_apply_pending();
    }
    let mut people: Vec<(usize, Vec<Vec<f32>>)> = Vec::new();
    for p in v.get("people").arr() {
        let id = p.get("id").f() as usize;
        let faces: Vec<Vec<f32>> = p.get("faces").arr().iter().map(|e| e.arr().iter().map(|x| x.f() as f32).collect::<Vec<f32>>()).filter(|e| e.len() == 128).collect();
        if id == 0 || faces.is_empty() {
            continue;
        }
        let name = p.get("name").text();
        if !name.is_empty() {
            f.names.insert(format!("Person_{}", id), name);
        }
        people.push((id, faces));
    }
    let n = people.len();
    f.imported = people;
    f.live_clusters = Clusters::seeded(&f.imported);
    let waiting = f.pending.len();
    f.msg = if waiting > 0 { format!("Loaded {} people; {} answers wait for their photos to be chosen.", n, waiting) } else { format!("Loaded {} people: they are recognized in these photos and named in the results.", n) };
    if f.result.is_some() && f.faces.len() == f.files.len() && !f.running {
        face_compute(true);
    }
}

/// A duplicate kept after all: when renaming or sorting into the folder as it went, it is written there now too.
fn dup_kept_written(i: usize) {
    let f = &mut st().face;
    if f.out_dir.is_none() || f.live_written.contains_key(&i) || f.sorted_written.contains_key(&i) {
        return;
    }
    if f.live_rename {
        live_rename_write(i, &[]);
    } else if !f.by_date && i < f.faces.len() {
        let base = f.files[i].2.rsplit('/').next().unwrap_or("photo").to_string();
        let path = format!("No_Faces_Detected/{}", base);
        f.sorted_written.insert(i, alloc::vec![path.clone()]);
        out_save(&path, f.files[i].0);
    }
}

/// The folder answered: duplicates moved aside or deleted (or why not).
fn dup_answer(m: &str) {
    dup_answer_inner(m);
    face_wake_sync();
}

fn dup_answer_inner(m: &str) {
    let f = &mut st().face;
    if let Some(n) = m.strip_prefix("progress ") {
        f.dup_msg = format!("{} done…", n);
    } else if let Some(n) = m.strip_prefix("done ") {
        let done: Vec<usize> = f.dup_del.iter().copied().collect();
        f.dup_gone.extend(done);
        f.dup_msg = format!("{} duplicate{} taken out of your folder.", n, if n == "1" { "" } else { "s" });
    } else if let Some(e) = m.strip_prefix("error ") {
        f.dup_msg = format!("Nothing was changed: {}", e);
    }
}

/// Whether Face Mace is working on something (scanning, reading dates, packing, saving or deleting).
fn face_busy(f: &Face) -> bool {
    f.running || f.pre_dating || f.date_k < f.date_list.len() || f.msg.starts_with("Packing") || f.out_asked > f.out_saved || f.dup_msg.ends_with("…")
}

/// The computer is kept awake while Face Mace works, and let sleep again when it is done.
fn face_wake_sync() {
    let f = &mut st().face;
    let want = !f.no_wake && face_busy(f);
    if want != f.awake {
        f.awake = want;
        host::call("wake", if want { "1" } else { "0" });
    }
}

/// A number for a person made by hand ("Move to: a new person").
fn new_person_id(f: &Face) -> usize {
    let mut m = f.imported.iter().map(|p| p.0).max().unwrap_or(0);
    if let Some(r) = &f.result {
        for (k, _) in &r.groups {
            if let Some(id) = k.strip_prefix("Person_").and_then(|x| x.parse::<usize>().ok()) {
                m = m.max(id);
            }
        }
    }
    for (_, &p) in f.confirm.iter() {
        m = m.max(p);
    }
    m + 1
}

/// One part's files as a ZIP: renamed (when renaming) or in their people's folders.
fn part_zip(k: usize) {
    let f = &mut st().face;
    let Some(&(a, b)) = f.parts_done.get(k) else { return };
    let mut want: Vec<(String, u32)> = Vec::new();
    if f.live_rename {
        for i in a..b {
            if let Some((_, _, p)) = f.live_written.get(&i) {
                want.push((p.clone(), f.files[i].0));
            }
        }
    } else if let Some(r) = &f.result {
        for (g, idx) in &r.groups {
            let mut used = Vec::new();
            for &i in idx.iter().filter(|&&i| i >= a && i < b) {
                let base = f.files[i].2.rsplit('/').next().unwrap_or("photo").to_string();
                want.push((format!("Auto_Sorted_Faces/{}/{}", g, unique_in(&mut used, &base)), f.files[i].0));
            }
        }
    }
    zip_start(&format!("Face Mace part {} ({}-{}).zip", k + 1, a + 1, b), want);
}

/// Working in parts: after each part the work pauses (Next part goes on); true when it paused.
fn part_break() -> bool {
    let f = &mut st().face;
    if f.part_size == 0 || f.at == 0 || f.at >= f.files.len() || f.at % f.part_size != 0 {
        return false;
    }
    let start = f.at - f.part_size;
    if !f.parts_done.contains(&(start, f.at)) {
        f.parts_done.push((start, f.at));
    }
    f.running = false;
    f.stopped = true;
    face_compute(true);
    let f = &mut st().face;
    let total = (f.files.len() + f.part_size - 1) / f.part_size;
    f.msg = format!("Part {} of {} done ({} of {} files). Next part goes on from there.", f.parts_done.len(), total, f.at, f.files.len());
    face_wake_sync();
    true
}

/// How sure a match is, 0–1: SFace's cosine against OpenCV's threshold (0.363 is even odds; 0.6 is 94%), LBPH's
/// distance against the strictness.
fn match_conf(d: f64, emb: bool, strict: f64) -> f64 {
    let z = if emb { ((1.0 - d) - 0.363) * 12.0 } else { (strict - d) / (strict * 0.15).max(1.0) };
    1.0 / (1.0 + exp_f(-z))
}

fn face_compute(done: bool) {
    let f = &mut st().face;
    let mut known: Vec<(usize, &Vec<f32>)> = Vec::new();
    let mut owner: Vec<usize> = Vec::new();
    let mut owner_k: Vec<usize> = Vec::new();
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let (mut none, mut unreadable, mut next, mut nfaces) = (Vec::new(), 0usize, 1usize, 0usize);
    let mut dups: Vec<(usize, usize)> = Vec::new();
    if f.dedupe {
        // the biggest file of each set is the one kept (normally the original; a copy made smaller is let go)
        let mut order: Vec<usize> = (0..f.faces.len()).collect();
        // renamed as it went: the first of each set was the one written (they come in date order)
        if !f.live_rename { order.sort_by(|&a, &b| f.files[b].1.partial_cmp(&f.files[a].1).unwrap_or(core::cmp::Ordering::Equal).then_with(|| f.files[a].2.cmp(&f.files[b].2))); }
        let mut idx = BTreeMap::new();
        for i in order {
            if let Some(j) = dup_check(f, i, &mut idx) {
                if !f.dup_keep.contains(&i) {
                    dups.push((i, j));
                }
            }
        }
        dups.sort_by(|a, b| f.files[a.0].2.cmp(&f.files[b.0].2));
    }
    let f = &mut st().face;
    let dup_set: alloc::collections::BTreeSet<usize> = dups.iter().map(|d| d.0).collect();
    // the photos the person sorting confirmed are where their people start: their faces lead the matching
    let mut seed = f.imported.clone();
    for (&i, &p) in f.confirm.iter() {
        let Some(Some(hs)) = f.faces.get(i) else { continue };
        let Some(h) = (if hs.len() == 1 { hs.first() } else {
            // several faces: the one nearest this person's other confirmed faces (or the first)
            let refs: Vec<&Vec<f32>> = seed.iter().filter(|q| q.0 == p).flat_map(|q| q.1.iter()).collect();
            hs.iter().min_by(|a, b| {
                let da = refs.iter().map(|r| face_dist(a, r)).fold(f64::INFINITY, f64::min);
                let db = refs.iter().map(|r| face_dist(b, r)).fold(f64::INFINITY, f64::min);
                da.partial_cmp(&db).unwrap_or(core::cmp::Ordering::Equal)
            })
        }) else { continue };
        match seed.iter_mut().find(|q| q.0 == p) {
            Some(q) => {
                if q.1.len() < 40 {
                    q.1.push(h.clone());
                }
            }
            None => seed.push((p, alloc::vec![h.clone()])),
        }
    }
    let mut cl = Clusters::seeded(&seed);
    for (i, hs) in f.faces.iter().enumerate() {
        if dup_set.contains(&i) {
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
        for (fk, h) in hs.iter().enumerate() {
            nfaces += 1;
            let id = cl.assign(h, f.strict);
            known.push((id, h));
            owner.push(i);
            owner_k.push(fk);
            let g = groups.entry(id).or_default();
            if g.last() != Some(&i) {
                g.push(i);
            }
        }
    }
    // the same people keep the same numbers from one count to the next (so names, merges and answers stay with
    // them): each new group takes the number of the earlier group it shares most photos with
    let fixed: alloc::collections::BTreeSet<usize> = seed.iter().map(|q| q.0).collect();
    let mut prev: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    if let Some(r) = &f.result {
        for (k, idx) in &r.groups {
            if let Some(id) = k.strip_prefix("Person_").and_then(|x| x.parse::<usize>().ok()) {
                prev.insert(id, idx.clone());
            }
        }
    }
    let mut pairs: Vec<(usize, usize, usize)> = Vec::new();
    for (nid, v) in groups.iter() {
        if fixed.contains(nid) {
            continue;
        }
        for (pid, pv) in prev.iter() {
            if fixed.contains(pid) {
                continue;
            }
            let n = v.iter().filter(|i| pv.contains(i)).count();
            if n > 0 {
                pairs.push((n, *nid, *pid));
            }
        }
    }
    pairs.sort_by(|a, b| b.0.cmp(&a.0));
    let mut remap: BTreeMap<usize, usize> = BTreeMap::new();
    let mut taken: alloc::collections::BTreeSet<usize> = fixed.clone();
    for (_, nid, pid) in pairs {
        if remap.contains_key(&nid) || taken.contains(&pid) {
            continue;
        }
        remap.insert(nid, pid);
        taken.insert(pid);
    }
    let mut fresh = taken.iter().copied().chain(prev.keys().copied()).max().unwrap_or(0) + 1;
    for nid in groups.keys() {
        if !fixed.contains(nid) && !remap.contains_key(nid) {
            while taken.contains(&fresh) {
                fresh += 1;
            }
            remap.insert(*nid, fresh);
            taken.insert(fresh);
        }
    }
    let groups: BTreeMap<usize, Vec<usize>> = groups.into_iter().map(|(id, v)| (*remap.get(&id).unwrap_or(&id), v)).collect();
    for k in known.iter_mut() {
        k.0 = *remap.get(&k.0).unwrap_or(&k.0);
    }
    let mut cl = cl;
    for p in cl.people.iter_mut() {
        p.0 = *remap.get(&p.0).unwrap_or(&p.0);
    }
    // what the person sorting said: merges, then photos that are not someone, then photos that are
    let resolve = |mut id: usize| {
        let mut n = 0;
        while let Some(&t) = f.merge.get(&id) {
            if n > 50 || t == id {
                break;
            }
            id = t;
            n += 1;
        }
        id
    };
    let mut merged: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (id, v) in groups.into_iter() {
        let e = merged.entry(resolve(id)).or_default();
        for i in v {
            if !e.contains(&i) {
                e.push(i);
            }
        }
    }
    for k in known.iter_mut() {
        k.0 = resolve(k.0);
    }
    let mut groups = merged;
    let mut placed: alloc::collections::BTreeSet<usize> = alloc::collections::BTreeSet::new();
    for v in groups.values() {
        placed.extend(v.iter().copied());
    }
    for (i, p) in f.reject.iter() {
        if let Some(v) = groups.get_mut(&resolve(*p)) {
            v.retain(|x| x != i);
        }
    }
    for (&i, &p) in f.confirm.iter() {
        if i >= f.faces.len() || dup_set.contains(&i) {
            continue;
        }
        let p = resolve(p);
        // a photo with one face is in one person's group only
        if f.faces[i].as_ref().map(|h| h.len() <= 1).unwrap_or(true) {
            for (q, v) in groups.iter_mut() {
                if *q != p {
                    v.retain(|x| *x != i);
                }
            }
        }
        let v = groups.entry(p).or_default();
        if !v.contains(&i) {
            v.push(i);
            v.sort();
        }
        none.retain(|x| *x != i);
    }
    groups.retain(|_, v| !v.is_empty());
    // photos whose faces were all said to be someone else: not recognized
    let mut lost: Vec<usize> = placed.into_iter().filter(|i| !groups.values().any(|v| v.contains(i)) && !none.contains(i)).collect();
    lost.sort();
    next = groups.len() + 1;
    let people_now: Vec<(usize, Vec<Vec<f32>>)> = cl.people.iter().filter(|p| groups.contains_key(&p.0) || f.imported.iter().any(|q| q.0 == p.0)).cloned().collect();
    let mut out: Vec<(String, Vec<usize>)> = groups.into_iter().map(|(id, v)| (format!("Person_{}", id), v)).collect();
    if !lost.is_empty() {
        out.push(("Not_Recognized".to_string(), lost));
    }
    if !none.is_empty() {
        out.push((if f.rename_only { "Not_Sorted".to_string() } else { "No_Faces_Detected".to_string() }, none));
    }
    // where each person's face is in each of their photos, and their clearest face (for their bubble)
    let mut face_at: BTreeMap<(usize, usize), [f32; 4]> = BTreeMap::new();
    let mut avatars: BTreeMap<usize, (usize, [f32; 4])> = BTreeMap::new();
    {
        let mut best: BTreeMap<usize, (f32, usize, [f32; 4])> = BTreeMap::new();
        for (n, (id, _)) in known.iter().enumerate() {
            let (i, fk) = (owner[n], owner_k[n]);
            let Some(b) = f.boxes.get(i).and_then(|v| v.get(fk)).copied() else { continue };
            let Some(gi) = out.iter().position(|g| g.0 == format!("Person_{}", id) && g.1.contains(&i)) else { continue };
            face_at.entry((gi, i)).or_insert(b);
            // the clearest: a confirmed photo first, then the biggest face
            let score = b[2] * b[3] + if f.confirm.get(&i) == Some(id) { 10.0 } else { 0.0 };
            if best.get(&gi).map(|x| score > x.0).unwrap_or(true) {
                best.insert(gi, (score, i, b));
            }
        }
        for (gi, (_, i, b)) in best {
            avatars.insert(gi, (i, b));
        }
    }
    // how sure: each face against its person's average (the group's own centre), as a probability
    let mut conf: Vec<f64> = Vec::new();
    let mut photo_conf: BTreeMap<(usize, usize), f64> = BTreeMap::new();
    let (mut all_sum, mut all_n) = (0.0f64, 0usize);
    for (gi, (k, idx)) in out.iter().enumerate() {
        if k == "No_Faces_Detected" || k == "Not_Recognized" || k == "Not_Sorted" {
            conf.push(0.0);
            continue;
        }
        let id: usize = k.trim_start_matches("Person_").parse().unwrap_or(0);
        let mine: Vec<(usize, &Vec<f32>)> = known.iter().zip(owner.iter()).filter(|((pid, _), _)| *pid == id).map(|((_, h), i)| (*i, *h)).collect();
        if mine.is_empty() {
            conf.push(0.0);
            continue;
        }
        let dim = mine[0].1.len();
        let emb = dim == 128;
        let mut c = alloc::vec![0f64; dim];
        let sure: Vec<&(usize, &Vec<f32>)> = mine.iter().filter(|(i, _)| f.confirm.get(i) == Some(&id)).collect();
        let basis: Vec<&(usize, &Vec<f32>)> = if sure.is_empty() { mine.iter().collect() } else { sure };
        for (_, h) in basis.iter().map(|x| (x.0, x.1)) {
            for (a, b) in c.iter_mut().zip(h.iter()) {
                *a += *b as f64;
            }
        }
        if emb {
            let n = c.iter().map(|v| v * v).sum::<f64>().sqrt_c().max(1e-9);
            c.iter_mut().for_each(|v| *v /= n);
        } else {
            c.iter_mut().for_each(|v| *v /= mine.len() as f64);
        }
        let cf: Vec<f32> = c.iter().map(|v| *v as f32).collect();
        let (mut sum, mut cnt) = (0.0, 0usize);
        for (i, h) in &mine {
            // a person seen once is as sure as their single face is clear: a full match with itself is not news
            // a photo the person sorting confirmed is sure; the others are measured against this person's centre
            let p = if f.confirm.get(i) == Some(&id) { 1.0 } else if mine.len() == 1 { 0.0 } else { match_conf(face_dist(h, &cf), emb, f.strict) };
            if mine.len() > 1 || f.confirm.get(i) == Some(&id) {
                sum += p;
                cnt += 1;
                let e = photo_conf.entry((gi, *i)).or_insert(0.0);
                if p > *e {
                    *e = p;
                }
            }
        }
        let g = if cnt > 0 { sum / cnt as f64 } else { 0.0 };
        if cnt > 0 {
            all_sum += sum;
            all_n += cnt;
        }
        conf.push(g);
        let _ = idx;
    }
    // thumbnails: the first twelve of each group, as object URLs of the files themselves (made once)
    let mut thumbs = Vec::new();
    let dup_list: Vec<usize> = dups.iter().flat_map(|d| [d.0, d.1]).take(120).collect();
    let expanded: Vec<bool> = out.iter().map(|g| g.0.strip_prefix("Person_").and_then(|x| x.parse::<usize>().ok()).map(|p| f.expanded.contains(&p)).unwrap_or(false)).collect();
    for (gk, idx) in out.iter().map(|g| &g.1).chain(core::iter::once(&dup_list)).enumerate() {
        let take = if expanded.get(gk).copied().unwrap_or(false) { 600 } else { 12 };
        for &i in idx.iter().take(take) {
            if !thumbs.iter().any(|(j, _): &(usize, String)| *j == i) {
                let url = match f.thumb_cache.get(&i) {
                    Some(u) => u.clone(),
                    None => {
                        let u = host::call("fileurl", &format!("{}", f.files[i].0)).unwrap_or_default();
                        if !u.is_empty() {
                            f.thumb_cache.insert(i, u.clone());
                        }
                        u
                    }
                };
                thumbs.push((i, url));
            }
        }
    }
    let overall = if all_n > 0 { Some(all_sum / all_n as f64) } else { None };
    f.last_people = people_now;
    let need: Vec<usize> = avatars.values().map(|a| a.0).chain(f.recent.iter().map(|r| r.0)).collect();
    for i in need {
        if !f.thumb_cache.contains_key(&i) && i < f.files.len() {
            let u = host::call("fileurl", &format!("{}", f.files[i].0)).unwrap_or_default();
            if !u.is_empty() {
                f.thumb_cache.insert(i, u);
            }
        }
    }
    // to ask about: the least sure photos of each person, not yet answered
    let mut review: Vec<(usize, usize, f64)> = Vec::new();
    for ((gi, i), p) in photo_conf.iter() {
        let Some(id) = out.get(*gi).and_then(|g| g.0.strip_prefix("Person_")).and_then(|x| x.parse::<usize>().ok()) else { continue };
        if *p < 0.9 && f.confirm.get(i) != Some(&id) && !f.reject.contains(&(*i, id)) {
            review.push((*i, id, *p));
        }
    }
    review.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(core::cmp::Ordering::Equal));
    review.truncate(8);
    for (i, _, _) in &review {
        if !f.thumb_cache.contains_key(i) {
            let u = host::call("fileurl", &format!("{}", f.files[*i].0)).unwrap_or_default();
            if !u.is_empty() {
                f.thumb_cache.insert(*i, u);
            }
        }
    }
    f.result = Some(FaceResult { groups: out, people: next - 1, faces: nfaces, unreadable, ms: host::now() - f.started, strict: f.strict, thumbs, dups, conf, photo_conf, overall, done, review, avatars, face_at });
    if done {
        live_relabel();
        face_remember();
        work_autosave();
    }
}

/// After corrections: files already written into the folder follow (renamed ones get their people's names; ones
/// sorted into person folders move to the right folder).
fn live_relabel() {
    let f = &mut st().face;
    let Some(r) = &f.result else { return };
    if f.out_dir.is_none() {
        return;
    }
    let mut member: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for (k, idx) in &r.groups {
        for &i in idx {
            member.entry(i).or_default().push(k.clone());
        }
    }
    if f.live_rename {
        let mut moves: Vec<(usize, String, String, Vec<usize>)> = Vec::new();
        for (i, (n, _, path)) in f.live_written.iter() {
            let people: Vec<usize> = member.get(i).map(|v| v.iter().filter_map(|k| k.strip_prefix("Person_")).filter_map(|x| x.parse().ok()).collect()).unwrap_or_default();
            let new = renamed_path(*n, &if f.rename_only { String::new() } else { label_of(f, &people) }, f.file_when.get(*i).copied().unwrap_or(0), &f.files[*i].2);
            if &new != path {
                moves.push((*i, path.clone(), new, people));
            }
        }
        for (i, old, new, people) in moves {
            host::call("mvfile", &format!("{}\t{}", old, new));
            if let Some(e) = f.live_written.get_mut(&i) {
                e.2 = new;
                e.1 = people;
            }
        }
        return;
    }
    // person folders: named after the person once named
    let folder = |k: &str| f.names.get(k).map(|n| file_safe(n)).filter(|n| !n.is_empty()).unwrap_or_else(|| k.to_string());
    let mut jobs: Vec<(usize, Vec<String>)> = Vec::new();
    for (i, have) in f.sorted_written.iter() {
        let base = have.first().and_then(|p| p.rsplit('/').next()).unwrap_or("photo").to_string();
        let want: Vec<String> = member.get(i).map(|v| v.iter().map(|k| format!("{}/{}", folder(k), base)).collect()).unwrap_or_default();
        if &want != have {
            jobs.push((*i, want));
        }
    }
    for (i, want) in jobs {
        let have = f.sorted_written.get(&i).cloned().unwrap_or_default();
        let mut spare: Vec<String> = have.iter().filter(|p| !want.contains(p)).cloned().collect();
        for w in want.iter().filter(|w| !have.contains(w)) {
            match spare.pop() {
                Some(old) => {
                    host::call("mvfile", &format!("{}\t{}", old, w));
                }
                None => out_save(w, f.files[i].0),
            }
        }
        for old in spare {
            host::call("rmfile", &old);
        }
        f.sorted_written.insert(i, want);
    }
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
    if !f.live_rename && (f.out_dir.is_none() || f.by_date) {
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
    let hs = match f.faces.get(i).cloned() {
        Some(Some(hs)) => hs,
        // unreadable: still renamed, as unknown
        Some(None) if f.live_rename => Vec::new(),
        _ => return,
    };
    let mut people: Vec<usize> = Vec::new();
    for h in hs.iter() {
        let strict = f.strict;
        let id = f.live_clusters.assign(h, strict);
        if !people.contains(&id) {
            people.push(id);
        }
    }
    if f.live_rename {
        live_rename_write(i, &people);
        return;
    }
    let groups: Vec<String> = if people.is_empty() { alloc::vec!["No_Faces_Detected".to_string()] } else { people.iter().map(|p| format!("Person_{}", p)).collect() };
    let base = f.files[i].2.rsplit('/').next().unwrap_or("photo").to_string();
    for g in groups {
        let name = unique_in(f.live_used.entry(g.clone()).or_default(), &base);
        let path = format!("{}/{}", g, name);
        f.sorted_written.entry(i).or_default().push(path.clone());
        out_save(&path, f.files[i].0);
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
    out_answer_inner(m);
    face_wake_sync();
}

fn out_answer_inner(m: &str) {
    let f = &mut st().face;
    if m.starts_with("dir ") || m.starts_with("error ") {
        f.out_picking = false;
    }
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
    zip_progress_inner(m);
    face_wake_sync();
}

fn zip_progress_inner(m: &str) {
    let f = &mut st().face;
    f.msg = if let Some(n) = m.strip_prefix("done ") {
        format!("Downloaded {} files.", n)
    } else if m == "error stopped" {
        "Stopped.".to_string()
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
    face_wake_sync();
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

/// Renamed_by_date/0000001-0001000/0000001-Anna-1382-2004.jpg: the number, who (may be empty), the years.
fn renamed_path(n: u64, who: &str, when: u64, name: &str) -> String {
    let ext = face_ext(name);
    let ext = if ext.is_empty() || ext.len() > 5 { "jpg".to_string() } else { ext };
    let years = years_of(when).map(|(p, g)| format!("-{}-{}", p, g)).unwrap_or_default();
    let first = (n - 1) / 1000 * 1000 + 1;
    format!("Renamed_by_date/{:07}-{:07}/{:07}{}{}.{}", first, first + 999, n, if who.is_empty() { String::new() } else { format!("-{}", who) }, years, ext)
}

/// Who is in a photo, for its name: the people named so far; "unknown" when nobody in it is named.
fn label_of(f: &Face, people: &[usize]) -> String {
    let mut names: Vec<String> = Vec::new();
    for p in people {
        if let Some(n) = f.names.get(&format!("Person_{}", p)).map(|n| file_safe(n)).filter(|n| !n.is_empty()) {
            if !names.contains(&n) {
                names.push(n);
            }
        }
    }
    if names.is_empty() { "unknown".to_string() } else { names.join("-") }
}

/// The dates are all read before anything is looked at (when renaming into a folder): the files are put in that
/// order, so each can be written with its number as soon as it is done.
fn predate_start() {
    let f = &mut st().face;
    f.pre_dating = true;
    f.running = true;
    f.date_list = (0..f.files.len()).collect();
    f.date_k = 0;
    f.dates.clear();
    f.msg = "Reading when each was taken…".to_string();
    date_begin();
}

fn predate_done() {
    let f = &mut st().face;
    f.pre_dating = false;
    let mut items: Vec<(u64, usize)> = f.dates.iter().map(|(i, w)| (*w, *i)).collect();
    items.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| f.files[a.1].2.cmp(&f.files[b.1].2)));
    f.files = items.iter().map(|(_, i)| f.files[*i].clone()).collect();
    f.file_when = items.iter().map(|(w, _)| *w).collect();
    f.thumb_cache.clear();
    f.faces.clear();
    f.pics.clear();
            f.boxes.clear();
    f.live_rename = true;
    f.live_no = 0;
    f.live_written.clear();
    f.live_clusters = Clusters::seeded(&f.imported);
    f.live_idx.clear();
    f.at = 0;
    f.msg.clear();
    if f.rename_only && !f.dedupe {
        // nothing to look at: each written now, in order
        for i in 0..f.files.len() {
            live_rename_write(i, &[]);
        }
        let f = &mut st().face;
        let all: Vec<usize> = (0..f.files.len()).collect();
        f.result = Some(FaceResult { groups: alloc::vec![("Not_Sorted".to_string(), all)], people: 0, faces: 0, unreadable: 0, ms: host::now() - f.started, strict: f.strict, thumbs: Vec::new(), dups: Vec::new(), conf: alloc::vec![0.0], photo_conf: BTreeMap::new(), overall: None, done: true, review: Vec::new(), avatars: BTreeMap::new(), face_at: BTreeMap::new() });
        f.running = false;
        return;
    }
    if f.rename_only {
        f.quick = true;
        face_next();
        return;
    }
    if f.ml == 0 {
        f.ml = 1;
        host::call("ml-load", "");
    }
    face_load();
    if face_ready(f) {
        face_next();
    }
}

/// One file, renamed into the folder now: the next number, who is in it as far as is known.
fn live_rename_write(i: usize, people: &[usize]) {
    let f = &mut st().face;
    f.live_no += 1;
    let n = f.live_no;
    let who = if f.rename_only { String::new() } else { label_of(f, people) };
    let path = renamed_path(n, &who, f.file_when.get(i).copied().unwrap_or(0), &f.files[i].2);
    let h = f.files[i].0;
    f.live_written.insert(i, (n, people.to_vec(), path.clone()));
    if f.out_dir.is_some() {
        out_save(&path, h);
    }
}

/// A person was named: their files already in the folder take the name.
fn live_rename_person(p: usize) {
    let f = &mut st().face;
    let mut moves: Vec<(usize, String, String)> = Vec::new();
    for (i, (n, people, path)) in f.live_written.iter() {
        if people.contains(&p) {
            let new = renamed_path(*n, &label_of(f, people), f.file_when.get(*i).copied().unwrap_or(0), &f.files[*i].2);
            if &new != path {
                moves.push((*i, path.clone(), new));
            }
        }
    }
    for (i, old, new) in moves {
        host::call("mvfile", &format!("{}\t{}", old, new));
        if let Some(e) = f.live_written.get_mut(&i) {
            e.2 = new;
        }
    }
}

/// Every file dated: numbered in that order and named after who is in it.
fn date_done() {
    let f = &mut st().face;
    if f.pre_dating {
        predate_done();
        return;
    }
    let labels = face_labels(f);
    let mut items: Vec<(u64, String, usize)> = f.dates.iter().map(|(i, w)| (*w, f.files[*i].2.clone(), *i)).collect();
    items.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let want: Vec<(String, u32)> = items
        .into_iter()
        .enumerate()
        .map(|(k, (when, name, i))| {
            let ext = face_ext(&name);
            let ext = if ext.is_empty() || ext.len() > 5 { "jpg".to_string() } else { ext };
            let who = if f.rename_only { String::new() } else { labels.get(&i).map(|l| format!("-{}", l.join("-"))).unwrap_or_else(|| "-unknown".into()) };
            // then the year, Persian (Solar Hijri) and Gregorian (owner, 2026-10-15: "0000001-unknown-1382-2004")
            let years = years_of(when).map(|(p, g)| format!("-{}-{}", p, g)).unwrap_or_default();
            // in folders of a thousand, named by their range (owner, 2026-10-15: "make the photos in batch on 1000
            // output folders"): Renamed_by_date/0000001-0001000/0000001-Anna-1382-2004.jpg, then 0001001-0002000/…
            let n = k + 1;
            let first = (n - 1) / 1000 * 1000 + 1;
            (format!("Renamed_by_date/{:07}-{:07}/{:07}{}{}.{}", first, first + 999, n, who, years, ext), f.files[i].0)
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
            if k == "Not_Sorted" {
                continue;
            }
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

/// A round picture of one face: the photo, scaled and moved so the face (a little more than its box) fills it.
/// Clicking it opens the photo.
fn face_bubble(f: &Face, i: usize, b: [f32; 4], gi: Option<usize>, size: u32, title: &str) -> N {
    let url = f.thumb_cache.get(&i).cloned().unwrap_or_default();
    let (w, h) = f.pics.get(i).copied().flatten().map(|p| (p.1.max(1) as f64, p.2.max(1) as f64)).unwrap_or((1.0, 1.0));
    let (bx, by, bw, bh) = (b[0] as f64 * w, b[1] as f64 * h, b[2] as f64 * w, b[3] as f64 * h);
    let side = (bw.max(bh) * 1.35).min(w.min(h)).max(1.0);
    let (cx, cy) = (bx + bw / 2.0, by + bh / 2.0);
    let x0 = (cx - side / 2.0).clamp(0.0, (w - side).max(0.0));
    let y0 = (cy - side / 2.0).clamp(0.0, (h - side).max(0.0));
    let px = if w > side { x0 / (w - side) * 100.0 } else { 50.0 };
    let py = if h > side { y0 / (h - side) * 100.0 } else { 50.0 };
    let style = if url.is_empty() {
        format!("width:{s}px;height:{s}px", s = size)
    } else {
        format!("width:{s}px;height:{s}px;background-image:url('{u}');background-size:{bw:.2}% {bh:.2}%;background-position:{px:.2}% {py:.2}%", s = size, u = url.replace('\'', "%27"), bw = w / side * 100.0, bh = h / side * 100.0, px = px, py = py)
    };
    el("button")
        .attr("type", "button")
        .cls("fm-bub")
        .attr("title", title.to_string())
        .attr("aria-label", format!("Open {}", title))
        .style(style)
        .on("click", Msg::T(Tool::Face, 50, format!("{}\t{}", i, gi.map(|g| g.to_string()).unwrap_or_else(|| "-".into()))))
        .into()
}

/// The photo viewer: the picture large (a video plays), the face ringed, the person's other photos one step away.
fn face_viewer(f: &Face) -> N {
    let Some((i, gi)) = f.viewer else { return txt("") };
    let Some(file) = f.files.get(i) else { return txt("") };
    let r = f.result.as_ref();
    let list: Vec<usize> = match (gi, r) {
        (Some(g), Some(r)) => r.groups.get(g).map(|x| x.1.clone()).unwrap_or_default(),
        _ => Vec::new(),
    };
    let pos = list.iter().position(|x| *x == i);
    let ring = gi.and_then(|g| r.and_then(|r| r.face_at.get(&(g, i)).copied()));
    let who = gi.and_then(|g| r.and_then(|r| r.groups.get(g))).map(|(k, _)| f.names.get(k).cloned().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| k.replace('_', " "))).unwrap_or_default();
    let pic: N = if face_is_video(&file.2) {
        el("video").attr("src", f.viewer_url.clone()).attr("controls", "").attr("autoplay", "").attr("muted", "").attr("playsinline", "").into()
    } else {
        el("img").attr("src", f.viewer_url.clone()).attr("alt", file.2.clone()).into()
    };
    el("div")
        .cls("fm-viewer")
        .attr("role", "dialog")
        .attr("aria-label", "Photo")
        .kid(el("button").attr("type", "button").cls("fm-v-back").attr("aria-label", "Close").on("click", Msg::T(Tool::Face, 51, String::new())))
        .kid(
            el("figure")
                .cls("fm-v-fig")
                .kid(
                    el("div")
                        .cls("fm-v-pic")
                        .kid(pic)
                        .kid_if(ring.is_some(), || {
                            let b = ring.unwrap_or([0.0; 4]);
                            el("span").cls("fm-v-ring").style(format!("left:{:.2}%;top:{:.2}%;width:{:.2}%;height:{:.2}%", b[0] * 100.0, b[1] * 100.0, b[2] * 100.0, b[3] * 100.0)).into()
                        }),
                )
                .kid(el("figcaption").kid_if(!who.is_empty(), || el("b").text(format!("{} · ", who)).into()).kid(txt(file.2.clone())).kid_if(pos.is_some(), || el("span").cls("hint").text(format!("  {} of {}", pos.unwrap_or(0) + 1, list.len())).into())),
        )
        .kid_if(pos.map(|p| p > 0).unwrap_or(false), || el("button").attr("type", "button").cls("fm-v-nav prev").attr("aria-label", "Previous").on("click", Msg::T(Tool::Face, 52, String::new())).text("‹").into())
        .kid_if(pos.map(|p| p + 1 < list.len()).unwrap_or(false), || el("button").attr("type", "button").cls("fm-v-nav next").attr("aria-label", "Next").on("click", Msg::T(Tool::Face, 53, String::new())).text("›").into())
        .kid(el("button").attr("type", "button").cls("fm-v-x").attr("aria-label", "Close").on("click", Msg::T(Tool::Face, 51, String::new())).text("✕"))
        .into()
}

fn face_view(s: &State) -> N {
    let f = &s.face;
    let strict = if f.strict == 0.0 { 75.0 } else { f.strict };
    let can = host::call("canpick", "").as_deref() == Some("1");
    let step = |n: &str, title: &str| -> N { el("div").cls("fm-step-h").kid(el("span").cls("fm-n").text(n.to_string())).kid(el("h3").text(title.to_string())).into() };
    let check = |on: bool, a: u16, title: &str, more: &str| -> N {
        el("label")
            .cls("fm-option")
            .kid(el("input").attr("type", "checkbox").prop("checked", if on { "1" } else { "0" }).on("change", Msg::T(Tool::Face, a, String::new())))
            .kid(el("span").kid(el("b").text(title.to_string())).kid(el("span").cls("hint").text(more.to_string())))
            .into()
    };
    let ready = if f.files.is_empty() { f.msg.clone() } else {
        let v = f.files.iter().filter(|x| face_is_video(&x.2)).count();
        let p = f.files.len() - v;
        let mut parts = Vec::new();
        if p > 0 { parts.push(format!("{} photo{}", p, if p == 1 { "" } else { "s" })); }
        if v > 0 { parts.push(format!("{} video{}", v, if v == 1 { "" } else { "s" })); }
        format!("{} ready", parts.join(" and "))
    };
    let mut root = el("div")
        .cls("tool fm")
        .kid(
            el("div")
                .cls("fm-intro")
                .kid(el("p").cls("lede").kid(txt("Sort photos and videos by face: Face Mace finds the faces, learns who is who and groups everything by person. ")).kid(el("b").text("It all happens on this device; nothing is uploaded.")))
                // the desktop program (owner, 2026-10-15), built by GitHub on Windows from back/rust/facemace-desktop
                .kid_if(!s.app_mode, || {
                    el("div")
                        .cls("fm-gets")
                        .kid(el("a").cls("fm-get").attr("href", "https://github.com/ex-tern/pi/releases/download/facemace-windows/FaceMace-Setup.exe").attr("rel", "noopener").attr("title", "Installs Face Mace: Start menu and desktop shortcuts, uninstall from Settings > Apps; no administrator needed").text("Install for Windows ↓"))
                        .kid(el("a").cls("fm-get-alt").attr("href", "https://github.com/ex-tern/pi/releases/download/facemace-windows/FaceMace.exe").attr("rel", "noopener").attr("title", "Runs without installing").text("or the .exe alone"))
                        .into()
                }),
        )
        .kid(
            el("section")
                .cls("card fm-step")
                .kid(step("1", "Photos and videos"))
                .kid(
                    el("div")
                        .cls("fm-drop")
                        .on("drop", Msg::TV(Tool::Face, 1))
                        .kid(el("p").cls("fm-drop-t").text("Drop a folder or files here"))
                        .kid(el("p").cls("hint").text("JPG, PNG, HEIC and videos (MP4, MOV, MKV, WebM, AVI and more)"))
                        .kid(
                            el("div")
                                .cls("row")
                                .kid(if can {
                                    // opened with the browser's folder access: duplicates can then be taken out of it when asked
                                    el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 18, String::new())).text("Choose a folder").into()
                                } else {
                                    N::from(el("label").cls("btn").kid(txt("Choose a folder")).kid(el("input").attr("type", "file").attr("webkitdirectory", "").attr("multiple", "").attr("hidden", "").on("files", Msg::TV(Tool::Face, 1))))
                                })
                                .kid(el("label").cls("btn").kid(txt("Choose files")).kid(el("input").attr("type", "file").attr("accept", ".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif,video/*,.mp4,.m4v,.mov,.3gp,.3g2,.avi,.mkv,.webm,.wmv,.mts,.m2ts,.mpg,.mpeg,.flv,.ogv").attr("multiple", "").attr("hidden", "").on("files", Msg::TV(Tool::Face, 1)))),
                        )
                        .kid_if(!ready.is_empty(), || el("p").cls("fm-ready").cls_if(!f.files.is_empty(), "ok").text(ready.clone()).into()),
                ),
        )
        .kid(
            el("section")
                .cls("card fm-step")
                .kid(step("2", "Sorting"))
                .kid(
                    el("label")
                        .cls("fm-slider")
                        .kid(el("span").text("Match strictness"))
                        .kid(el("input").attr("type", "range").attr("min", "40").attr("max", "120").attr("aria-label", "Match strictness").prop("value", format!("{}", strict as i64)).on("input", Msg::TV(Tool::Face, 2)))
                        .kid(el("output").text(format!("{}", strict as i64))),
                )
                .kid(el("p").cls("hint").text("Lower is stricter: more people, each with fewer photos. Higher groups more together. Faces are found once, so trying another strictness is quick."))
                .kid(check(!f.no_wake, 34, "Keep the computer awake while it works", "Windows (or the Mac) does not go to sleep in the middle of a long sort; it can again when Face Mace is done."))
                .kid(check(f.dedupe, 9, "Delete duplicates", "A photo or video that is there twice (copied, saved again or resized) is kept once, the biggest. Your original folder is not changed."))
                .kid(
                    el("div")
                        .cls("fm-people")
                        .kid(el("span").kid(el("b").text("People you know")).kid(el("span").cls("hint").text(if f.imported.is_empty() { " Load a people file saved before, and they are recognized and named here too.".to_string() } else { format!(" {} known: remembered on this device or loaded from a file.", f.imported.len()) })))
                        .kid(
                            el("div")
                                .cls("row")
                                .kid(el("label").cls("btn").kid(txt("Load people…")).kid(el("input").attr("type", "file").attr("accept", ".json,application/json").attr("hidden", "").on("files", Msg::TV(Tool::Face, 17))))
                                .kid(el("button").attr("type", "button").cls("btn").attr_if(f.last_people.is_empty(), "disabled", "").on("click", Msg::T(Tool::Face, 16, String::new())).text("Save people")),
                        ),
                ),
        )
        .kid(
            el("section")
                .cls("card fm-step")
                .kid(step("3", "Output"))
                .kid(
                    el("label")
                        .cls("fm-parts")
                        .kid(el("span").kid(el("b").text("Work in parts of ")))
                        .kid(el("input").cls("input").attr("type", "number").attr("min", "0").attr("step", "100").attr("placeholder", "all").attr("aria-label", "Files per part").prop("value", if f.part_size == 0 { String::new() } else { f.part_size.to_string() }).on("input", Msg::TV(Tool::Face, 13)))
                        .kid(el("span").cls("hint").text("files. It pauses after each part (Next part goes on), and each part can be downloaded on its own. Empty: all at once.")),
                )
                .kid(check(f.by_date, 5, "Rename by date", "Numbered in the order they were taken, then who is in them and the year, Persian and Gregorian: 0000001-Anna-1382-2004.jpg, in folders of a thousand."))
                .kid({
                    let on = f.out_dir.is_some() || f.out_picking;
                    let mut d = el("div").cls("fm-out");
                    d = if can {
                        let more = match &f.out_dir {
                            Some(_) => if f.by_date { "Each file is renamed into it as soon as it is looked at (the dates are read first). Name a person and their files are renamed there too." } else { "Each photo goes into its person's folder as soon as it is scanned." },
                            None => "Choose a folder; each photo goes into it as soon as it is done. Otherwise download a ZIP when it is done.",
                        };
                        d.kid(check(on, if f.out_dir.is_some() { 8 } else { 7 }, "Save into a folder as it works", more))
                            .kid_if(f.out_dir.is_some(), || {
                                el("p").cls("hint fm-out-at")
                                    .kid(txt("Folder: ")).kid(el("b").text(f.out_dir.clone().unwrap_or_default()))
                                    .kid(txt(if f.out_asked > 0 { format!(" · {} of {} saved", f.out_saved, f.out_asked) } else { String::new() }))
                                    .into()
                            })
                    } else {
                        d.kid(el("p").cls("hint").text("The result downloads as a ZIP. (Saving straight into a folder needs Chrome or Edge.)"))
                    };
                    d.kid_if(!f.out_msg.is_empty(), || el("p").cls("hint warn").text(f.out_msg.clone()).into())
                }),
        )
        .kid(
            el("section")
                .cls("card fm-step")
                .kid(step("4", "Saving"))
                .kid(check(!f.forget, 30, "Remember people on this device", "Who you have named, and their faces as numbers (no pictures), so they are recognized next time. Kept in this browser only."))
                .kid(
                    el("div")
                        .cls("row fm-save")
                        .kid(el("button").attr("type", "button").cls("btn").attr_if(f.result.is_none(), "disabled", "").on("click", Msg::T(Tool::Face, 32, String::new())).text("Save work"))
                        .kid(el("label").cls("btn").kid(txt("Open saved work…")).kid(el("input").attr("type", "file").attr("accept", ".json,application/json").attr("hidden", "").on("files", Msg::TV(Tool::Face, 17))))
                        .kid(el("button").attr("type", "button").cls("btn").attr_if(f.result.is_none(), "disabled", "").on("click", Msg::T(Tool::Face, 33, String::new())).text("Save list (CSV)"))
                        .kid_if(!f.forget && !f.imported.is_empty(), || el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 31, String::new())).text("Forget remembered people").into()),
                )
                .kid(el("p").cls("hint").text("Saved by itself, in this browser: your answers and names after every change, and each photo's scan as it is done; choosing the same photos again (after closing Face Mace, or the computer going off) brings them back, and photos already scanned are not scanned again. Save work puts all of it in a file, to go on on another computer."))
                .kid(el("p").kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 35, String::new())).text("Clear saved data"))),
        )
        .kid(
            el("div")
                .cls("fm-go")
                .kid(el("button").attr("type", "button").cls("btn primary fm-sort").attr_if(f.files.is_empty() || f.running, "disabled", "").on("click", Msg::T(Tool::Face, 3, String::new())).text(if f.running { "Sorting…".to_string() } else if f.stopped && f.part_size > 0 { format!("Next part ({} of {})", f.parts_done.len() + 1, (f.files.len() + f.part_size - 1) / f.part_size.max(1)) } else if f.stopped { "Go on sorting".to_string() } else { "Sort by face".to_string() }))
                .kid_if(!f.running, || el("button").attr("type", "button").cls("btn fm-rename").attr_if(f.files.is_empty(), "disabled", "").attr("title", "Rename by date without sorting by face: 0000001-1382-2004.jpg, …").on("click", Msg::T(Tool::Face, 12, String::new())).text("Rename only").into())
                .kid_if(f.running, || el("button").attr("type", "button").cls("btn fm-stop").on("click", Msg::T(Tool::Face, 11, String::new())).text("Stop").into())
                .kid_if(f.files.is_empty(), || el("span").cls("hint").text("Choose photos or videos first.").into()),
        );
    root = root.kid(face_viewer(f));
    // the faces just found, as bubbles, with whom each was matched to (live)
    if f.running && !f.recent.is_empty() {
        let who = |i: usize| -> String {
            f.result.as_ref().and_then(|r| r.groups.iter().find(|g| g.0.starts_with("Person_") && g.1.contains(&i))).map(|(k, _)| f.names.get(k).cloned().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| k.replace('_', " "))).unwrap_or_else(|| "…".into())
        };
        root = root.kid(
            el("div")
                .cls("fm-now")
                .kid(el("span").cls("hint").text("Now recognizing"))
                .kids(f.recent.iter().rev().map(|(i, b)| -> N { el("span").cls("fm-now-i").kid(face_bubble(f, *i, *b, None, 52, &f.files[*i].2)).kid(el("small").text(who(*i))).into() })),
        );
    }
    if f.running {
        let total = f.files.len().max(1);
        root = root.kid(
            el("div")
                .cls("fm-progress")
                .kid(el("span").cls("md-bar").kid(el("i").style(format!("width:{:.0}%", 100.0 * (if f.pre_dating { f.date_k } else { f.at }) as f64 / total as f64))))
                .kid(el("p").cls("hint").text(if f.pre_dating { format!("Reading when each was taken: {} of {}…", f.date_k + 1, f.files.len()) } else if f.awake && face_ready(f) { format!("Scanning {} of {}… (keeping the computer awake)", f.at + 1, f.files.len()) } else if !face_ready(f) { "Loading the face engines…".to_string() } else { format!("Scanning {} of {}…", f.at + 1, f.files.len()) })),
        );
    }
    // packing a ZIP, reading dates or saving into the folder can be stopped too
    let busy = (f.date_k < f.date_list.len()) || f.msg.starts_with("Packing") || f.out_asked > f.out_saved;
    if let Some(r) = &f.result {
        let pct = |p: f64| format!("{:.0}%", (p * 100.0).clamp(0.0, 100.0));
        let sure_cls = |p: f64| if p >= 0.9 { "hi" } else if p >= 0.7 { "mid" } else { "lo" };
        let label = |k: &str| if k == "No_Faces_Detected" { "No faces found".to_string() } else if k == "Not_Recognized" { "Not recognized".to_string() } else if k == "Not_Sorted" { "Renamed only, not sorted".to_string() } else { k.replace('_', " ") };
        root = root
            .kid(
                el("div")
                    .cls("md-stats")
                    .kid(el("div").kid(el("b").text(format!("{}", f.files.len()))).kid(el("span").text("files")))
                    .kid(el("div").kid(el("b").text(format!("{}", r.people))).kid(el("span").text("people found")))
                    .kid(el("div").kid(el("b").text(format!("{}", r.faces))).kid(el("span").text("faces")))
                    .kid(el("div").kid(el("b").text(r.overall.map(|p| pct(p)).unwrap_or_else(|| "—".into()))).kid(el("span").text("recognition confidence")))
                    .kid(el("div").kid(el("b").text(format!("{:.1} s", r.ms / 1000.0))).kid(el("span").text(format!("at strictness {}", r.strict as i64)))),
            )
            .kid_if(!f.parts_done.is_empty(), || {
                el("div")
                    .cls("fm-partlist")
                    .kid(el("b").text(format!("Parts done: {}", f.parts_done.len())))
                    .kids(f.parts_done.iter().enumerate().map(|(k, (a, b))| -> N {
                        el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 2000 + k as u16, String::new())).text(format!("Part {} ({}–{}) ZIP", k + 1, a + 1, b)).into()
                    }))
                    .into()
            })
            .kid_if(!r.done, || el("p").cls("fm-live").text(format!("Live: {} of {} looked at so far", f.faces.len(), f.files.len())).into())
            .kid_if(r.done && r.overall.is_some(), || el("p").cls("hint").text("Confidence is how closely each face matches the others of its person: 50% is the line between the same and someone else, above 90% is a clear match. A person seen only once has no figure.").into())
            .kid(el("div").cls("row fm-actions").kid_if(busy && !f.running, || el("button").attr("type", "button").cls("btn fm-stop").on("click", Msg::T(Tool::Face, 11, String::new())).text("Stop").into()).kid(el("button").attr("type", "button").cls("btn primary").attr_if(!r.done, "disabled", "").on("click", Msg::T(Tool::Face, 4, String::new())).attr_if(f.live_rename, "disabled", "").text(match (f.by_date, f.out_dir.is_some()) { _ if f.live_rename && f.out_dir.is_some() => "Renamed into the folder as it went",
_ if f.live_rename => "Download each part below", (true, true) => "Save renamed into the folder", (true, false) => "Download renamed (ZIP)", _ => "Download as ZIP" })).kid(el("span").cls("hint").text(f.msg.clone())))
            .kid_if(f.by_date, || el("p").cls("hint").text("Name the people below; anyone not named is \"unknown\". The date is the one the camera or phone wrote into the photo or video where there is one, otherwise the file's. A video's faces are looked for on one frame; one the browser cannot play is renamed as unknown.").into())
            .kid_if(f.cache_hits > 0, || el("p").cls("hint").text(format!("{} photo{} already scanned before: taken from what was saved.", f.cache_hits, if f.cache_hits == 1 { "" } else { "s" })).into())
            .kid_if(!f.engines_used.is_empty(), || {
                el("p").cls("hint").text(format!("Engines: {}{}.", f.engines_used, if f.ml == 3 && !f.ml_err.is_empty() { format!(" (the neural ones could not start here: {})", f.ml_err) } else { String::new() })).into()
            })
            .kid_if(r.unreadable > 0, || el("p").cls("hint").text(format!("{} file(s) could not be read and were skipped.", r.unreadable)).into())
            .kid_if(!r.dups.is_empty(), || {
                let open: Vec<&(usize, usize)> = r.dups.iter().filter(|d| !f.dup_gone.contains(&d.0)).collect();
                let marked = f.dup_del.iter().filter(|i| !f.dup_gone.contains(i)).count();
                let thumb = |i: usize| -> N {
                    let url = r.thumbs.iter().find(|(j, _)| *j == i).map(|x| x.1.clone()).or_else(|| f.thumb_cache.get(&i).cloned()).unwrap_or_default();
                    if url.is_empty() { el("span").cls("fm-tile").text(face_ext(&f.files[i].2).to_uppercase()).into() } else { el("img").attr("loading", "lazy").attr("alt", f.files[i].2.clone()).attr("src", url).into() }
                };
                el("section")
                    .cls("card fm-dups")
                    .kid(
                        el("div")
                            .cls("fm-head")
                            .kid(el("h3").text(format!("Duplicates · {}", r.dups.len())))
                            .kid(el("span").cls("hint").text("Each is the same picture as one kept. Keep it, or delete it?"))
                            .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 42, String::new())).text("Keep all"))
                            .kid(el("button").attr("type", "button").cls("btn fm-no").on("click", Msg::T(Tool::Face, 43, String::new())).text("Delete all")),
                    )
                    .kid(el("div").cls("fm-dlist").kids(open.iter().take(60).map(|(d, k)| -> N {
                        let del = f.dup_del.contains(d);
                        el("div")
                            .cls("fm-dup")
                            .cls_if(del, "del")
                            .kid(el("figure").kid(thumb(*d)).kid(el("figcaption").attr("title", f.files[*d].2.clone()).text(f.files[*d].2.rsplit('/').next().unwrap_or("").to_string())))
                            .kid(el("span").cls("fm-eq").text("="))
                            .kid(el("figure").cls("kept").kid(thumb(*k)).kid(el("figcaption").attr("title", f.files[*k].2.clone()).text(format!("kept: {}", f.files[*k].2.rsplit('/').next().unwrap_or("")))))
                            .kid(
                                el("div")
                                    .cls("fm-dup-a")
                                    .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 40, d.to_string())).text("Keep"))
                                    .kid(el("button").attr("type", "button").cls("btn fm-no").cls_if(del, "on").on("click", Msg::T(Tool::Face, 41, d.to_string())).text(if del { "To delete ✓" } else { "Delete" })),
                            )
                            .into()
                    })))
                    .kid_if(open.len() > 60, || el("p").cls("hint").text(format!("and {} more (Keep all and Delete all count them too)", open.len() - 60)).into())
                    .kid(
                        el("div")
                            .cls("row fm-dup-go")
                            .kid_if(f.src_folder, || el("button").attr("type", "button").cls("btn primary").attr_if(marked == 0, "disabled", "").on("click", Msg::T(Tool::Face, 44, String::new())).text(format!("Move {} to a Duplicates folder", marked)).into())
                            .kid_if(f.src_folder, || el("button").attr("type", "button").cls("btn fm-no").attr_if(marked == 0, "disabled", "").on("click", Msg::T(Tool::Face, 45, String::new())).text(format!("Delete {} for good", marked)).into())
                            .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 10, String::new())).text("Download the list")),
                    )
                    .kid(el("p").cls("hint").text(if f.src_folder {
                        "Moving puts them in a \"Duplicates (Face Mace)\" folder inside yours, to check before you empty it; deleting cannot be undone. The browser asks before changing the folder. Either way they are left out of what Face Mace saves."
                    } else {
                        "To delete them in your folder from here, open it with Choose a folder (Chrome or Edge). Until then they are only left out of what Face Mace saves, and the list says which they are."
                    }))
                    .kid_if(!f.dup_msg.is_empty(), || el("p").cls("fm-ready ok").text(f.dup_msg.clone()).into())
                    .into()
            });
        // the people, for "Move to" and "Merge into"
        let persons: Vec<(usize, String)> = r
            .groups
            .iter()
            .filter_map(|(k, _)| k.strip_prefix("Person_").and_then(|x| x.parse::<usize>().ok()).map(|id| (id, f.names.get(k).cloned().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| label(k)))))
            .collect();
        let pname = |id: usize| persons.iter().find(|p| p.0 == id).map(|p| p.1.clone()).unwrap_or_else(|| format!("Person {}", id));
        // Google Photos' way: a few questions about the least sure photos; every answer makes the next match surer
        if r.done && !r.review.is_empty() {
            root = root.kid(
                el("section")
                    .cls("card fm-review")
                    .kid(el("div").cls("fm-step-h").kid(el("h3").text("Help Face Mace get surer")).kid(el("span").cls("hint").text("Each answer is used to match the rest.")))
                    .kid(el("div").cls("fm-qs").kids(r.review.iter().map(|(i, p, c)| -> N {
                        let url = f.thumb_cache.get(i).cloned().unwrap_or_default();
                        let v = format!("{}\t{}", i, p);
                        el("div")
                            .cls("fm-q")
                            .kid(if url.is_empty() { el("span").cls("fm-tile").text(face_ext(&f.files[*i].2).to_uppercase()).into() } else { N::from(el("img").attr("alt", f.files[*i].2.clone()).attr("src", url)) })
                            .kid(el("p").kid(txt("Is this ")).kid(el("b").text(pname(*p))).kid(txt("?")).kid(el("span").cls("hint").text(format!(" {} sure", pct(*c)))))
                            .kid(
                                el("div")
                                    .cls("row")
                                    .kid(el("button").attr("type", "button").cls("btn fm-yes").on("click", Msg::T(Tool::Face, 20, v.clone())).text("Yes"))
                                    .kid(el("button").attr("type", "button").cls("btn fm-no").on("click", Msg::T(Tool::Face, 21, v)).text("No")),
                            )
                            .into()
                    }))),
            );
        }
        // many people: the biggest sixty first (the others behind "Show all")
        let mut order: Vec<usize> = (0..r.groups.len()).collect();
        order.sort_by(|&a, &b| {
            let rank = |g: usize| if r.groups[g].0.starts_with("Person_") { 0 } else { 1 };
            rank(a).cmp(&rank(b)).then(r.groups[b].1.len().cmp(&r.groups[a].1.len()))
        });
        let cap = if f.show_all { usize::MAX } else { 60 };
        for &gi in order.iter().take(cap) {
            let (k, idx) = &r.groups[gi];
            root = root.kid(
                el("section")
                    .cls("fm-group")
                    .kid(
                        el("div")
                            .cls("fm-head")
                            .kid_if(r.avatars.contains_key(&gi), || {
                                let (ai, ab) = r.avatars[&gi];
                                face_bubble(f, ai, ab, Some(gi), 48, &format!("{} — open the photo", f.names.get(k).cloned().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| label(k))))
                            })
                            .kid(el("h3").text(format!("{} · {} photo{}", f.names.get(k).cloned().unwrap_or_else(|| label(k)), idx.len(), if idx.len() == 1 { "" } else { "s" })))
                            .kid_if(r.conf.get(gi).copied().unwrap_or(0.0) > 0.0, || {
                                let c = r.conf[gi];
                                el("span").cls("fm-sure").cls(sure_cls(c)).attr("title", "How surely these are one person").text(format!("{} sure", pct(c))).into()
                            })
                            .kid_if(k.starts_with("Person_"), || {
                                el("input")
                                    .cls("input fm-name")
                                    .attr("type", "text")
                                    .attr("placeholder", "Name this person")
                                    .attr("aria-label", format!("Name for {}", label(k)))
                                    .prop("value", f.names.get(k).cloned().unwrap_or_default())
                                    .on("input", Msg::TV(Tool::Face, 1000 + gi as u16))
                                    .on("change", Msg::TV(Tool::Face, 3000 + gi as u16))
                                    .into()
                            })
                            .kid_if(k.starts_with("Person_") && persons.len() > 1, || {
                                let me: usize = k.trim_start_matches("Person_").parse().unwrap_or(0);
                                el("select")
                                    .cls("input fm-merge")
                                    .attr("aria-label", "Merge into another person")
                                    .on("change", Msg::TV(Tool::Face, 23))
                                    .kid(el("option").attr("value", "").text("Same person as…"))
                                    .kids(persons.iter().filter(|p| p.0 != me).map(|(id, n)| -> N { el("option").attr("value", format!("{}\t{}", me, id)).text(n.clone()).into() }))
                                    .into()
                            }),
                    )
                    .kid(
                        el("div")
                            .cls("fm-thumbs")
                            .kids(idx.iter().take(if k.strip_prefix("Person_").and_then(|x| x.parse::<usize>().ok()).map(|p| f.expanded.contains(&p)).unwrap_or(false) { 600 } else { 12 }).map(|i| -> N {
                                let url = r.thumbs.iter().find(|(j, _)| j == i).map(|x| x.1.clone()).unwrap_or_default();
                                let pc = r.photo_conf.get(&(gi, *i)).copied();
                                let title = match pc { Some(p) => format!("{} · {} match", f.files[*i].2, pct(p)), None => f.files[*i].2.clone() };
                                let pic: N = if url.is_empty() {
                                    el("span").cls("fm-tile").on("click", Msg::T(Tool::Face, 50, format!("{}\t{}", i, gi))).text(face_ext(&f.files[*i].2).to_uppercase()).into()
                                } else {
                                    el("img").attr("loading", "lazy").attr("alt", f.files[*i].2.clone()).attr("src", url).on("click", Msg::T(Tool::Face, 50, format!("{}\t{}", i, gi))).into()
                                };
                                let me: usize = k.strip_prefix("Person_").and_then(|x| x.parse().ok()).unwrap_or(0);
                                let sure = me > 0 && f.confirm.get(i) == Some(&me);
                                el("span")
                                    .cls("fm-th")
                                    .cls_if(sure, "sure")
                                    .attr("title", if sure { format!("{} · confirmed", f.files[*i].2) } else { title })
                                    .kid(pic)
                                    .kid_if(pc.is_some() || sure, || if sure { el("em").cls("hi").text("✓").into() } else { el("em").cls(sure_cls(pc.unwrap_or(0.0))).text(pct(pc.unwrap_or(0.0))).into() })
                                    .kid(
                                        el("span")
                                            .cls("fm-acts")
                                            .kid_if(me > 0 && !sure, || el("button").attr("type", "button").attr("title", format!("Yes, this is {}", pname(me))).attr("aria-label", format!("Yes, this is {}", pname(me))).on("click", Msg::T(Tool::Face, 20, format!("{}\t{}", i, me))).text("✓").into())
                                            .kid_if(me > 0, || el("button").attr("type", "button").attr("title", format!("Not {}", pname(me))).attr("aria-label", format!("Not {}", pname(me))).on("click", Msg::T(Tool::Face, 21, format!("{}\t{}", i, me))).text("✕").into())
                                            .kid(
                                                el("select")
                                                    .attr("aria-label", "Move to")
                                                    .attr("title", "Move to another person")
                                                    .on("change", Msg::TV(Tool::Face, 22))
                                                    .kid(el("option").attr("value", "").text("→"))
                                                    .kids(persons.iter().filter(|p| p.0 != me).map(|(id, n)| -> N { el("option").attr("value", format!("{}\t{}\t{}", i, me, id)).text(n.clone()).into() }))
                                                    .kid(el("option").attr("value", format!("{}\t{}\t0", i, me)).text("A new person")),
                                            ),
                                    )
                                    .into()
                            }))
                            .kid_if(idx.len() > 12, || {
                                let me: usize = k.strip_prefix("Person_").and_then(|x| x.parse().ok()).unwrap_or(0);
                                if me > 0 {
                                    let open = f.expanded.contains(&me);
                                    el("button").attr("type", "button").cls("btn fm-more").on("click", Msg::T(Tool::Face, 24, me.to_string())).text(if open { "Fewer".to_string() } else { format!("All {} photos", idx.len()) }).into()
                                } else {
                                    el("span").cls("fm-more").text(format!("+{}", idx.len() - 12)).into()
                                }
                            }),
                    ),
            );
        }
    }
    if let Some(r) = &f.result {
        if r.groups.len() > 60 {
            let more: N = el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Face, 14, String::new())).text(if f.show_all { "Show the biggest sixty only".to_string() } else { format!("Show all {} groups", r.groups.len()) }).into();
            root = root.kid(el("p").kid(more));
        }
    }
    root.into()
}

const FACE_CSS: &str = "\
.fm-intro{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:16px}.fm-intro .lede{margin:0}\
.fm-gets{flex:none;display:grid;gap:4px;justify-items:end}.fm-get-alt{font-size:12px;color:var(--muted)}\
.fm-get{flex:none;font-size:13px;font-weight:600;padding:6px 12px;border:1px solid var(--line2);background:#fff;white-space:nowrap}.fm-get:hover{border-color:var(--ink);text-decoration:none}\
.fm-step{margin-bottom:12px;display:grid;gap:10px}.fm-step-h{display:flex;align-items:center;gap:10px}.fm-step-h h3{margin:0;font-size:16px}\
.fm-n{width:24px;height:24px;display:grid;place-items:center;background:var(--ink);color:#fff;font:600 12px/1 inherit;flex:none}\
.fm-drop-t{font-weight:600;margin:0 0 2px}.fm-ready{margin:10px 0 0;font-size:14px;color:var(--muted)}.fm-ready.ok{color:#2b8a3e;font-weight:600}\
.fm-slider{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;max-width:520px}.fm-slider input{width:100%}.fm-slider output{font-variant-numeric:tabular-nums;font-weight:600;min-width:2.5ch;text-align:right}\
.fm-option{display:grid!important;grid-template-columns:auto 1fr;gap:10px;align-items:start;margin:0!important;cursor:pointer}.fm-option>span{display:grid;gap:2px}.fm-option b{font-weight:600}\
.fm-go{display:flex;align-items:center;gap:12px;margin:16px 0 8px}.fm-sort{min-width:180px;min-height:44px;font-size:15px}\
.fm-actions{align-items:center;gap:12px;margin:12px 0}\
.fm-rename{min-height:44px}\
.fm-people{display:grid;gap:6px;padding-top:10px;border-top:1px solid var(--line)}.fm-people .row{gap:8px}\
.fm-parts{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.fm-parts .input{width:110px;flex:none;padding:6px 10px}.fm-parts .hint{flex-basis:100%}\
.fm-partlist{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}\
.fm-th .fm-acts{position:absolute;left:3px;top:3px;right:3px;display:flex;gap:3px;opacity:0;transition:opacity .12s}.fm-th:hover .fm-acts,.fm-th:focus-within .fm-acts{opacity:1}\
.fm-acts button,.fm-acts select{height:22px;min-width:22px;padding:0 4px;border:0;background:rgba(255,255,255,.92);font:600 12px/22px inherit;cursor:pointer}.fm-acts select{max-width:30px;appearance:none;-webkit-appearance:none;text-align:center}\
.fm-acts button:first-child:hover{background:#2b8a3e;color:#fff}.fm-acts button:hover{background:#c92a2a;color:#fff}\
@media (hover:none){.fm-th .fm-acts{opacity:1}}\
.fm-th.sure img{outline:2px solid #2b8a3e;outline-offset:-2px}\
.fm-merge{max-width:170px;padding:5px 8px;font-size:13px}\
.fm-review{margin:14px 0}.fm-qs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.fm-q{display:grid;gap:6px;justify-items:start}.fm-q img,.fm-q .fm-tile{width:100%;height:auto;aspect-ratio:1;object-fit:cover}.fm-q p{margin:0;font-size:13.5px}\
.fm-yes:hover:not(:disabled){background:#2b8a3e;border-color:#2b8a3e;color:#fff}.fm-no:hover:not(:disabled){background:#c92a2a;border-color:#c92a2a;color:#fff}\
.fm-save{gap:8px;flex-wrap:wrap}\
.fm-dups{margin:14px 0;display:grid;gap:10px}.fm-dlist{display:grid;gap:8px}\
.fm-dup{display:grid;grid-template-columns:96px auto 96px 1fr;gap:10px;align-items:center;padding:8px;border:1px solid var(--line)}.fm-dup.del{border-color:#c92a2a;background:#fff5f5}\
.fm-dup figure{margin:0;display:grid;gap:3px}.fm-dup img,.fm-dup .fm-tile{width:96px;height:72px;object-fit:cover}.fm-dup figcaption{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:96px}\
.fm-eq{font-weight:700;color:var(--muted)}.fm-dup-a{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}.fm-no.on{background:#c92a2a;color:#fff;border-color:#c92a2a}\
.fm-dup-go{gap:8px;flex-wrap:wrap}\
@media (max-width:699px){.fm-dup{grid-template-columns:72px auto 72px;}.fm-dup-a{grid-column:1/-1;justify-content:flex-start}.fm-dup img,.fm-dup .fm-tile{width:72px;height:56px}}\
.fm-bub{flex:none;border-radius:50%!important;border:2px solid #fff;box-shadow:0 0 0 1.5px var(--line2),0 4px 10px -6px rgba(0,0,0,.4);background:#d8d6cf no-repeat;cursor:zoom-in;padding:0;transition:transform .12s,box-shadow .12s}\
.fm-bub:hover{transform:scale(1.06);box-shadow:0 0 0 2px var(--accent),0 6px 14px -6px rgba(0,0,0,.45)}\
.fm-now{display:flex;align-items:center;gap:10px;overflow-x:auto;padding:10px 2px;margin:8px 0}.fm-now-i{display:grid;justify-items:center;gap:3px;animation:fmpop .35s ease-out}.fm-now-i small{font-size:11px;color:var(--muted);max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
@keyframes fmpop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}\
.fm-thumbs img,.fm-thumbs .fm-tile{cursor:zoom-in}\
.fm-viewer{position:fixed;inset:0;z-index:2147483100;display:grid;place-items:center;padding:24px 64px}.fm-v-back{position:absolute;inset:0;border:0;background:rgba(10,10,14,.86);cursor:zoom-out}\
.fm-v-fig{position:relative;margin:0;display:grid;gap:10px;justify-items:center;max-width:100%;max-height:100%}.fm-v-pic{position:relative;display:inline-block;line-height:0}\
.fm-v-pic img,.fm-v-pic video{max-width:calc(100vw - 140px);max-height:calc(100vh - 110px);object-fit:contain;background:#000}\
.fm-v-ring{position:absolute;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 2px var(--accent),0 0 0 9999px rgba(0,0,0,.25);pointer-events:none}\
.fm-v-fig figcaption{color:#fff;font-size:14px;text-align:center}.fm-v-fig figcaption .hint{color:#bbb}\
.fm-v-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:64px;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:34px;cursor:pointer}.fm-v-nav:hover{background:rgba(255,255,255,.3)}.fm-v-nav.prev{left:10px}.fm-v-nav.next{right:10px}\
.fm-v-x{position:absolute;top:12px;right:12px;width:40px;height:40px;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:20px;cursor:pointer}.fm-v-x:hover{background:rgba(255,255,255,.3)}\
@media (max-width:699px){.fm-viewer{padding:12px}.fm-v-pic img,.fm-v-pic video{max-width:calc(100vw - 24px);max-height:calc(100vh - 140px)}.fm-v-nav{top:auto;bottom:16px;transform:none}}\
.fm-stop{border-color:#c92a2a;color:#c92a2a}.fm-stop:hover:not(:disabled){background:#c92a2a;color:#fff;border-color:#c92a2a}\
.fm-live{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:14px;margin:8px 0}.fm-live::before{content:\"\";width:8px;height:8px;border-radius:50%;background:#2b8a3e;animation:lockblink 1.2s ease-in-out infinite}\
.fm-sure{font-size:12px;font-weight:600;padding:3px 8px;border:1px solid}.fm-sure.hi{color:#2b8a3e;border-color:#2b8a3e}.fm-sure.mid{color:#b06000;border-color:#b06000}.fm-sure.lo{color:#c92a2a;border-color:#c92a2a}\
.fm-th{position:relative;display:inline-block}.fm-th em{position:absolute;right:3px;bottom:3px;font:600 10.5px/1 inherit;font-style:normal;padding:2px 4px;background:rgba(0,0,0,.72);color:#fff}.fm-th em.mid{background:#b06000}.fm-th em.lo{background:#c92a2a}\
@media (max-width:699px){.fm-intro{flex-direction:column}.fm-gets{justify-items:start}}\
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
