// QuVI in Rust: a state-vector quantum circuit simulator and its editor (quvi/engine.js and quvi/quvi.js of the
// old page). QuVI is Murtaza Vefadar's LabVIEW toolkit (MIT licence, front/quvi/LICENSE-QuVI.txt): qubits are wires,
// gates are dropped on a timeline, and an inspector reads probabilities, the state vector, Bloch spheres, density
// matrices and entropy off the end. This is an independent implementation of the same model.
//
// Qubit 0 is the top wire; basis labels are written q0 q1 … q(n-1), so |01⟩ means q0 = 0, q1 = 1. A circuit is a
// list of columns, one cell per wire: a gate (I X Y Z H S T, or P RX RY RZ with an angle), a control (C) or an
// anti-control (A) for the column's gates and swap, a swap (SW, two per column) or a measurement (M). Included into
// app.rs.

const Q_MAX: usize = 6;
const Q_MIN_COLS: usize = 10;
const Q_MAX_COLS: usize = 40;

#[derive(Clone, Copy, PartialEq)]
struct Cx {
    re: f64,
    im: f64,
}

fn cx(re: f64, im: f64) -> Cx {
    Cx { re, im }
}
fn cmul(a: Cx, b: Cx) -> Cx {
    cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
}
fn cadd(a: Cx, b: Cx) -> Cx {
    cx(a.re + b.re, a.im + b.im)
}
fn cconj(a: Cx) -> Cx {
    cx(a.re, -a.im)
}
fn cabs2(a: Cx) -> f64 {
    a.re * a.re + a.im * a.im
}

// ---------------------------------------------------------------------------------------------- the maths it needs

fn sqrt_f(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    // a first guess from the exponent halved (within a few per cent), then Newton's step: five give full precision
    // (it was up to sixty from x / 2, which Face Mace's face finder paid once per window)
    if x.is_finite() && x >= f64::MIN_POSITIVE {
        let mut g = f64::from_bits((x.to_bits() >> 1) + 0x1ff7_a3be_a91d_9b1b);
        for _ in 0..5 {
            g = 0.5 * (g + x / g);
        }
        return g;
    }
    let mut g = if x > 1.0 { x / 2.0 } else { 1.0 };
    for _ in 0..60 {
        let n = 0.5 * (g + x / g);
        if (n - g).abs() < 1e-15 * n {
            return n;
        }
        g = n;
    }
    g
}
fn sin_f(x: f64) -> f64 {
    libm_cos(x - core::f64::consts::FRAC_PI_2)
}
fn cos_f(x: f64) -> f64 {
    libm_cos(x)
}
fn atan_f(x: f64) -> f64 {
    // reduce to |x| ≤ tan(π/12), then a series
    if x < 0.0 {
        return -atan_f(-x);
    }
    if x > 1.0 {
        return core::f64::consts::FRAC_PI_2 - atan_f(1.0 / x);
    }
    let t = 0.267_949_192_431_122_7; // tan(π/12)
    if x > t {
        return core::f64::consts::PI / 6.0 + atan_f((x * 3f64.sqrt_c() - 1.0) / (x + 3f64.sqrt_c()));
    }
    let (x2, mut term, mut sum) = (x * x, x, x);
    let mut k = 1.0;
    while k < 40.0 {
        term *= -x2;
        sum += term / (2.0 * k + 1.0);
        k += 1.0;
    }
    sum
}
trait SqrtC {
    fn sqrt_c(self) -> f64;
}
impl SqrtC for f64 {
    fn sqrt_c(self) -> f64 {
        sqrt_f(self)
    }
}
fn atan2_f(y: f64, x: f64) -> f64 {
    use core::f64::consts::PI;
    if x > 0.0 {
        atan_f(y / x)
    } else if x < 0.0 {
        if y >= 0.0 { atan_f(y / x) + PI } else { atan_f(y / x) - PI }
    } else if y > 0.0 {
        PI / 2.0
    } else if y < 0.0 {
        -PI / 2.0
    } else {
        0.0
    }
}
fn log2_f(x: f64) -> f64 {
    ln_f(x) / core::f64::consts::LN_2
}

// ---------------------------------------------------------------------------------------------- the engine

#[derive(Clone, Copy, PartialEq)]
struct QCell {
    op: &'static str,
    theta: Option<f64>,
}

fn gate_matrix(op: &str, theta: f64) -> [[Cx; 2]; 2] {
    let s2 = core::f64::consts::FRAC_1_SQRT_2;
    let t2 = theta / 2.0;
    let o = cx(1.0, 0.0);
    let z = cx(0.0, 0.0);
    match op {
        "X" => [[z, o], [o, z]],
        "Y" => [[z, cx(0.0, -1.0)], [cx(0.0, 1.0), z]],
        "Z" => [[o, z], [z, cx(-1.0, 0.0)]],
        "H" => [[cx(s2, 0.0), cx(s2, 0.0)], [cx(s2, 0.0), cx(-s2, 0.0)]],
        "S" => [[o, z], [z, cx(0.0, 1.0)]],
        "T" => [[o, z], [z, cx(s2, s2)]],
        "P" => [[o, z], [z, cx(cos_f(theta), sin_f(theta))]],
        "RX" => [[cx(cos_f(t2), 0.0), cx(0.0, -sin_f(t2))], [cx(0.0, -sin_f(t2)), cx(cos_f(t2), 0.0)]],
        "RY" => [[cx(cos_f(t2), 0.0), cx(-sin_f(t2), 0.0)], [cx(sin_f(t2), 0.0), cx(cos_f(t2), 0.0)]],
        "RZ" => [[cx(cos_f(t2), -sin_f(t2)), z], [z, cx(cos_f(t2), sin_f(t2))]],
        _ => [[o, z], [z, o]],
    }
}

fn bit_of(n: usize, k: usize) -> usize {
    1 << (n - 1 - k)
}

fn controls_match(i: usize, n: usize, controls: &[(usize, u8)]) -> bool {
    controls.iter().all(|(k, pol)| ((i & bit_of(n, *k)) != 0) == (*pol == 1))
}

fn apply_gate(state: &mut [Cx], n: usize, target: usize, m: &[[Cx; 2]; 2], controls: &[(usize, u8)]) {
    let tb = bit_of(n, target);
    for i in 0..state.len() {
        if i & tb != 0 || !controls_match(i, n, controls) {
            continue;
        }
        let j = i | tb;
        let (a, b) = (state[i], state[j]);
        state[i] = cadd(cmul(m[0][0], a), cmul(m[0][1], b));
        state[j] = cadd(cmul(m[1][0], a), cmul(m[1][1], b));
    }
}

fn apply_swap(state: &mut [Cx], n: usize, q1: usize, q2: usize, controls: &[(usize, u8)]) {
    let (b1, b2) = (bit_of(n, q1), bit_of(n, q2));
    for i in 0..state.len() {
        if i & b1 != 0 && i & b2 == 0 && controls_match(i, n, controls) {
            let j = (i & !b1) | b2;
            state.swap(i, j);
        }
    }
}

fn prob_one(state: &[Cx], n: usize, k: usize) -> f64 {
    let b = bit_of(n, k);
    state.iter().enumerate().filter(|(i, _)| i & b != 0).map(|(_, a)| cabs2(*a)).sum()
}

/// mulberry32: measurements stay put while stepping through the circuit.
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6D2B_79F5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(1 | t);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    }
}

fn measure(state: &mut [Cx], n: usize, k: usize, rng: &mut Rng) -> u8 {
    let p1 = prob_one(state, n, k);
    let out = if rng.next() < p1 { 1 } else { 0 };
    let norm = sqrt_f(if out == 1 { p1 } else { 1.0 - p1 });
    let norm = if norm == 0.0 { 1.0 } else { norm };
    let b = bit_of(n, k);
    for (i, a) in state.iter_mut().enumerate() {
        *a = if ((i & b) != 0) == (out == 1) { cx(a.re / norm, a.im / norm) } else { cx(0.0, 0.0) };
    }
    out
}

/// Runs columns [0, upto) of a circuit: the state and what was measured (column, qubit, outcome).
fn q_run(circ: &[Vec<Option<QCell>>], n: usize, upto: usize, seed: u32) -> (Vec<Cx>, Vec<(usize, usize, u8)>) {
    let mut state = alloc::vec![cx(0.0, 0.0); 1 << n];
    state[0] = cx(1.0, 0.0);
    let mut rng = Rng(seed);
    let mut meas = Vec::new();
    for (col, cells) in circ.iter().enumerate().take(upto.min(circ.len())) {
        let (mut controls, mut swaps, mut gates, mut ms) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for k in 0..n {
            let Some(Some(c)) = cells.get(k) else { continue };
            match c.op {
                "C" => controls.push((k, 1u8)),
                "A" => controls.push((k, 0u8)),
                "SW" => swaps.push(k),
                "M" => ms.push(k),
                _ => gates.push((k, *c)),
            }
        }
        for (k, c) in gates {
            apply_gate(&mut state, n, k, &gate_matrix(c.op, c.theta.unwrap_or(0.0)), &controls);
        }
        if swaps.len() == 2 {
            apply_swap(&mut state, n, swaps[0], swaps[1], &controls);
        }
        for k in ms {
            let o = measure(&mut state, n, k, &mut rng);
            meas.push((col, k, o));
        }
    }
    (state, meas)
}

fn basis(i: usize, n: usize) -> String {
    (0..n).map(|k| if i & bit_of(n, k) != 0 { '1' } else { '0' }).collect()
}

fn reduced1(state: &[Cx], n: usize, k: usize) -> [[Cx; 2]; 2] {
    let b = bit_of(n, k);
    let (mut r00, mut r11, mut r01) = (0.0, 0.0, cx(0.0, 0.0));
    for i in 0..state.len() {
        if i & b != 0 {
            continue;
        }
        let (a0, a1) = (state[i], state[i | b]);
        r00 += cabs2(a0);
        r11 += cabs2(a1);
        r01 = cadd(r01, cmul(a0, cconj(a1)));
    }
    [[cx(r00, 0.0), r01], [cconj(r01), cx(r11, 0.0)]]
}

fn bloch(rho: &[[Cx; 2]; 2]) -> (f64, f64, f64) {
    (2.0 * rho[0][1].re, -2.0 * rho[0][1].im, rho[0][0].re - rho[1][1].re)
}

fn entropy1(rho: &[[Cx; 2]; 2]) -> f64 {
    let (x, y, z) = bloch(rho);
    let r = sqrt_f(x * x + y * y + z * z).min(1.0);
    let h = |p: f64| if p <= 1e-12 { 0.0 } else { -p * log2_f(p) };
    h((1.0 + r) / 2.0) + h((1.0 - r) / 2.0)
}

fn purity1(rho: &[[Cx; 2]; 2]) -> f64 {
    let (x, y, z) = bloch(rho);
    (1.0 + x * x + y * y + z * z) / 2.0
}

fn fixed(x: f64, d: usize) -> String {
    let x = if x.abs() < 5e-10 { 0.0 } else { x };
    format!("{:.*}", d, x)
}

fn cfmt(z: Cx) -> String {
    let re = if z.re.abs() < 5e-10 { 0.0 } else { z.re };
    let im = if z.im.abs() < 5e-10 { 0.0 } else { z.im };
    if im == 0.0 {
        return format!("{:.3}", re);
    }
    if re == 0.0 {
        return format!("{:.3}i", im);
    }
    format!("{:.3}{}{:.3}i", re, if im < 0.0 { " − " } else { " + " }, im.abs())
}

// ---------------------------------------------------------------------------------------------- the examples

fn qcol(n: usize, cells: &[(usize, &'static str, Option<f64>)]) -> Vec<Option<QCell>> {
    let mut c = alloc::vec![None; n];
    for (k, op, th) in cells {
        c[*k] = Some(QCell { op, theta: *th });
    }
    c
}

const Q_EXAMPLES: [(&str, &str); 6] = [
    ("Bell pair", "H then CNOT: two qubits that always agree when measured. Each one alone is maximally uncertain (entropy 1)."),
    ("GHZ state", "Three-way entanglement: |000⟩ and |111⟩ with equal weight, nothing in between."),
    ("Teleportation", "q0 is prepared with RY(π/3) and its state reappears on q2. Corrections use quantum controls (the deferred-measurement form), so q2's Bloch sphere matches q0's original state for every measurement outcome."),
    ("Superdense coding", "One qubit carries two classical bits. Alice encodes 11 with X then Z on her half of a Bell pair; Bob decodes with CNOT and H and always reads 11."),
    ("Grover search", "Two-qubit search for |11⟩: one oracle (CZ) and one diffusion step find the marked item with certainty."),
    ("QFT, 4 qubits", "The quantum Fourier transform of |0101⟩ (x = 5). Every outcome is equally likely; the information is in the phases, which turn by 5 × 2π/16 per step. Open the state vector to see them."),
];

fn q_example(i: usize) -> (usize, Vec<Vec<Option<QCell>>>) {
    use core::f64::consts::PI;
    match i {
        0 => (2, alloc::vec![qcol(2, &[(0, "H", None)]), qcol(2, &[(0, "C", None), (1, "X", None)])]),
        1 => (3, alloc::vec![qcol(3, &[(0, "H", None)]), qcol(3, &[(0, "C", None), (1, "X", None)]), qcol(3, &[(1, "C", None), (2, "X", None)])]),
        2 => (
            3,
            alloc::vec![
                qcol(3, &[(0, "RY", Some(PI / 3.0)), (1, "H", None)]),
                qcol(3, &[(1, "C", None), (2, "X", None)]),
                qcol(3, &[(0, "C", None), (1, "X", None)]),
                qcol(3, &[(0, "H", None)]),
                qcol(3, &[(1, "C", None), (2, "X", None)]),
                qcol(3, &[(0, "C", None), (2, "Z", None)]),
                qcol(3, &[(0, "M", None), (1, "M", None)]),
            ],
        ),
        3 => (
            2,
            alloc::vec![
                qcol(2, &[(0, "H", None)]),
                qcol(2, &[(0, "C", None), (1, "X", None)]),
                qcol(2, &[(0, "X", None)]),
                qcol(2, &[(0, "Z", None)]),
                qcol(2, &[(0, "C", None), (1, "X", None)]),
                qcol(2, &[(0, "H", None)]),
                qcol(2, &[(0, "M", None), (1, "M", None)]),
            ],
        ),
        4 => (
            2,
            alloc::vec![
                qcol(2, &[(0, "H", None), (1, "H", None)]),
                qcol(2, &[(0, "C", None), (1, "Z", None)]),
                qcol(2, &[(0, "H", None), (1, "H", None)]),
                qcol(2, &[(0, "X", None), (1, "X", None)]),
                qcol(2, &[(0, "C", None), (1, "Z", None)]),
                qcol(2, &[(0, "X", None), (1, "X", None)]),
                qcol(2, &[(0, "H", None), (1, "H", None)]),
            ],
        ),
        5 => {
            let n = 4;
            let mut cols = alloc::vec![qcol(n, &[(1, "X", None), (3, "X", None)])];
            for j in 0..n {
                cols.push(qcol(n, &[(j, "H", None)]));
                for k in j + 1..n {
                    cols.push(qcol(n, &[(k, "C", None), (j, "P", Some(PI / (1u32 << (k - j)) as f64))]));
                }
            }
            cols.push(qcol(n, &[(0, "SW", None), (3, "SW", None)]));
            cols.push(qcol(n, &[(1, "SW", None), (2, "SW", None)]));
            (n, cols)
        }
        _ => (2, Vec::new()),
    }
}

// ---------------------------------------------------------------------------------------------- the editor

/// The palette: (op, label, title, takes an angle)
const Q_TOOLS: [(&str, &str, &str, bool); 16] = [
    ("H", "H", "Hadamard", false),
    ("X", "X", "Pauli-X (NOT)", false),
    ("Y", "Y", "Pauli-Y", false),
    ("Z", "Z", "Pauli-Z", false),
    ("S", "S", "S gate (√Z)", false),
    ("T", "T", "T gate (fourth root of Z)", false),
    ("I", "I", "Identity", false),
    ("P", "P", "Phase(θ)", true),
    ("RX", "RX", "Rotation about X by θ", true),
    ("RY", "RY", "Rotation about Y by θ", true),
    ("RZ", "RZ", "Rotation about Z by θ", true),
    ("C", "● Control", "Control: the column's gates act when this qubit is 1", false),
    ("A", "○ Anti-control", "Anti-control: act when this qubit is 0", false),
    ("SW", "× Swap", "Swap: place on two wires in the same column", false),
    ("M", "Measure", "Measure in Z", false),
    ("ERASE", "Erase", "Remove gates", false),
];

pub struct Quvi {
    n: usize,
    circ: Vec<Vec<Option<QCell>>>,
    tool: usize,
    angle: String,
    step: usize,
    tab: u8,
    seed: u32,
    ex: Option<usize>,
    hint: String,
    features: Slot,
}

impl Default for Quvi {
    fn default() -> Self {
        let (n, circ) = q_example(0);
        Quvi { n, step: circ.len(), circ, tool: 0, angle: "0.5".into(), tab: 0, seed: 1, ex: Some(0), hint: String::new(), features: Slot::default() }
    }
}

fn q_trim(q: &mut Quvi) {
    while q.circ.last().map(|c| c.iter().all(|x| x.is_none())).unwrap_or(false) {
        q.circ.pop();
    }
}

fn q_place(col: usize, k: usize) {
    let q = &mut st().quvi;
    let (op, _, _, angle) = Q_TOOLS[q.tool.min(Q_TOOLS.len() - 1)];
    let cell = if op == "ERASE" {
        None
    } else {
        let theta = if angle { Some(q.angle.trim().parse::<f64>().unwrap_or(0.0) * core::f64::consts::PI) } else { None };
        Some(QCell { op, theta })
    };
    while q.circ.len() <= col {
        q.circ.push(alloc::vec![None; q.n]);
    }
    let same = q.circ[col][k] == cell;
    if cell.is_none() || same {
        q.circ[col][k] = None;
    } else {
        if op == "SW" && q.circ[col].iter().enumerate().filter(|(j, c)| *j != k && c.map(|c| c.op == "SW").unwrap_or(false)).count() >= 2 {
            q.hint = "A column can swap only two wires. Remove one × first.".to_string();
            return;
        }
        q.circ[col][k] = cell;
    }
    q_trim(q);
    q.step = q.circ.len();
    q.ex = None;
    q.hint.clear();
}

fn quvi_update(a: u16, v: String) {
    let q = &mut st().quvi;
    match a {
        1 => q.tool = v.parse().unwrap_or(0),
        2 => q.angle = v,
        3 => {
            let (c, k) = v.split_once(',').unwrap_or(("0", "0"));
            q_place(c.parse().unwrap_or(0), k.parse().unwrap_or(0));
        }
        4 => {
            let i: usize = v.parse().unwrap_or(99);
            let (n, circ) = q_example(i);
            q.n = n;
            q.step = circ.len();
            q.circ = circ;
            q.ex = if i < Q_EXAMPLES.len() { Some(i) } else { None };
        }
        5 => {
            let k = (q.n as i64 + if v == "+" { 1 } else { -1 }).clamp(1, Q_MAX as i64) as usize;
            if k != q.n {
                for c in q.circ.iter_mut() {
                    c.resize(k, None);
                }
                q.n = k;
                q_trim(q);
                q.step = q.step.min(q.circ.len());
            }
        }
        6 => q.seed = ((q.seed as u64 * 48271) % 2_147_483_647).max(1) as u32,
        7 => q.step = v.parse::<usize>().unwrap_or(0).min(q.circ.len()),
        8 => q.tab = v.parse().unwrap_or(0),
        _ => {}
    }
}

fn quvi_load() {
    let s = st();
    if s.quvi.features.needed() {
        s.quvi.features.busy = true;
        request(Want::Tool(Tool::Quvi, 0), "GET", "/api/lab/features", "", 0);
    }
}

fn cell_label(c: &QCell) -> String {
    match c.theta {
        Some(t) => {
            let k = t / core::f64::consts::PI;
            let r = ((k * 1000.0 + if k < 0.0 { -0.5 } else { 0.5 }) as i64) as f64 / 1000.0;
            format!("{}{}π", c.op, if (k - r).abs() < 1e-9 { format!("{}", r) } else { format!("{:.3}", k) })
        }
        None => c.op.to_string(),
    }
}

fn quvi_view(s: &State) -> N {
    let q = &s.quvi;
    let public = q.features.data.as_ref().map(|d| d.get("quvi_public").truthy()).unwrap_or(false);
    if !public && !is_owner(s) {
        if q.features.busy {
            return spinner("Loading…");
        }
        return el("div")
            .cls("card")
            .kid(el("h2").text("Coming to the Lab"))
            .kid(el("p").text("This experiment is a browser version of QuVI, a quantum circuit toolkit by Murtaza Vefadar. It will open here once the author has reviewed it."))
            .kid(el("p").kid(txt("Read his paper: ")).kid(ext_link("https://arxiv.org/abs/2602.00643", "From Block Diagrams to Bloch Spheres")))
            .into();
    }
    let n = q.n;
    let cols = (q.circ.len() + 1).clamp(Q_MIN_COLS, Q_MAX_COLS);
    // controls
    let controls = el("div")
        .cls("q-controls row")
        .kid(
            el("label").cls("q-ex").kid(txt("Example ")).kid(
                el("select")
                    .attr("aria-label", "Example")
                    .on_val("change", |v| Msg::T(Tool::Quvi, 4, v))
                    .kid(el("option").attr("value", "99").prop("selected", if q.ex.is_none() { "1" } else { "0" }).text("Empty circuit"))
                    .kids(Q_EXAMPLES.iter().enumerate().map(|(i, (name, _))| -> N {
                        el("option").attr("value", format!("{}", i)).attr_if(q.ex == Some(i), "selected", "").text(*name).into()
                    })),
            ),
        )
        .kid(
            el("div")
                .cls("q-qubits")
                .attr("role", "group")
                .attr("aria-label", "Number of qubits")
                .kid(el("span").text("Qubits"))
                .kid(el("button").attr("type", "button").cls("btn small").attr("aria-label", "Remove a qubit").attr_if(n <= 1, "disabled", "").on("click", Msg::T(Tool::Quvi, 5, "-".into())).text("−"))
                .kid(el("b").text(format!("{}", n)))
                .kid(el("button").attr("type", "button").cls("btn small").attr("aria-label", "Add a qubit").attr_if(n >= Q_MAX, "disabled", "").on("click", Msg::T(Tool::Quvi, 5, "+".into())).text("+")),
        )
        .kid(el("button").attr("type", "button").cls("btn small").attr("title", "Measurements are random; sample them again").on("click", Msg::T(Tool::Quvi, 6, String::new())).text("Measure again"))
        .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Quvi, 4, "99".into())).text("Clear"));
    let note = q.ex.map(|i| Q_EXAMPLES[i].1).unwrap_or("");
    // palette
    let angle_tool = Q_TOOLS[q.tool.min(Q_TOOLS.len() - 1)].3;
    let palette = el("div")
        .cls("q-palette")
        .kid(el("div").cls("chips").kids(Q_TOOLS.iter().enumerate().map(|(i, (_, label, title, _))| -> N {
            el("button")
                .attr("type", "button")
                .cls("chip")
                .cls_if(i == q.tool, "on")
                .attr("title", *title)
                .attr("aria-pressed", if i == q.tool { "true" } else { "false" })
                .on("click", Msg::T(Tool::Quvi, 1, format!("{}", i)))
                .text(*label)
                .into()
        })))
        .kid_if(angle_tool, || {
            el("label")
                .cls("q-angle")
                .kid(txt("θ = "))
                .kid(el("input").attr("type", "number").attr("step", "0.125").attr("aria-label", "Angle in multiples of π").prop("value", q.angle.clone()).on_val("input", |v| Msg::T(Tool::Quvi, 2, v)))
                .kid(txt(" π"))
                .into()
        })
        .kid(el("p").cls("hint").text(if q.hint.is_empty() { "Pick a gate, then click a spot on a wire. Click a placed gate to remove it.".to_string() } else { q.hint.clone() }));
    // the diagram: a grid, a header row of steps, then a row per wire
    let mut grid = el("div").cls("q-diagram").style(format!("grid-template-columns:max-content repeat({},40px)", cols)).kid(el("span"));
    for c in 0..cols {
        grid = grid.kid(if c < q.circ.len() {
            let b: N = el("button")
                .attr("type", "button")
                .cls("q-colhead")
                .cls_if(c + 1 == q.step, "at")
                .attr("title", format!("Inspect after step {}", c + 1))
                .on("click", Msg::T(Tool::Quvi, 7, format!("{}", c + 1)))
                .text(format!("{}", c + 1))
                .into();
            b
        } else {
            let e: N = el("span").into();
            e
        });
    }
    // which wires a column joins (controls and swaps with what they act on)
    let spans: Vec<Option<(usize, usize)>> = q
        .circ
        .iter()
        .map(|col| {
            let joined: Vec<usize> = (0..n).filter(|k| col.get(*k).and_then(|c| *c).map(|c| matches!(c.op, "C" | "A" | "SW")).unwrap_or(false)).collect();
            let acted: Vec<usize> = (0..n).filter(|k| col.get(*k).and_then(|c| *c).map(|c| !matches!(c.op, "C" | "A" | "M")).unwrap_or(false)).collect();
            if joined.is_empty() || joined.len() + acted.len() < 2 {
                return None;
            }
            let all: Vec<usize> = joined.iter().chain(acted.iter()).cloned().collect();
            Some((*all.iter().min().unwrap(), *all.iter().max().unwrap()))
        })
        .collect();
    for k in 0..n {
        grid = grid.kid(el("span").cls("q-wire").text(format!("q{}  |0⟩", k)));
        for c in 0..cols {
            let cell = q.circ.get(c).and_then(|col| col.get(k)).and_then(|x| *x);
            let link = spans.get(c).and_then(|x| *x).map(|(lo, hi)| (k >= lo && k <= hi, k == lo, k == hi)).unwrap_or((false, false, false));
            let inner: N = match cell {
                None => txt(""),
                Some(cl) => match cl.op {
                    "C" => el("span").cls("q-ctrl").into(),
                    "A" => el("span").cls("q-ctrl anti").into(),
                    "SW" => el("span").cls("q-swap").text("×").into(),
                    "M" => el("span").cls("q-gate q-m").text("M").into(),
                    _ => el("span").cls("q-gate").text(cell_label(&cl)).into(),
                },
            };
            grid = grid.kid(
                el("button")
                    .attr("type", "button")
                    .cls("q-cell")
                    .cls_if(c >= q.step, "future")
                    .cls_if(link.0, "link")
                    .cls_if(link.0 && link.1, "link-top")
                    .cls_if(link.0 && link.2, "link-bot")
                    .attr("aria-label", format!("q{}, step {}: {}", k, c + 1, cell.map(|c| c.op).unwrap_or("empty")))
                    .on("click", Msg::T(Tool::Quvi, 3, format!("{},{}", c, k)))
                    .kid(el("span").cls("q-slot"))
                    .kid(inner),
            );
        }
    }
    let timeline = el("div")
        .cls("q-timeline")
        .kid(el("label").text(format!("Inspect after step {} of {}", q.step, q.circ.len())))
        .kid(el("input").attr("type", "range").attr("min", "0").attr("max", format!("{}", q.circ.len())).prop("value", format!("{}", q.step)).attr("aria-label", "Step").on_val("input", |v| Msg::T(Tool::Quvi, 7, v)));
    let tabs = el("div").cls("q-tabs").attr("role", "tablist").kids(["Probabilities", "State vector", "Bloch spheres", "Density matrix", "Entanglement"].iter().enumerate().map(|(i, t)| -> N {
        el("button")
            .attr("type", "button")
            .attr("role", "tab")
            .attr("aria-selected", if q.tab as usize == i { "true" } else { "false" })
            .on("click", Msg::T(Tool::Quvi, 8, format!("{}", i)))
            .text(*t)
            .into()
    }));
    let (state, meas) = q_run(&q.circ, n, q.step, q.seed);
    let panel = q_panel(q.tab, &state, n);
    el("div")
        .cls("tool quvi")
        .kid(el("p").cls("lede").text("Build a quantum circuit on wires, then inspect what it does: probabilities, state vector, Bloch spheres, density matrix and entanglement."))
        .kid(controls)
        .kid_if(!note.is_empty(), || el("p").cls("hint").text(note).into())
        .kid(palette)
        .kid(el("div").cls("q-wrap").kid(grid))
        .kid(timeline)
        .kid(tabs)
        .kid(el("div").cls("q-panel").attr("role", "tabpanel").kid(panel))
        .kid_if(!meas.is_empty(), || {
            el("p")
                .cls("hint")
                .text(format!(
                    "Measured: {}. Results are random; “Measure again” samples new ones.",
                    meas.iter().map(|(_, k, o)| format!("q{} → {}", k, o)).collect::<Vec<_>>().join(", ")
                ))
                .into()
        })
        .kid(
            el("p")
                .cls("hint q-credit")
                .kid(txt("QuVI is a LabVIEW toolkit for composing and simulating quantum circuits by Murtaza Vefadar (Department of Physics, Gebze Technical University), described in "))
                .kid(ext_link("https://arxiv.org/abs/2602.00643", "From Block Diagrams to Bloch Spheres"))
                .kid(txt(". This is an independent implementation of the same model, in Rust; it is not the original software. QuVI is © 2026 Murtaza Vefadar, "))
                .kid(ext_link("/quvi/LICENSE-QuVI.txt", "MIT licence"))
                .kid(txt(".")),
        )
        .into()
}

fn q_panel(tab: u8, state: &[Cx], n: usize) -> N {
    match tab {
        0 => {
            let p: Vec<f64> = state.iter().map(|a| cabs2(*a)).collect();
            let rows: Vec<(usize, f64)> = p.iter().cloned().enumerate().filter(|(_, v)| p.len() <= 16 || *v > 1e-9).collect();
            el("div")
                .kid(el("div").cls("q-bars").kids(rows.iter().flat_map(|(i, v)| {
                    [
                        el("span").cls("k").text(format!("|{}⟩", basis(*i, n))).into(),
                        el("span").cls("md-bar").kid(el("i").style(format!("width:{:.2}%", v * 100.0))).into(),
                        el("span").cls("v").text(format!("{:.1}%", v * 100.0)).into(),
                    ]
                    .into_iter()
                    .collect::<Vec<N>>()
                })))
                .kid_if(p.len() > 16, || el("p").cls("hint").text(format!("Showing the {} outcomes with non-zero probability.", rows.len())).into())
                .into()
        }
        1 => el("table")
            .cls("data-table")
            .kid(el("thead").kid(el("tr").kid(el("th").text("Basis")).kid(el("th").text("Amplitude")).kid(el("th").text("|a|")).kid(el("th").text("Phase"))))
            .kid(el("tbody").kids(state.iter().enumerate().filter(|(_, a)| state.len() <= 16 || cabs2(**a) > 1e-12).map(|(i, a)| -> N {
                let mag = sqrt_f(cabs2(*a));
                let ph = if mag > 1e-9 { atan2_f(a.im, a.re) } else { 0.0 };
                el("tr")
                    .kid(el("td").cls("mono").text(format!("|{}⟩", basis(i, n))))
                    .kid(el("td").cls("mono").text(cfmt(*a)))
                    .kid(el("td").text(fixed(mag, 3)))
                    .kid(if mag > 1e-9 {
                        el("td").kid(phase_dial(ph)).kid(txt(format!(" {}π", fixed(ph / core::f64::consts::PI, 3))))
                    } else {
                        el("td").cls("hint").text("—")
                    })
                    .into()
            })))
            .into(),
        2 => el("div").cls("q-blochs").kids((0..n).map(|k| -> N {
            let rho = reduced1(state, n, k);
            let (x, y, z) = bloch(&rho);
            let r = sqrt_f(x * x + y * y + z * z);
            el("figure")
                .cls("q-bloch")
                .kid(bloch_svg(x, y, z))
                .kid(
                    el("figcaption")
                        .kid(el("b").text(format!("q{}", k)))
                        .kid(txt(format!(" · x {}, y {}, z {}", fixed(x, 2), fixed(y, 2), fixed(z, 2))))
                        .kid(el("br"))
                        .kid(txt(if r < 0.999 { format!("mixed (|r| = {}): entangled with other qubits", fixed(r, 2)) } else { "pure state".to_string() })),
                )
                .into()
        })).into(),
        3 => {
            let heat = |z: Cx, label: bool| -> N {
                let m = sqrt_f(cabs2(z)).min(1.0);
                el("div")
                    .style(format!("background:rgba(47,64,232,{:.3}){}", m * 0.92, if label && m > 0.5 { ";color:#fff" } else { "" }))
                    .attr("title", cfmt(z))
                    .text(if label { fixed(m, 2) } else { String::new() })
                    .into()
            };
            let mut wrap = el("div").cls("q-rho");
            if n <= 4 {
                let nn = state.len();
                let mut cells: Vec<N> = Vec::new();
                for a in state {
                    for b in state {
                        cells.push(heat(cmul(*a, cconj(*b)), false));
                    }
                }
                wrap = wrap.kid(
                    el("div")
                        .kid(el("div").cls("q-heat").style(format!("grid-template-columns:repeat({},22px)", nn)).kids(cells))
                        .kid(el("p").cls("hint").text(format!("Full density matrix |ψ⟩⟨ψ|, {}×{}. Shade shows |ρᵢⱼ|; hover for the value.", nn, nn))),
                );
            } else {
                wrap = wrap.kid(el("p").cls("hint").text("The full matrix is shown for up to 4 qubits."));
            }
            for k in 0..n {
                let r = reduced1(state, n, k);
                wrap = wrap.kid(
                    el("div")
                        .kid(el("div").cls("q-heat small").style("grid-template-columns:repeat(2,40px)").kid(heat(r[0][0], true)).kid(heat(r[0][1], true)).kid(heat(r[1][0], true)).kid(heat(r[1][1], true)))
                        .kid(el("p").cls("hint").text(format!("Reduced ρ of q{}", k))),
                );
            }
            wrap.into()
        }
        _ => el("div")
            .kid(
                el("table")
                    .cls("data-table")
                    .kid(el("thead").kid(el("tr").kid(el("th").text("Qubit")).kid(el("th").text("P(1)")).kid(el("th").text("Entropy S (bits)")).kid(el("th").text("Purity")).kid(el("th").text("Reading"))))
                    .kid(el("tbody").kids((0..n).map(|k| -> N {
                        let rho = reduced1(state, n, k);
                        let s_ = entropy1(&rho);
                        let reading = if s_ > 0.999 { "maximally entangled" } else if s_ > 1e-6 { "partly entangled" } else { "independent of the rest" };
                        el("tr")
                            .kid(el("td").text(format!("q{}", k)))
                            .kid(el("td").text(fixed(prob_one(state, n, k), 3)))
                            .kid(el("td").text(fixed(s_, 3)))
                            .kid(el("td").text(fixed(purity1(&rho), 3)))
                            .kid(el("td").text(reading))
                            .into()
                    }))),
            )
            .kid(el("p").cls("hint").text("Von Neumann entropy of each qubit's reduced state: 0 means it can be described on its own, 1 means it is fully entangled with the others."))
            .into(),
    }
}

fn phase_dial(ph: f64) -> N {
    let (x, y) = (7.0 + 6.0 * cos_f(ph), 7.0 - 6.0 * sin_f(ph));
    el("svg:svg")
        .cls("q-phase")
        .attr("viewBox", "0 0 14 14")
        .attr("width", "14")
        .attr("height", "14")
        .attr("aria-hidden", "true")
        .kid(el("svg:circle").attr("cx", "7").attr("cy", "7").attr("r", "6").attr("fill", "none").attr("stroke", "#c9c9c4"))
        .kid(el("svg:line").attr("x1", "7").attr("y1", "7").attr("x2", format!("{:.2}", x)).attr("y2", format!("{:.2}", y)).attr("stroke", "#2f40e8").attr("stroke-width", "1.6"))
        .into()
}

/// A Bloch sphere from a fixed oblique camera; vectors shorter than 1 (mixed states) end inside it.
fn bloch_svg(x: f64, y: f64, z: f64) -> N {
    use core::f64::consts::PI;
    let (r, cxp, cyp, az, elv) = (72.0, 95.0, 95.0, -PI / 6.0, PI / 9.0);
    let proj = |xx: f64, yy: f64, zz: f64| -> (f64, f64, bool) {
        let x1 = xx * cos_f(az) - yy * sin_f(az);
        let y1 = xx * sin_f(az) + yy * cos_f(az);
        (cxp + r * y1, cyp - r * (zz * cos_f(elv) - x1 * sin_f(elv)), x1 > 0.0)
    };
    let (mut front, mut back) = (String::new(), String::new());
    for i in 0..=72 {
        let a = i as f64 / 72.0 * 2.0 * PI;
        let (sx, sy, f) = proj(cos_f(a), sin_f(a), 0.0);
        let path = if f { &mut front } else { &mut back };
        path.push_str(&format!("{}{:.1} {:.1}", if path.is_empty() { "M" } else { " L" }, sx, sy));
    }
    let axis = |xx: f64, yy: f64, zz: f64, t: &str, dx: f64, dy: f64| -> Vec<N> {
        let (px, py, _) = proj(xx, yy, zz);
        let (qx, qy, _) = proj(-xx, -yy, -zz);
        let mut v: Vec<N> = alloc::vec![el("svg:line").attr("x1", format!("{:.1}", qx)).attr("y1", format!("{:.1}", qy)).attr("x2", format!("{:.1}", px)).attr("y2", format!("{:.1}", py)).attr("stroke", "#dcdcd8").into()];
        if !t.is_empty() {
            v.push(el("svg:text").attr("x", format!("{:.1}", px + dx)).attr("y", format!("{:.1}", py + dy)).attr("font-size", "11").attr("fill", "#6e6e6a").attr("text-anchor", "middle").text(t.to_string()).into());
        }
        v
    };
    let (tx, ty, _) = proj(x, y, z);
    let (ox, oy, _) = proj(0.0, 0.0, 0.0);
    let (bx, by, _) = proj(0.0, 0.0, -1.0);
    el("svg:svg")
        .attr("viewBox", "0 0 190 190")
        .attr("width", "190")
        .attr("height", "190")
        .attr("role", "img")
        .attr("aria-label", format!("Bloch vector x {}, y {}, z {}", fixed(x, 2), fixed(y, 2), fixed(z, 2)))
        .kid(el("svg:circle").attr("cx", "95").attr("cy", "95").attr("r", "72").attr("fill", "none").attr("stroke", "#c9c9c4"))
        .kid(el("svg:path").attr("d", back).attr("fill", "none").attr("stroke", "#dcdcd8").attr("stroke-dasharray", "3 3"))
        .kid(el("svg:path").attr("d", front).attr("fill", "none").attr("stroke", "#c9c9c4"))
        .kids(axis(1.0, 0.0, 0.0, "x", -8.0, 10.0))
        .kids(axis(0.0, 1.0, 0.0, "y", 10.0, 4.0))
        .kids(axis(0.0, 0.0, 1.0, "|0⟩", 0.0, -6.0))
        .kid(el("svg:text").attr("x", format!("{:.1}", bx)).attr("y", format!("{:.1}", by + 14.0)).attr("font-size", "11").attr("fill", "#6e6e6a").attr("text-anchor", "middle").text("|1⟩"))
        .kid(el("svg:line").attr("x1", format!("{:.1}", ox)).attr("y1", format!("{:.1}", oy)).attr("x2", format!("{:.1}", tx)).attr("y2", format!("{:.1}", ty)).attr("stroke", "#191919").attr("stroke-width", "2"))
        .kid(el("svg:circle").attr("cx", format!("{:.1}", tx)).attr("cy", format!("{:.1}", ty)).attr("r", "5").attr("fill", "#2f40e8"))
        .kid(el("svg:circle").attr("cx", format!("{:.1}", ox)).attr("cy", format!("{:.1}", oy)).attr("r", "2").attr("fill", "#191919"))
        .into()
}

const QUVI_CSS: &str = "\
.quvi .q-controls{align-items:center;gap:14px;margin:12px 0}\
.q-ex select,.q-angle input{font:inherit;padding:5px 8px;border:1px solid var(--line2);background:var(--surface)}\
.q-qubits{display:flex;align-items:center;gap:6px}.q-qubits span{color:var(--muted)}\
.q-palette{margin:10px 0}.q-palette .chip.on{background:var(--ink);color:var(--on-ink);border-color:var(--ink)}\
.q-angle{display:inline-flex;align-items:center;gap:4px;margin-top:8px}.q-angle input{width:80px}\
.q-wrap{overflow-x:auto;border:1px solid var(--line);background:var(--surface);padding:10px}\
.q-diagram{display:grid;align-items:center}\
.q-colhead{height:22px;border:0;background:none;font:12px 'Geist Mono',ui-monospace,monospace;color:var(--faint);cursor:pointer}\
.q-colhead.at{color:var(--accent);font-weight:700}\
.q-wire{font:13px 'Geist Mono',ui-monospace,monospace;white-space:pre;padding-right:10px;color:var(--muted)}\
.q-cell{position:relative;width:40px;height:44px;border:0;background:none;padding:0;cursor:pointer}\
.q-slot{position:absolute;left:0;right:0;top:50%;border-top:1.5px solid var(--ink2)}\
.q-cell:hover{background:var(--accent-soft)}\
.q-cell.future{opacity:.35}\
.q-cell.link::before{content:'';position:absolute;left:calc(50% - .75px);width:1.5px;background:var(--ink2);top:0;bottom:0}\
.q-cell.link-top::before{top:50%}.q-cell.link-bot::before{bottom:50%}.q-cell.link-top.link-bot::before{display:none}\
.q-gate{position:relative;z-index:1;display:inline-grid;place-items:center;min-width:30px;height:30px;padding:0 3px;background:var(--surface);border:1.5px solid var(--ink2);font:600 12px 'Geist Mono',ui-monospace,monospace}\
.q-gate.q-m{background:var(--card)}\
.q-ctrl{position:relative;z-index:1;display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--ink2)}\
.q-ctrl.anti{background:var(--surface);border:1.5px solid var(--ink2)}\
.q-swap{position:relative;z-index:1;font-size:20px;font-weight:700;background:var(--surface);line-height:1}\
.q-timeline{display:flex;flex-direction:column;gap:6px;margin:14px 0}\
.q-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}\
.q-tabs button{font:inherit;font-size:13.5px;border:1px solid var(--line2);background:var(--surface);padding:5px 12px;cursor:pointer}\
.q-tabs button[aria-selected=true]{background:var(--ink);color:var(--on-ink);border-color:var(--ink)}\
.q-bars{display:grid;grid-template-columns:max-content 1fr 60px;gap:6px 10px;align-items:center;max-width:620px}\
.q-bars .k{font:13px 'Geist Mono',ui-monospace,monospace}.q-bars .v{text-align:right;font-size:13px}\
.mono{font-family:'Geist Mono',ui-monospace,monospace}.q-phase{vertical-align:middle}\
.q-blochs{display:flex;flex-wrap:wrap;gap:14px}.q-bloch{margin:0;text-align:center;font-size:12.5px;max-width:200px}\
.q-rho{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}\
.q-heat{display:grid;gap:2px}.q-heat div{height:22px;border:1px solid var(--line)}.q-heat.small div{height:40px;display:grid;place-items:center;font-size:12px}\
.q-credit{margin-top:18px}\
";
