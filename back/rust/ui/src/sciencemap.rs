// The Map of Science, and its game (arcade.js of the old page), in Rust. One surface, two modes.
//
// EXPLORE is the graph: every bubble is a field of science, sized by how many assessed papers it holds. The fields
// gather into one region per discipline; drag to pan, scroll to zoom, click a field for its detail and its papers.
// Fields with papers are solid and labelled with their counts; the rest of the taxonomy sits faint behind them.
//
// PLAY drops π into the same field. Absorb every field to win: you can only absorb what is smaller than you, bigger
// fields pull harder, and so do you. Power-ups (magnet, haste, shield, appetite) change how π moves for a few
// seconds, never what a run is worth. The field is issued and signed by the server (/api/arcade/start); every
// absorption is recorded with its time so the server can replay the run (/api/arcade/finish) — nothing here decides
// the reward. At most one absorption every 90 ms, as the server checks. Included into app.rs.

const WORLD_W: f64 = 3400.0;
const WORLD_H: f64 = 2200.0;
const MIN_EAT_MS: f64 = 90.0;
const T_MAP: u32 = 30;

const FIELD_COLORS: [&str; 12] = ["#5b67c7", "#3f978e", "#5f9a5c", "#c0645c", "#8a6cb6", "#4f7fbf", "#bf8c3e", "#4993b2", "#b5688f", "#829a4a", "#c17a4c", "#3f9aa6"];

fn color_for(domain: &str) -> &'static str {
    if domain.is_empty() || domain == "Unassigned" {
        return "#9a9a94";
    }
    let mut h: u32 = 0;
    for c in domain.encode_utf16() {
        h = h.wrapping_mul(31).wrapping_add(c as u32);
    }
    FIELD_COLORS[(h % FIELD_COLORS.len() as u32) as usize]
}

/// (key, label, glyph, ms, colour, hint)
const POWERS: [(&str, &str, &str, f64, &str, &str); 4] = [
    ("magnet", "Magnet", "🧲", 8000.0, "#f59e0b", "Smaller fields drift toward you"),
    ("haste", "Haste", "⚡", 7000.0, "#38bdf8", "Move faster for a few seconds"),
    ("shield", "Shield", "🛡️", 9000.0, "#34d399", "Survive one collision with something bigger"),
    ("appetite", "Appetite", "🍽️", 8000.0, "#f472b6", "Eat fields slightly larger than you"),
];

#[derive(Clone)]
struct MBubble {
    id: i64,
    mass: f64,
    domain: String,
    parent: String,
    papers: f64,
    live: bool,
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    eaten: bool,
    dimmed: bool,
}

#[derive(Default, PartialEq, Clone, Copy)]
enum MMode {
    #[default]
    Idle,
    Explore,
    Play,
}

#[derive(Default)]
pub struct SciMap {
    mode: MMode,
    loading: bool,
    data: Option<Value>,
    err: Option<String>,
    bubbles: Vec<MBubble>,
    regions: Vec<(String, f64, f64)>,
    edges: Vec<(usize, usize)>,
    bounds: (f64, f64, f64, f64),
    cam: (f64, f64, f64),
    view: (f64, f64),
    drag: Option<(f64, f64, f64, f64, bool)>,
    pointer: Option<(f64, f64)>,
    keys: Vec<String>,
    selected: Option<usize>,
    papers: Slot,
    papers_for: String,
    // play
    player: Option<(f64, f64, f64)>,
    absorbed: Vec<(i64, i64)>,
    started: f64,
    last_frame: f64,
    last_eat: f64,
    power: Option<usize>,
    power_until: f64,
    powerups: Vec<(usize, f64, f64, f64)>,
    next_power: f64,
    seed: u32,
    over: Option<(bool, Option<Value>)>,
    submitting: bool,
    message: (String, &'static str),
    pop: f64,
    // filters and look
    search: String,
    min_papers: f64,
    live_only: bool,
    labels: bool,
    mesh: bool,
    scale: f64,
    legend_page: usize,
    sound: bool,
    board: Slot,
    ticking: bool,
}

fn map_rand() -> f64 {
    let m = &mut st().smap;
    if m.seed == 0 {
        m.seed = (host::now() as u64 & 0xFFFF_FFFF) as u32 | 1;
    }
    let mut r = Rng(m.seed);
    let v = r.next();
    m.seed = r.0;
    v
}

fn player_radius(m: &SciMap, mass: f64) -> f64 {
    let biggest = m.bubbles.iter().map(|b| b.mass).fold(0.0, f64::max);
    let knee: f64 = 60.0;
    let cap = if biggest > 0.0 { (knee + 1.0).max(biggest * 2.0) } else { 150.0 };
    let mass = mass.max(0.0);
    if mass <= knee.min(cap) {
        return mass.min(cap);
    }
    let span = cap - knee;
    knee + span * (1.0 - 1.0 / sqrt_f(1.0 + (mass - knee) / span))
}

fn map_load() {
    let s = st();
    if s.smap.scale == 0.0 {
        s.smap.scale = 1.0;
        s.smap.labels = true;
        s.smap.mesh = true;
        s.smap.sound = host::store_get("piii:map:sound").as_deref() == Some("1");
    }
    if s.smap.mode == MMode::Idle && !s.smap.loading {
        map_fetch();
    }
    if s.smap.board.needed() {
        s.smap.board.busy = true;
        request(Want::Tool(Tool::Map, 1), "GET", "/api/arcade/leaderboard?limit=15", "", 0);
    }
}

fn map_fetch() {
    let s = st();
    s.smap.loading = true;
    s.smap.err = None;
    let u = format!("/api/arcade/start?{}", ident_query(s));
    request(Want::Tool(Tool::Map, 0), "GET", &u, "", 0);
}

/// The field arrived: lay it out, one region per discipline.
fn map_field(v: Value) {
    let m = &mut st().smap;
    m.loading = false;
    m.bubbles = v
        .get("field")
        .arr()
        .iter()
        .map(|b| MBubble {
            id: b.get("id").f() as i64,
            mass: b.get("mass").f(),
            domain: b.get("domain").text(),
            parent: b.get("parent").text(),
            papers: b.get("papers").f(),
            live: b.get("live").truthy(),
            x: b.get("x").f() * WORLD_W,
            y: b.get("y").f() * WORLD_H,
            vx: 0.0,
            vy: 0.0,
            eaten: false,
            dimmed: false,
        })
        .collect();
    m.data = Some(v);
    m.absorbed.clear();
    m.selected = None;
    m.over = None;
    m.submitting = false;
    arrange();
    build_edges();
    apply_filters();
}

fn arrange() {
    let m = &mut st().smap;
    let n_b = m.bubbles.len();
    if n_b == 0 {
        return;
    }
    let mut keys: Vec<String> = Vec::new();
    for b in &m.bubbles {
        let k = if b.parent.is_empty() { b.domain.clone() } else { b.parent.clone() };
        if !keys.contains(&k) {
            keys.push(k);
        }
    }
    let weight = |k: &String, m: &SciMap| -> f64 { m.bubbles.iter().filter(|b| &(if b.parent.is_empty() { b.domain.clone() } else { b.parent.clone() }) == k).map(|b| b.mass * b.mass).sum() };
    keys.sort_by(|a, b| weight(b, m).partial_cmp(&weight(a, m)).unwrap_or(core::cmp::Ordering::Equal));
    let n = keys.len();
    let need: Vec<f64> = keys
        .iter()
        .map(|k| {
            let s: f64 = m.bubbles.iter().filter(|b| &(if b.parent.is_empty() { b.domain.clone() } else { b.parent.clone() }) == k).map(|b| (b.mass * 1.25 + 8.0) * (b.mass * 1.25 + 8.0)).sum();
            sqrt_f(s) * 1.2 + 24.0
        })
        .collect();
    let aspect = if m.view.0 > 50.0 && m.view.1 > 50.0 { m.view.0 / m.view.1 } else { WORLD_W / WORLD_H };
    let cols = (round_f(sqrt_f(n as f64 * aspect)) as usize).clamp(1, n);
    let rows = n.div_ceil(cols);
    let mut cell = need.iter().cloned().fold(0.0, f64::max) * 2.0 + 80.0;
    cell = cell.min((WORLD_W - 40.0) / cols as f64).min((WORLD_H - 40.0) / rows as f64);
    let ox = (WORLD_W - cols as f64 * cell) / 2.0;
    let oy = (WORLD_H - rows as f64 * cell) / 2.0;
    m.regions.clear();
    for (i, k) in keys.iter().enumerate() {
        let r = i / cols;
        let in_row = cols.min(n - r * cols);
        let c = (i % cols) as f64 + (cols - in_row) as f64 / 2.0;
        let cx = ox + (c + 0.5) * cell;
        let cy = oy + (r as f64 + 0.5) * cell + 18.0;
        m.regions.push((k.clone(), cx, cy));
        let mut members: Vec<usize> = (0..n_b).filter(|&j| &(if m.bubbles[j].parent.is_empty() { m.bubbles[j].domain.clone() } else { m.bubbles[j].parent.clone() }) == k).collect();
        members.sort_by(|a, b| m.bubbles[*b].mass.partial_cmp(&m.bubbles[*a].mass).unwrap_or(core::cmp::Ordering::Equal));
        for (j, &bi) in members.iter().enumerate() {
            let ang = j as f64 * 2.39996;
            let rad = sqrt_f(j as f64) * 70.0;
            m.bubbles[bi].x = cx + cos_f(ang) * rad;
            m.bubbles[bi].y = cy + sin_f(ang) * rad;
        }
    }
    let region_of: Vec<usize> = m
        .bubbles
        .iter()
        .map(|b| {
            let k = if b.parent.is_empty() { b.domain.clone() } else { b.parent.clone() };
            m.regions.iter().position(|r| r.0 == k).unwrap_or(0)
        })
        .collect();
    for _ in 0..220 {
        for i in 0..n_b {
            for j in i + 1..n_b {
                let (dx, dy) = (m.bubbles[j].x - m.bubbles[i].x, m.bubbles[j].y - m.bubbles[i].y);
                let d = sqrt_f(dx * dx + dy * dy).max(0.01);
                let min = (m.bubbles[i].mass + m.bubbles[j].mass) * 1.18 + 6.0;
                if d >= min {
                    continue;
                }
                let push = (min - d) / 2.0 / d;
                m.bubbles[i].x -= dx * push;
                m.bubbles[i].y -= dy * push;
                m.bubbles[j].x += dx * push;
                m.bubbles[j].y += dy * push;
            }
        }
        for i in 0..n_b {
            let (_, cx, cy) = m.regions[region_of[i]];
            let b = &mut m.bubbles[i];
            b.x += (cx - b.x) * 0.012;
            b.y += (cy - b.y) * 0.012;
            b.x = b.x.clamp(b.mass + 10.0, WORLD_W - b.mass - 10.0);
            b.y = b.y.clamp(b.mass + 10.0, WORLD_H - b.mass - 10.0);
        }
    }
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for b in &m.bubbles {
        x0 = x0.min(b.x - b.mass);
        x1 = x1.max(b.x + b.mass);
        y0 = y0.min(b.y - b.mass - 80.0);
        y1 = y1.max(b.y + b.mass);
    }
    m.bounds = (x0 - 30.0, y0 - 10.0, x1 + 30.0, y1 + 30.0);
}

fn build_edges() {
    let m = &mut st().smap;
    m.edges.clear();
    let n = m.bubbles.len();
    for a in 0..n {
        let mut near: Vec<(usize, f64)> = (0..n)
            .filter(|&b| b != a && m.bubbles[b].domain == m.bubbles[a].domain)
            .map(|b| (b, sqrt_f((m.bubbles[a].x - m.bubbles[b].x).powi_c(2) + (m.bubbles[a].y - m.bubbles[b].y).powi_c(2))))
            .collect();
        near.sort_by(|p, q| p.1.partial_cmp(&q.1).unwrap_or(core::cmp::Ordering::Equal));
        for (b, _) in near.into_iter().take(2) {
            let key = (a.min(b), a.max(b));
            if !m.edges.contains(&key) {
                m.edges.push(key);
            }
        }
    }
}

trait PowiC {
    fn powi_c(self, n: i32) -> f64;
}
impl PowiC for f64 {
    fn powi_c(self, n: i32) -> f64 {
        let mut r = 1.0;
        for _ in 0..n {
            r *= self;
        }
        r
    }
}

fn apply_filters() {
    let m = &mut st().smap;
    let needle = m.search.trim().to_lowercase();
    for b in m.bubbles.iter_mut() {
        let ok = (needle.is_empty() || b.domain.to_lowercase().contains(&needle)) && b.papers >= m.min_papers && (!m.live_only || b.live);
        b.dimmed = !ok;
    }
    m.legend_page = 0;
}

fn fit_zoom(m: &SciMap) -> f64 {
    let (w, h) = m.view;
    if w <= 0.0 || h <= 0.0 {
        return 0.34;
    }
    let (bw, bh) = if m.mode != MMode::Play && m.bounds.2 > m.bounds.0 { (m.bounds.2 - m.bounds.0, m.bounds.3 - m.bounds.1) } else { (WORLD_W, WORLD_H) };
    ((w / bw).min((h - 52.0) / bh) * 0.96).clamp(0.12, 2.2)
}

fn map_explore() {
    let m = &mut st().smap;
    if m.view.0 <= 0.0 {
        let (vw, vh) = (host::vw(), host::vh());
        m.view = (if vw < 900.0 { (vw - 40.0).max(300.0) } else { (vw - 560.0).max(320.0) }, (vh * 0.68).clamp(360.0, 620.0));
    }
    m.mode = MMode::Explore;
    m.player = None;
    m.over = None;
    let z = fit_zoom(m);
    m.cam = ((m.bounds.0 + m.bounds.2) / 2.0, (m.bounds.1 + m.bounds.3) / 2.0 - 26.0 / z.max(0.05), z);
    map_tick_on();
}

fn map_play() {
    let m = &mut st().smap;
    m.mode = MMode::Play;
    m.pending_play();
    map_fetch();
}

impl SciMap {
    fn pending_play(&mut self) {
        self.player = Some((0.0, 0.0, -1.0));
    }
}

fn map_start_run() {
    // the field arrived for a run: π somewhere safe, the clock starts
    let start_mass = st().smap.data.as_ref().map(|d| d.get("rules").get("start_mass").f()).unwrap_or(18.0);
    let mut best = (WORLD_W / 2.0, WORLD_H / 2.0, -1.0);
    for _ in 0..40 {
        let x = WORLD_W * (0.15 + map_rand() * 0.7);
        let y = WORLD_H * (0.15 + map_rand() * 0.7);
        let near = st().smap.bubbles.iter().filter(|b| b.mass > start_mass).map(|b| sqrt_f((b.x - x).powi_c(2) + (b.y - y).powi_c(2))).fold(f64::INFINITY, f64::min);
        if near > best.2 {
            best = (x, y, near);
        }
    }
    let m = &mut st().smap;
    m.player = Some((best.0, best.1, start_mass));
    m.cam = (best.0, best.1, 1.0);
    m.pointer = None;
    m.started = host::now();
    m.last_frame = m.started;
    m.last_eat = -MIN_EAT_MS;
    m.powerups.clear();
    m.power = None;
    m.next_power = 0.0;
    m.absorbed.clear();
    m.over = None;
    m.submitting = false;
    m.message = (String::new(), "");
    map_tick_on();
}

fn map_tick_on() {
    let m = &mut st().smap;
    if !m.ticking {
        m.ticking = true;
        m.last_frame = host::now();
        host::timer(16, T_MAP);
    }
}

fn tone(f1: f64, f2: f64, ms: f64, kind: &str, gain: f64) {
    if st().smap.sound {
        host::call("tone", &format!("{}\t{}\t{}\t{}\t{}", f1, f2, ms, kind, gain));
    }
}

/// One frame: the bubbles move, π moves, eats, collects power-ups; the camera follows.
fn map_frame() {
    let s = st();
    s.smap.ticking = false;
    let on_map = matches!(s.page, Page::Item(_, _)) && st().t2_on_map();
    if !on_map || s.smap.mode == MMode::Idle || s.smap.over.is_some() {
        return;
    }
    let now = host::now();
    let m = &mut st().smap;
    let dt = ((now - m.last_frame) / 1000.0).clamp(0.0, 0.05);
    m.last_frame = now;
    m.pop = (m.pop - 0.045).max(0.0);
    if m.mode == MMode::Play {
        if let Some((px, py, mass)) = m.player {
            if mass > 0.0 {
                play_step(dt, px, py, mass);
            }
        }
    }
    map_tick_on();
    render();
}

impl State {
    fn t2_on_map(&self) -> bool {
        match self.page {
            Page::Item(g, mm) => matches!(GROUPS.get(g as usize).and_then(|x| x.members.get(mm as usize)), Some((_, Target::Tool(Tool::Map)))),
            _ => false,
        }
    }
}

fn play_step(dt: f64, mut px: f64, mut py: f64, mut mass: f64) {
    let rules = st().smap.data.as_ref().map(|d| (d.get("rules").get("start_mass").f(), d.get("rules").get("absorb_ratio").f())).unwrap_or((18.0, 0.28));
    let now_ms = host::now() - st().smap.started;
    // power-ups: appear on a random interval, are picked up by touch, wear off
    {
        if st().smap.next_power == 0.0 {
            let r = map_rand();
            st().smap.next_power = now_ms + 9000.0 + r * 7000.0;
        }
        if now_ms >= st().smap.next_power && st().smap.powerups.len() < 3 {
            let k = (map_rand() * 4.0) as usize % 4;
            let (x, y) = (WORLD_W * (0.08 + map_rand() * 0.84), WORLD_H * (0.08 + map_rand() * 0.84));
            let r = map_rand();
            let m = &mut st().smap;
            m.powerups.push((k, x, y, now_ms + 18000.0));
            m.next_power = now_ms + 9000.0 + r * 7000.0;
        }
        let pr = player_radius(&st().smap, mass);
        let m = &mut st().smap;
        let mut got = None;
        m.powerups.retain(|q| {
            if now_ms >= q.3 {
                return false;
            }
            if sqrt_f((q.1 - px).powi_c(2) + (q.2 - py).powi_c(2)) < pr + 26.0 {
                got = Some(q.0);
                return false;
            }
            true
        });
        if let Some(k) = got {
            m.power = Some(k);
            m.power_until = now_ms + POWERS[k].3;
            m.message = (format!("{} {} — {}.", POWERS[k].2, POWERS[k].1, POWERS[k].5), "good");
            tone(660.0, 1320.0, 220.0, "square", 0.045);
        }
        if m.power.is_some() && now_ms >= m.power_until {
            m.power = None;
            m.message = (String::new(), "");
        }
    }
    let power = st().smap.power.map(|k| POWERS[k].0);
    // gravity: bigger fields pull smaller ones, π pulls what it can eat, nothing overlaps
    {
        let pr = player_radius(&st().smap, mass);
        let m = &mut st().smap;
        let n = m.bubbles.len();
        let (g, soft, max_sp) = (480.0, 900.0, 5.5);
        for i in 0..n {
            if m.bubbles[i].eaten {
                continue;
            }
            for j in i + 1..n {
                if m.bubbles[j].eaten {
                    continue;
                }
                let (a, b) = (&m.bubbles[i], &m.bubbles[j]);
                let (dx, dy) = (b.x - a.x, b.y - a.y);
                let d2 = dx * dx + dy * dy + soft;
                let d = sqrt_f(d2);
                let (small, big) = if a.mass <= b.mass { (i, j) } else { (j, i) };
                let pull = g * m.bubbles[big].mass / d2 * dt;
                let (sx, sy) = ((m.bubbles[big].x - m.bubbles[small].x) / d, (m.bubbles[big].y - m.bubbles[small].y) / d);
                m.bubbles[small].vx += sx * pull;
                m.bubbles[small].vy += sy * pull;
                let dd = sqrt_f(dx * dx + dy * dy).max(1.0);
                let min = (m.bubbles[i].mass + m.bubbles[j].mass) * 1.02;
                if dd < min {
                    let push = (min - dd) / dd * 14.0 * dt;
                    m.bubbles[i].vx -= dx * push;
                    m.bubbles[i].vy -= dy * push;
                    m.bubbles[j].vx += dx * push;
                    m.bubbles[j].vy += dy * push;
                }
            }
        }
        let pgrav = pr * if power == Some("magnet") { 6.0 } else { 1.0 };
        for b in m.bubbles.iter_mut() {
            if b.eaten {
                continue;
            }
            if b.mass < mass {
                let (dx, dy) = (px - b.x, py - b.y);
                let d2 = dx * dx + dy * dy + soft;
                let d = sqrt_f(d2);
                let pull = g * pgrav / d2 * dt;
                b.vx += dx / d * pull;
                b.vy += dy / d * pull;
            }
            b.vx *= 0.985;
            b.vy *= 0.985;
            let sp = sqrt_f(b.vx * b.vx + b.vy * b.vy);
            if sp > max_sp {
                b.vx = b.vx / sp * max_sp;
                b.vy = b.vy / sp * max_sp;
            }
            b.x += b.vx * dt * 60.0;
            b.y += b.vy * dt * 60.0;
            if b.x < b.mass {
                b.x = b.mass;
                b.vx = b.vx.abs();
            } else if b.x > WORLD_W - b.mass {
                b.x = WORLD_W - b.mass;
                b.vx = -b.vx.abs();
            }
            if b.y < b.mass {
                b.y = b.mass;
                b.vy = b.vy.abs();
            } else if b.y > WORLD_H - b.mass {
                b.y = WORLD_H - b.mass;
                b.vy = -b.vy.abs();
            }
        }
    }
    // π moves towards the pointer, or with WASD and the arrows
    {
        let m = &st().smap;
        let ratio = (mass / if rules.0 > 0.0 { rules.0 } else { 40.0 }).max(1.0);
        let mut speed = (420.0 * 0.42f64).max(420.0 / powf(ratio, 0.28));
        if power == Some("haste") {
            speed *= 1.7;
        }
        let (mut dx, mut dy) = (0.0, 0.0);
        if let Some((sx, sy)) = m.pointer {
            let (wx, wy) = screen_to_world(m, sx, sy);
            dx = wx - px;
            dy = wy - py;
        }
        let has = |k: &[&str]| m.keys.iter().any(|x| k.contains(&x.as_str()));
        if has(&["ArrowLeft", "a", "A"]) {
            dx -= 100.0;
        }
        if has(&["ArrowRight", "d", "D"]) {
            dx += 100.0;
        }
        if has(&["ArrowUp", "w", "W"]) {
            dy -= 100.0;
        }
        if has(&["ArrowDown", "s", "S"]) {
            dy += 100.0;
        }
        let dist = sqrt_f(dx * dx + dy * dy);
        if dist > 1.0 {
            let ease = 60f64.max(player_radius(m, mass) * 0.8);
            let throttle = (dist / ease).min(1.0);
            px += dx / dist * speed * throttle * dt;
            py += dy / dist * speed * throttle * dt;
        }
        let margin = (player_radius(m, mass) * 0.25).min(30.0);
        px = px.clamp(margin, WORLD_W - margin);
        py = py.clamp(margin, WORLD_H - margin);
    }
    // contact: the biggest edible field in reach is taken (one every 90 ms); a bigger one ends the run
    let pr = player_radius(&st().smap, mass);
    let mut contact: Option<usize> = None;
    let mut dead = false;
    {
        let m = &mut st().smap;
        let edible = if power == Some("appetite") { mass * 1.35 } else { mass };
        let n = m.bubbles.len();
        for i in 0..n {
            let b = &m.bubbles[i];
            if b.eaten {
                continue;
            }
            let d = sqrt_f((b.x - px).powi_c(2) + (b.y - py).powi_c(2));
            if d < b.mass.max(pr) * 0.86 {
                if b.mass >= edible {
                    if m.power.map(|k| POWERS[k].0) == Some("shield") {
                        m.power = None;
                        m.message = ("🛡️ Shield absorbed the hit.".to_string(), "good");
                        let away = atan2_f(py - b.y, px - b.x);
                        px += cos_f(away) * (b.mass + pr) * 0.6;
                        py += sin_f(away) * (b.mass + pr) * 0.6;
                        continue;
                    }
                    dead = true;
                    break;
                }
                if contact.map(|c| b.mass > m.bubbles[c].mass).unwrap_or(true) {
                    contact = Some(i);
                }
            }
        }
    }
    if dead {
        tone(220.0, 60.0, 420.0, "sawtooth", 0.07);
        st().smap.player = Some((px, py, mass));
        map_end(false);
        return;
    }
    if let Some(c) = contact {
        let m = &mut st().smap;
        if now_ms >= m.last_eat + MIN_EAT_MS {
            m.bubbles[c].eaten = true;
            mass += m.bubbles[c].mass * rules.1;
            m.last_eat = now_ms;
            m.absorbed.push((m.bubbles[c].id, round_f(now_ms) as i64));
            m.pop = (m.pop + 0.5 + (m.bubbles[c].mass / mass).min(0.5)).min(1.0);
            let base = 420.0 + (mass * 1.4).min(260.0);
            tone(base, base * 1.5, 90.0, "triangle", 0.05);
            map_select(Some(c));
        }
    }
    let m = &mut st().smap;
    m.player = Some((px, py, mass));
    if !m.bubbles.iter().any(|b| !b.eaten) {
        for (i, f) in [523.0, 659.0, 784.0, 1047.0].iter().enumerate() {
            let _ = i;
            tone(*f, *f, 160.0, "triangle", 0.05);
        }
        map_end(true);
        return;
    }
    let m = &mut st().smap;
    let target = (46.0 / mass).clamp(0.34, 1.15);
    m.cam.2 += (target - m.cam.2) * (dt * 2.4).min(1.0);
    m.cam.0 += (px - m.cam.0) * (dt * 6.0).min(1.0);
    m.cam.1 += (py - m.cam.1) * (dt * 6.0).min(1.0);
}

fn map_end(won: bool) {
    let m = &mut st().smap;
    if m.over.is_some() {
        return;
    }
    m.over = Some((won, None));
    m.submitting = true;
    let dur = round_f(host::now() - m.started) as i64;
    let token = m.data.as_ref().map(|d| d.get("token").text()).unwrap_or_default();
    let absorbed: Vec<String> = m.absorbed.iter().map(|(id, t)| format!("{{\"id\":{},\"t\":{}}}", id, t)).collect();
    let s = st();
    let body = format!(
        "{{\"token\":{},\"duration_ms\":{},\"absorbed\":[{}],\"wallet\":{},\"orcid\":{}}}",
        json::quote(&token),
        dur.max(1),
        absorbed.join(","),
        json::quote(&s.wallet),
        json::quote(&s.orcid)
    );
    s.smap.message = (if won { "Verifying your run…" } else { "Recording your run…" }.to_string(), "info");
    request(Want::Tool(Tool::Map, 2), "POST", "/api/arcade/finish", &body, 0);
}

fn screen_to_world(m: &SciMap, sx: f64, sy: f64) -> (f64, f64) {
    let z = m.cam.2.max(0.01);
    ((sx - m.view.0 / 2.0) / z + m.cam.0, (sy - m.view.1 / 2.0) / z + m.cam.1)
}

fn map_select(i: Option<usize>) {
    let s = st();
    s.smap.selected = i;
    let name = i.and_then(|i| s.smap.bubbles.get(i)).map(|b| b.domain.clone()).unwrap_or_default();
    if name.is_empty() || name == "Unassigned" {
        s.smap.papers.reset();
        s.smap.papers_for.clear();
        return;
    }
    if s.smap.papers_for != name {
        s.smap.papers_for = name.clone();
        s.smap.papers.reset();
        s.smap.papers.busy = true;
        request(Want::Tool(Tool::Map, 3), "GET", &format!("/api/arcade/field-papers?field={}", url_encode(&name)), "", 0);
    }
}

fn map_apply(w: u8, v: Value, err: Option<String>) {
    let s = st();
    match w {
        0 => {
            s.smap.loading = false;
            match err {
                Some(e) => s.smap.err = Some(format!("Could not load the map: {}", e)),
                None => {
                    let play = s.smap.mode == MMode::Play;
                    map_field(v);
                    if play {
                        map_start_run();
                    } else {
                        map_explore();
                    }
                }
            }
        }
        1 => put(&mut s.smap.board, v, err),
        2 => {
            s.smap.submitting = false;
            let won = s.smap.over.as_ref().map(|o| o.0).unwrap_or(false);
            s.smap.message = match &err {
                Some(e) => (format!("Run finished but could not be submitted: {}", e), "bad"),
                None if !v.get("valid").truthy() => (format!("Run rejected: {}.", v.get("reason").text()), "bad"),
                None => (v.get("message").text(), if v.get("piq_awarded").f() > 0.0 { "good" } else { "info" }),
            };
            s.smap.over = Some((won, if err.is_none() { Some(v) } else { None }));
            s.smap.board.reset();
            s.smap.board.busy = true;
            request(Want::Tool(Tool::Map, 1), "GET", "/api/arcade/leaderboard?limit=15", "", 0);
        }
        3 => put(&mut s.smap.papers, v, err),
        _ => {}
    }
}

// actions
fn map_update(a: u16, v: String) {
    let s = st();
    let nums: Vec<f64> = v.split(',').filter_map(|x| x.trim().parse().ok()).collect();
    match a {
        1 => map_play(),
        2 => {
            // exit a run: nothing is recorded; a fresh map
            s.smap.mode = MMode::Explore;
            s.smap.player = None;
            s.smap.over = None;
            s.smap.message = ("Run abandoned — nothing was recorded.".to_string(), "info");
            map_fetch();
        }
        3 => {
            s.smap.mode = MMode::Explore;
            map_fetch();
        }
        4 => {
            s.smap.sound = !s.smap.sound;
            host::store_set("piii:map:sound", if s.smap.sound { "1" } else { "0" });
        }
        // the pointer, on the map: x, y, width, height of the map
        10 | 11 | 12 => {
            if nums.len() >= 4 {
                s.smap.view = (nums[2], nums[3]);
            }
            let (x, y) = (nums.first().copied().unwrap_or(0.0), nums.get(1).copied().unwrap_or(0.0));
            let m = &mut s.smap;
            match a {
                10 => {
                    if m.mode == MMode::Play {
                        m.pointer = Some((x, y));
                    } else {
                        m.drag = Some((x, y, m.cam.0, m.cam.1, false));
                    }
                }
                11 => {
                    if m.mode == MMode::Play {
                        m.pointer = Some((x, y));
                    } else if let Some((sx, sy, cx, cy, moved)) = m.drag {
                        let moved = moved || (x - sx).abs() + (y - sy).abs() > 4.0;
                        let z = m.cam.2.max(0.01);
                        m.cam.0 = cx - (x - sx) / z;
                        m.cam.1 = cy - (y - sy) / z;
                        m.drag = Some((sx, sy, cx, cy, moved));
                    }
                }
                _ => {
                    if let Some((_, _, _, _, moved)) = m.drag.take() {
                        if !moved && m.mode == MMode::Explore {
                            let (wx, wy) = screen_to_world(m, x, y);
                            let hit = m
                                .bubbles
                                .iter()
                                .enumerate()
                                .filter(|(_, b)| !b.eaten && sqrt_f((b.x - wx).powi_c(2) + (b.y - wy).powi_c(2)) <= b.mass * m.scale.max(0.5))
                                .min_by(|a, b| a.1.mass.partial_cmp(&b.1.mass).unwrap_or(core::cmp::Ordering::Equal))
                                .map(|(i, _)| i);
                            map_select(hit);
                        }
                    }
                }
            }
        }
        // the wheel: dy, x, y, width, height
        13 => {
            if nums.len() >= 5 && st().smap.mode == MMode::Explore {
                let m = &mut st().smap;
                m.view = (nums[3], nums[4]);
                let (wx, wy) = screen_to_world(m, nums[1], nums[2]);
                let k = if nums[0] > 0.0 { 1.0 / 1.12 } else { 1.12 };
                m.cam.2 = (m.cam.2 * k).clamp(0.08, 3.0);
                let (wx2, wy2) = screen_to_world(m, nums[1], nums[2]);
                m.cam.0 += wx - wx2;
                m.cam.1 += wy - wy2;
            }
        }
        20 => {
            s.smap.search = v;
            apply_filters();
        }
        21 => {
            s.smap.min_papers = v.parse().unwrap_or(0.0);
            apply_filters();
        }
        22 => {
            s.smap.live_only = v == "1";
            apply_filters();
        }
        23 => s.smap.labels = v == "1",
        24 => s.smap.mesh = v == "1",
        25 => s.smap.scale = v.parse().unwrap_or(1.0),
        26 => {
            s.smap.search.clear();
            s.smap.min_papers = 0.0;
            s.smap.live_only = false;
            apply_filters();
        }
        27 => s.smap.legend_page = v.parse().unwrap_or(0),
        28 => {
            // focus a field from the legend
            let m = &mut s.smap;
            if let Some(i) = m.bubbles.iter().enumerate().filter(|(_, b)| !b.eaten && b.domain == v).max_by(|a, b| a.1.mass.partial_cmp(&b.1.mass).unwrap_or(core::cmp::Ordering::Equal)).map(|(i, _)| i) {
                m.cam.0 = m.bubbles[i].x;
                m.cam.1 = m.bubbles[i].y;
                m.cam.2 = m.cam.2.max(0.7);
                map_select(Some(i));
            }
        }
        29 => {
            // back to the map from the result
            s.smap.over = None;
            s.smap.mode = MMode::Explore;
            map_fetch();
        }
        _ => {}
    }
}

/// Keys while the map is open: WASD and the arrows steer π, Esc leaves a run.
fn map_key(k: &str) -> bool {
    let s = st();
    if !s.t2_on_map() || s.smap.mode != MMode::Play {
        return false;
    }
    if let Some(key) = k.strip_prefix('+') {
        if key == "Escape" {
            map_update(2, String::new());
        } else if !s.smap.keys.iter().any(|x| x == key) {
            s.smap.keys.push(key.to_string());
        }
        return true;
    }
    if let Some(key) = k.strip_prefix('-') {
        s.smap.keys.retain(|x| x != key);
        return true;
    }
    false
}

// ---------------------------------------------------------------------------------------------- the view

fn map_view(s: &State) -> N {
    let m = &s.smap;
    if let Some(e) = &m.err {
        return el("div").kid(failure(e)).kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Map, 3, String::new())).text("Try again")).into();
    }
    let corpus = m.data.as_ref().map(|d| d.get("corpus").clone()).unwrap_or(Value::Null);
    let summary: N = if m.data.is_none() {
        el("p").cls("lede").text("Loading the map…").into()
    } else if corpus.get("is_empty").truthy() {
        el("p").cls("lede").kid(el("b").text("No papers assessed yet. ")).kid(txt("The map has no fields to show, so the bubbles are unlabelled. Assess a manuscript and its field appears here.")).into()
    } else if corpus.get("classified_papers").f() == 0.0 {
        el("p").cls("lede").text(format!("{} papers assessed, but none could be classified into a field yet.", num(corpus.get("total_papers").f(), 0))).into()
    } else {
        el("p")
            .cls("lede")
            .text(format!(
                "{} assessed papers, {} placed across {} live fields. Solid bubbles are our corpus; faint ones are unexplored territory. Select a field to list its papers.",
                num(corpus.get("total_papers").f(), 0),
                num(corpus.get("classified_papers").f(), 0),
                num(corpus.get("fields_with_papers").f(), 0)
            ))
            .into()
    };
    let playing = m.mode == MMode::Play;
    let toolbar = el("div")
        .cls("am-toolbar")
        .kid(el("span").cls("am-hint").text(if playing {
            "Absorb every field on the map to win. Bigger bubbles pull harder — and so do you. Esc exits."
        } else {
            "Drag to pan, scroll to zoom, click a field for detail."
        }))
        .kid_if(playing, || el("button").attr("type", "button").cls("btn small").attr("aria-pressed", if m.sound { "true" } else { "false" }).on("click", Msg::T(Tool::Map, 4, String::new())).text(if m.sound { "Sound on" } else { "Sound off" }).into())
        .kid_if(!playing, || el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Map, 3, String::new())).text("Reload").into())
        .kid(if playing {
            el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Map, 2, String::new())).text("Exit ✕")
        } else {
            el("button").attr("type", "button").cls("btn small primary").on("click", Msg::T(Tool::Map, 1, String::new())).text("Play ▶")
        });
    let stage = el("div")
        .cls("am-stage")
        .on("mdown", Msg::TV(Tool::Map, 10))
        .on("mmove", Msg::TV(Tool::Map, 11))
        .on("mup", Msg::TV(Tool::Map, 12))
        .on("mwheel", Msg::TV(Tool::Map, 13))
        .kid(map_svg(m))
        .kid(toolbar)
        .kid_if(playing && m.player.map(|p| p.2 > 0.0).unwrap_or(false), || hud(m))
        .kid_if(m.over.is_some(), || overlay(m))
        .kid_if(!m.message.0.is_empty(), || el("p").cls("am-msg").cls(m.message.1).text(m.message.0.clone()).into());
    el("div")
        .cls("tool amap")
        .kid(summary)
        .kid(el("div").cls("am-layout").kid(el("div").cls("am-main").kid(stage).kid(field_papers(m))).kid(side(s)))
        .into()
}

fn map_svg(m: &SciMap) -> N {
    let (w, h) = (if m.view.0 > 0.0 { m.view.0 } else { 900.0 }, if m.view.1 > 0.0 { m.view.1 } else { 560.0 });
    let z = m.cam.2.max(0.01);
    let tf = format!("translate({:.2} {:.2}) scale({:.4}) translate({:.2} {:.2})", w / 2.0, h / 2.0, z, -m.cam.0, -m.cam.1);
    let playing = m.mode == MMode::Play;
    let mass = m.player.map(|p| p.2).unwrap_or(0.0);
    let mut g = el("svg:g").attr("transform", tf);
    if !playing && m.labels {
        for (name, cx, _) in &m.regions {
            let top = m.bubbles.iter().filter(|b| (if b.parent.is_empty() { &b.domain } else { &b.parent }) == name).map(|b| b.y - b.mass).fold(f64::INFINITY, f64::min);
            if top.is_finite() && !name.is_empty() {
                g = g.kid(el("svg:text").cls("am-region").attr("x", format!("{:.1}", cx)).attr("y", format!("{:.1}", top - 24.0)).attr("text-anchor", "middle").attr("font-size", format!("{:.1}", (15.0 / z).min(60.0))).text(name.clone()));
            }
        }
    }
    if m.mesh && !playing {
        for (a, b) in &m.edges {
            let (ba, bb) = (&m.bubbles[*a], &m.bubbles[*b]);
            if ba.eaten || bb.eaten || sqrt_f((ba.x - bb.x).powi_c(2) + (ba.y - bb.y).powi_c(2)) > 520.0 {
                continue;
            }
            let faded = ba.dimmed || bb.dimmed;
            g = g.kid(
                el("svg:line")
                    .attr("x1", format!("{:.1}", ba.x))
                    .attr("y1", format!("{:.1}", ba.y))
                    .attr("x2", format!("{:.1}", bb.x))
                    .attr("y2", format!("{:.1}", bb.y))
                    .attr("stroke", if faded { "rgba(25,25,25,0.04)" } else { color_for(if ba.parent.is_empty() { &ba.domain } else { &ba.parent }) })
                    .attr("stroke-opacity", if faded { "1" } else { "0.28" })
                    .attr("vector-effect", "non-scaling-stroke"),
            );
        }
    }
    let look = if playing { 1.0 } else { m.scale };
    for (i, b) in m.bubbles.iter().enumerate() {
        if b.eaten {
            continue;
        }
        let color = color_for(if b.parent.is_empty() { &b.domain } else { &b.parent });
        let r = b.mass * look;
        let edible = !playing || b.mass < mass;
        let dim = b.dimmed && !playing;
        let mut c = el("svg:circle")
            .cls("am-b")
            .attr("cx", format!("{:.1}", b.x))
            .attr("cy", format!("{:.1}", b.y))
            .attr("r", format!("{:.1}", r))
            .attr("fill", color)
            .attr("fill-opacity", if dim { "0.03" } else if b.live { if edible { "0.16" } else { "0.09" } } else { "0.05" })
            .attr("stroke", if playing && !edible { "#c0645c" } else { color })
            .attr("stroke-opacity", if dim { "0.12" } else if b.live { "0.9" } else { "0.4" })
            .attr("stroke-width", if b.live { "1.4" } else { "1" })
            .attr("vector-effect", "non-scaling-stroke");
        if playing && !edible {
            c = c.attr("stroke-dasharray", "4 3");
        }
        g = g.kid(c);
        if m.selected == Some(i) {
            g = g.kid(el("svg:circle").attr("cx", format!("{:.1}", b.x)).attr("cy", format!("{:.1}", b.y)).attr("r", format!("{:.1}", r + 4.0 / z)).attr("fill", "none").attr("stroke", "#2f40e8").attr("stroke-width", "2").attr("vector-effect", "non-scaling-stroke"));
        }
        let same_as_region = !playing && !b.live && (b.parent.is_empty() || b.parent == b.domain);
        if r * z > 20.0 && m.labels && !same_as_region && !dim && b.domain != "Unassigned" {
            let fs = (15.0 / z).min(r / 2.8);
            g = g.kid(
                el("svg:text")
                    .cls("am-label")
                    .cls_if(!b.live, "faint")
                    .attr("x", format!("{:.1}", b.x))
                    .attr("y", format!("{:.1}", b.y - if b.live && r * z > 34.0 { 7.0 / z } else { 0.0 }))
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", "middle")
                    .attr("font-size", format!("{:.2}", fs))
                    .text(b.domain.clone()),
            );
            if b.live && r * z > 34.0 {
                g = g.kid(
                    el("svg:text")
                        .cls("am-sub")
                        .attr("x", format!("{:.1}", b.x))
                        .attr("y", format!("{:.1}", b.y + 9.0 / z))
                        .attr("text-anchor", "middle")
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", format!("{:.2}", (12.0 / z).min(r / 4.0)))
                        .text(format!("{} paper{}", num(b.papers, 0), if b.papers == 1.0 { "" } else { "s" })),
                );
            }
        }
    }
    if playing {
        for (k, x, y, _) in &m.powerups {
            let p = &POWERS[*k];
            g = g
                .kid(el("svg:circle").attr("cx", format!("{:.1}", x)).attr("cy", format!("{:.1}", y)).attr("r", "17").attr("fill", p.4).attr("fill-opacity", "0.25").attr("stroke", p.4).attr("stroke-width", "2"))
                .kid(el("svg:text").attr("x", format!("{:.1}", x)).attr("y", format!("{:.1}", y)).attr("text-anchor", "middle").attr("dominant-baseline", "central").attr("font-size", "18").text(p.2));
        }
        if let Some((px, py, mass)) = m.player {
            if mass > 0.0 {
                let r = player_radius(m, mass) * (1.0 + m.pop * 0.22);
                let pcol = m.power.map(|k| POWERS[k].4).unwrap_or("#2f40e8");
                g = g
                    .kid(el("svg:circle").attr("cx", format!("{:.1}", px)).attr("cy", format!("{:.1}", py)).attr("r", format!("{:.1}", r * 1.6)).attr("fill", "#38bdf8").attr("fill-opacity", "0.14"))
                    .kid(el("svg:circle").cls("am-player").attr("cx", format!("{:.1}", px)).attr("cy", format!("{:.1}", py)).attr("r", format!("{:.1}", r)).attr("fill", pcol))
                    .kid(el("svg:text").attr("x", format!("{:.1}", px)).attr("y", format!("{:.1}", py)).attr("text-anchor", "middle").attr("dominant-baseline", "central").attr("fill", "#fff").attr("font-size", format!("{:.1}", r * 1.1)).text("π"));
            }
        }
    }
    let mut svg = el("svg:svg").cls("am-svg").attr("aria-label", "Interactive map of science. Drag to pan, scroll to zoom, click a field for detail.").attr("role", "img").kid(g);
    // the minimap
    let (mw, mh) = (132.0, 132.0 * WORLD_H / WORLD_W);
    let (mx, my) = (w - mw - 12.0, h - mh - 12.0);
    let mut mini = el("svg:g").cls("am-mini").kid(el("svg:rect").attr("x", format!("{:.1}", mx)).attr("y", format!("{:.1}", my)).attr("width", format!("{:.1}", mw)).attr("height", format!("{:.1}", mh)).attr("rx", "8"));
    for b in m.bubbles.iter().filter(|b| !b.eaten) {
        mini = mini.kid(
            el("svg:circle")
                .attr("cx", format!("{:.1}", mx + b.x / WORLD_W * mw))
                .attr("cy", format!("{:.1}", my + b.y / WORLD_H * mh))
                .attr("r", format!("{:.1}", (b.mass / 26.0).max(0.8)))
                .attr("fill", color_for(if b.parent.is_empty() { &b.domain } else { &b.parent }))
                .attr("fill-opacity", if b.live { "0.7" } else { "0.25" }),
        );
    }
    if let Some((px, py, mass)) = m.player {
        if mass > 0.0 {
            mini = mini.kid(el("svg:circle").attr("cx", format!("{:.1}", mx + px / WORLD_W * mw)).attr("cy", format!("{:.1}", my + py / WORLD_H * mh)).attr("r", "3").attr("fill", "#38bdf8"));
        }
    }
    svg = svg.kid(mini);
    svg.into()
}

fn hud(m: &SciMap) -> N {
    let total = m.bubbles.len();
    let left = m.bubbles.iter().filter(|b| !b.eaten).count();
    let mass = m.player.map(|p| p.2).unwrap_or(0.0);
    let pct = if total > 0 { (total - left) as f64 / total as f64 } else { 0.0 };
    let now_ms = host::now() - m.started;
    el("div")
        .cls("am-hud")
        .kid(el("b").text(format!("{} / {} fields absorbed", total - left, total)))
        .kid(el("span").cls("md-bar").kid(el("i").style(format!("width:{:.1}%", (pct * 100.0).max(2.0)))))
        .kid(el("span").cls("hint").text(format!("Mass {} · {} left", round_f(mass) as i64, left)))
        .kid_if(m.power.is_some(), || {
            let k = m.power.unwrap_or(0);
            el("span").cls("am-power").style(format!("color:{}", POWERS[k].4)).text(format!("{} {} {:.0} s", POWERS[k].2, POWERS[k].1, ((m.power_until - now_ms) / 1000.0).max(0.0))).into()
        })
        .into()
}

fn overlay(m: &SciMap) -> N {
    let (won, data) = m.over.as_ref().map(|(w, d)| (*w, d.clone())).unwrap_or((false, None));
    let mass = data.as_ref().map(|d| d.get("final_mass").f()).filter(|x| *x > 0.0).unwrap_or(round_f(m.player.map(|p| p.2).unwrap_or(0.0)));
    let eaten_live = m.bubbles.iter().filter(|b| b.eaten && b.live).count();
    let piq = data.as_ref().map(|d| d.get("piq_awarded").f()).unwrap_or(0.0);
    let mut card = el("div")
        .cls("am-overlay-card")
        .kid(el("h2").text(if won { "Field absorbed" } else { "Consumed" }))
        .kid(el("p").text(format!(
            "Absorbed {} of {} fields{}",
            m.absorbed.len(),
            m.bubbles.len(),
            if eaten_live > 0 { format!(", {} of them carrying real papers.", eaten_live) } else { ".".to_string() }
        )))
        .kid(el("p").text(format!("Final mass {}.", num(mass, 0))));
    if piq > 0.0 {
        card = card.kid(el("p").cls("am-reward").text(format!(
            "+{:.2} piQ credited to your balance{}",
            piq,
            data.as_ref().map(|d| d.get("piq_balance")).filter(|x| !x.is_null()).map(|x| format!(" — you now hold {:.2} piQ.", x.f())).unwrap_or_else(|| ".".to_string())
        )));
    } else if !won {
        card = card.kid(el("p").text("You ran into a larger field. Grow on the small ones first."));
    }
    if m.submitting {
        card = card.kid(el("p").cls("hint").text("Sending the run to be verified…"));
    }
    card = card.kid(
        el("div")
            .cls("row")
            .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Map, 1, String::new())).text("Play again"))
            .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Map, 29, String::new())).text("Back to map")),
    );
    el("div").cls("am-overlay").kid(card).into()
}

fn field_papers(m: &SciMap) -> N {
    if m.papers_for.is_empty() {
        return txt("");
    }
    let name = m.papers_for.clone();
    el("div")
        .cls("card am-papers")
        .kid(slot_view(&m.papers, "Loading papers…", |d| {
            let ps = d.get("papers").arr();
            if ps.is_empty() {
                return el("div")
                    .kid(el("h3").text(name.clone()))
                    .kid(el("p").cls("hint").text("No assessed papers in this field yet — it is unexplored territory on the map. Assess one and it becomes a solid bubble."))
                    .into();
            }
            el("div")
                .kid(el("h3").text(format!("{} · {} paper{}", name, num(d.get("count").f(), 0), if d.get("count").f() == 1.0 { "" } else { "s" })))
                .kid(
                    el("table")
                        .cls("data-table")
                        .kid(el("thead").kid(el("tr").kid(el("th").text("Paper")).kid(el("th").text("piX")).kid(el("th").text("piQ")).kid(el("th").text("Date"))))
                        .kid(el("tbody").kids(ps.iter().map(|p| -> N {
                            el("tr")
                                .kid(el("td").kid(el("a").attr("href", format!("#/paper/{}", p.get("hash").str())).text(p.get("title").text())).kid(el("div").cls("hint").text(p.get("author").text())))
                                .kid(el("td").text(num(p.get("score").f(), 1)))
                                .kid(el("td").text(num(p.get("piq").f(), 2)))
                                .kid(el("td").text(p.get("date").text()))
                                .into()
                        }))),
                )
                .into()
        }))
        .into()
}

fn side(s: &State) -> N {
    let m = &s.smap;
    let shown = m.bubbles.iter().filter(|b| !b.dimmed).count();
    let filters_active = !m.search.trim().is_empty() || m.min_papers > 0.0 || m.live_only;
    let filters = el("details")
        .attr("open", "")
        .cls("am-group")
        .kid(el("summary").kid(txt("Filters ")).kid(el("span").cls("hint").text(if !filters_active { "All fields".to_string() } else { format!("{} of {}", shown, m.bubbles.len()) })))
        .kid(el("label").cls("field").kid(el("span").text("Field or domain")).kid(el("input").attr("type", "text").attr("placeholder", "e.g. Genomics").prop("value", m.search.clone()).on("input", Msg::TV(Tool::Map, 20))))
        .kid(
            el("label")
                .cls("field")
                .kid(el("span").text(format!("Minimum papers {}", m.min_papers as i64)))
                .kid(el("input").attr("type", "range").attr("min", "0").attr("max", "20").attr("step", "1").prop("value", format!("{}", m.min_papers as i64)).on("input", Msg::TV(Tool::Map, 21))),
        )
        .kid(el("label").cls("am-check").kid(el("input").attr("type", "checkbox").prop("checked", if m.live_only { "1" } else { "0" }).on("change", Msg::TV(Tool::Map, 22))).kid(txt(" Our corpus only")))
        .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Map, 26, String::new())).text("Reset filters"));
    let look = el("details")
        .cls("am-group")
        .kid(el("summary").text("Appearance"))
        .kid(el("label").cls("am-check").kid(el("input").attr("type", "checkbox").prop("checked", if m.labels { "1" } else { "0" }).on("change", Msg::TV(Tool::Map, 23))).kid(txt(" Show field labels")))
        .kid(el("label").cls("am-check").kid(el("input").attr("type", "checkbox").prop("checked", if m.mesh { "1" } else { "0" }).on("change", Msg::TV(Tool::Map, 24))).kid(txt(" Show connections")))
        .kid(
            el("label")
                .cls("field")
                .kid(el("span").text(format!("Bubble scale {:.1}×", m.scale)))
                .kid(el("input").attr("type", "range").attr("min", "0.5").attr("max", "2").attr("step", "0.1").prop("value", format!("{}", m.scale)).on("input", Msg::TV(Tool::Map, 25))),
        );
    // the selected field
    let detail: N = match m.selected.and_then(|i| m.bubbles.get(i)) {
        None => el("p").cls("hint").text("Select a field to inspect it.").into(),
        Some(b) => {
            let unnamed = b.domain.is_empty() || b.domain == "Unassigned";
            el("div")
                .kid(el("div").cls("row").kid(el("span").cls("am-swatch").style(format!("background:{}", color_for(if b.parent.is_empty() { &b.domain } else { &b.parent })))).kid(el("b").text(if unnamed { "Unclaimed space".to_string() } else { b.domain.clone() })))
                .kid(
                    el("dl")
                        .cls("kv")
                        .kid_if(!unnamed, || el("dt").text("Assessed papers").into())
                        .kid_if(!unnamed, || el("dd").text(num(b.papers, 0)).into())
                        .kid(el("dt").text("Map weight"))
                        .kid(el("dd").text(num(b.mass, 1)))
                        .kid(el("dt").text("Status"))
                        .kid(el("dd").text(if unnamed { "No field yet" } else if b.live { "In our corpus" } else { "Unexplored" })),
                )
                .kid(el("p").cls("hint").text(if unnamed {
                    "This bubble carries no field, because nothing has been assessed into one yet."
                } else if b.live {
                    "This field is part of our assessed corpus. Its size on the map is driven by how many papers it holds."
                } else {
                    "No assessed papers in this field yet. Assess one and this bubble grows on the map."
                }))
                .into()
        }
    };
    // the legend, a page at a time
    let legend = m.data.as_ref().map(|d| d.get("legend").arr().to_vec()).unwrap_or_default();
    let visible: Vec<&str> = m.bubbles.iter().filter(|b| !b.dimmed).map(|b| b.domain.as_str()).collect();
    let rows: Vec<&Value> = legend.iter().filter(|r| visible.contains(&r.get("field").str()) && r.get("papers").f() > 0.0).collect();
    let per = 6;
    let pages = rows.len().div_ceil(per).max(1);
    let page = m.legend_page.min(pages - 1);
    let legend_view: N = if rows.is_empty() {
        el("p").cls("hint").text("No assessed papers yet — nothing to tabulate. Assess a manuscript and its field appears here with its paper count and mean piX.").into()
    } else {
        el("div")
            .kid(
                el("table")
                    .cls("data-table")
                    .kid(el("thead").kid(el("tr").kid(el("th").text("")).kid(el("th").text("Field")).kid(el("th").text("Papers")).kid(el("th").text("Avg piX"))))
                    .kid(el("tbody").kids(rows.iter().skip(page * per).take(per).map(|r| -> N {
                        let f = r.get("field").text();
                        el("tr")
                            .cls("clickable")
                            .on("click", Msg::T(Tool::Map, 28, f.clone()))
                            .kid(el("td").kid(el("span").cls("am-swatch").style(format!("background:{}", color_for(&f)))))
                            .kid(el("td").text(f))
                            .kid(el("td").text(num(r.get("papers").f(), 0)))
                            .kid(el("td").text(if r.get("avg_score").is_null() { "—".to_string() } else { num(r.get("avg_score").f(), 1) }))
                            .into()
                    }))),
            )
            .kid_if(pages > 1, || {
                el("div")
                    .cls("row")
                    .kid(el("button").attr("type", "button").cls("btn small").attr_if(page == 0, "disabled", "").on("click", Msg::T(Tool::Map, 27, format!("{}", page.saturating_sub(1)))).text("‹"))
                    .kid(el("span").cls("hint").text(format!("Page {} of {} · {} fields", page + 1, pages, rows.len())))
                    .kid(el("button").attr("type", "button").cls("btn small").attr_if(page + 1 >= pages, "disabled", "").on("click", Msg::T(Tool::Map, 27, format!("{}", page + 1))).text("›"))
                    .into()
            })
            .into()
    };
    let prog = m.data.as_ref().map(|d| d.get("progress").clone()).unwrap_or(Value::Null);
    let winnable = m.data.as_ref().map(|d| !matches!(d.get("difficulty").get("winnable"), Value::Bool(false))).unwrap_or(true);
    let diff = el("div")
        .cls("am-diff card")
        .cls_if(!winnable, "blocked")
        .kid(el("div").cls("pc-head").kid(el("span").text("Difficulty")).kid(el("b").text(format!("Level {}", num(prog.get("difficulty_level").f(), 0)))))
        .kid(el("div").cls("pc-head").kid(el("span").text("Goal")).kid(el("b").text("Absorb every field")))
        .kid(el("div").cls("pc-head").kid(el("span").text("Wins")).kid(el("b").text(num(prog.get("wins").f(), 0))))
        .kid_if(prog.get("best_mass").f() > 0.0, || el("div").cls("pc-head").kid(el("span").text("Your best")).kid(el("b").text(num(prog.get("best_mass").f(), 0))).into())
        .kid(el("p").cls("hint").text(if winnable { "Each win raises the difficulty. Assessing a manuscript resets it." } else { "This field cannot be won at your current level. Assess a manuscript to reset the difficulty to 0." }));
    let wallet = m.data.as_ref().map(|d| d.get("wallet_state").clone()).unwrap_or(Value::Null);
    let capped = wallet.get("cap").f() > 0.0 && wallet.get("bonus_earned").f() >= wallet.get("cap").f();
    let board = slot_view(&m.board, "Loading…", |d| {
        let rows = d.get("leaderboard").arr();
        if rows.is_empty() {
            return el("p").cls("hint").text("No signed-in players have completed a run yet. Sign in with ORCID to appear here.").into();
        }
        el("div")
            .kid(
                el("table")
                    .cls("data-table")
                    .kid(el("thead").kid(el("tr").kid(el("th").text("#")).kid(el("th").text("Player")).kid(el("th").text("Best")).kid(el("th").text("Wins")).kid(el("th").text("Lvl"))))
                    .kid(el("tbody").kids(rows.iter().map(|r| -> N {
                        el("tr")
                            .kid(el("td").text(r.get("rank").text()))
                            .kid(el("td").text(r.get("player").text()))
                            .kid(el("td").text(num(r.get("best_mass").f(), 0)))
                            .kid(el("td").text(r.get("wins").text()))
                            .kid(el("td").text(r.get("difficulty_level").text()))
                            .into()
                    }))),
            )
            .kid(el("p").cls("hint").text(d.get("note").text()))
            .into()
    });
    el("aside")
        .cls("am-side")
        .kid(filters)
        .kid(look)
        .kid(el("div").cls("card").kid(detail))
        .kid(el("details").attr("open", "").cls("am-group").kid(el("summary").text("Map legend & data")).kid(legend_view))
        .kid(diff)
        .kid_if(capped, || el("p").cls("hint").text("Free-play cap reached — sign in with ORCID to keep earning piQ from wins.").into())
        .kid(el("details").cls("am-group").kid(el("summary").text("Leaderboard")).kid(board))
        .kid(el("p").cls("hint").kid(el("b").text("Explore: ")).kid(txt("drag to pan, scroll to zoom, tap a field. ")).kid(el("b").text("Play: ")).kid(txt("move the pointer or use WASD / arrows. Esc exits.")))
        .into()
}

const MAP_CSS: &str = "\
.amap{max-width:none}\
.am-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}\
@media (max-width:900px){.am-layout{grid-template-columns:1fr}}\
.am-stage{position:relative;height:min(68vh,620px);min-height:360px;border:1px solid var(--line2);background:linear-gradient(#fbfbf9,#f6f6f4);overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}\
.am-svg{position:absolute;inset:0;width:100%;height:100%}\
.am-region{fill:rgba(25,25,25,.42);font-weight:600;letter-spacing:.02em}\
.am-label{fill:#191919;font-weight:500}.am-label.faint{fill:rgba(25,25,25,.48)}.am-sub{fill:rgba(25,25,25,.6)}\
.am-mini rect{fill:rgba(255,255,255,.94);stroke:rgba(25,25,25,.12)}\
.am-toolbar{position:absolute;left:10px;right:10px;top:10px;display:flex;gap:8px;align-items:center;justify-content:flex-end}\
.am-hint{margin-right:auto;font-size:12.5px;color:var(--muted);background:rgba(255,255,255,.9);padding:4px 8px}\
.am-hud{position:absolute;left:12px;top:52px;width:210px;background:rgba(255,255,255,.94);padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:12.5px;pointer-events:none}\
.am-power{font-weight:600}\
.am-msg{position:absolute;left:12px;bottom:12px;max-width:60%;margin:0;background:rgba(255,255,255,.95);padding:6px 10px;font-size:13px;border:1px solid var(--line2)}\
.am-msg.good{border-color:var(--good);color:var(--good)}.am-msg.bad{border-color:var(--bad);color:var(--bad)}\
.am-overlay{position:absolute;inset:0;display:grid;place-items:center;background:rgba(246,246,244,.7)}\
.am-overlay-card{background:#fff;border:1.4px solid #2b2b2b;padding:20px 24px;max-width:420px}\
.am-reward{color:var(--good);font-weight:600}\
.am-side .card,.am-group{margin-bottom:10px}.am-group summary{cursor:pointer;font-weight:600;margin-bottom:6px}\
.am-check{display:flex;gap:6px;align-items:center;font-size:14px;margin:6px 0}\
.am-swatch{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:middle}\
.am-diff .pc-head{font-size:13.5px;margin:3px 0}.am-diff.blocked{border-color:var(--bad)}\
.am-papers{margin-top:12px}.data-table tr.clickable{cursor:pointer}.data-table tr.clickable:hover{background:var(--accent-soft)}\
";
