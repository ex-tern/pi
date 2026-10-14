// Intern: Assist Diagnosis, on the web (owner, 2026-10-14: "write the whole assist diagnosis intern app on the web
// app itself"). The iOS app's parts, rebuilt here: patients and their files, case reports with a differential from
// the Super AI panel, doctors to find, chat, and calls.
//
// Patients, their files and photos, and the cases stay in this browser (localStorage): nothing about a patient is
// sent to the server. A case goes out only when the doctor asks for a differential and ticks the consent, and then
// without the patient's name, birth date or record numbers (taken out here, and again on the server). Doctors'
// profiles, messages and the signals that start a call live on the server (/api/intern); the call itself goes
// browser to browser (host.js, "rtc"). Included into app.rs.

const T_INTERN: u32 = 34;
const INTERN_TOKEN: u32 = 5_000_000;

#[derive(Clone, Default)]
struct IPatient {
    id: u32,
    name: String,
    born: String,
    sex: String,
    added: f64,
    /// (when, text), oldest first
    notes: Vec<(f64, String)>,
    /// pictures as data: URLs (JPEG, at most 900 px across)
    photos: Vec<String>,
}

#[derive(Clone, Default)]
struct ICase {
    id: u32,
    patient: Option<u32>,
    title: String,
    text: String,
    at: f64,
    /// what was sent (de-identified) and what the panel said
    sent: String,
    result: String,
}

#[derive(Default)]
pub struct Intern {
    loaded: bool,
    tab: u8,
    patients: Vec<IPatient>,
    cases: Vec<ICase>,
    next: u32,
    q: String,
    adding: bool,
    form: [String; 3],
    open: Option<u32>,
    note: String,
    case_open: Option<u32>,
    consent: bool,
    diag_busy: bool,
    diag_err: Option<String>,
    me: Slot,
    doctors: Slot,
    dq: String,
    conv: Slot,
    peer: Option<(String, String)>,
    msgs: Vec<(u64, bool, String, f64)>,
    msg: String,
    msg_busy: bool,
    msg_err: Option<String>,
    prof: [String; 4],
    listed: bool,
    prof_msg: String,
    call: Value,
    ticking: bool,
    /// a delete pressed once: pressed again (within a few seconds), it is done
    arm: Option<(u16, f64)>,
}

const INTERN_TABS: [&str; 5] = ["Patients", "Cases", "Doctors", "Chat", "Profile"];

fn intern_open(s: &State) -> bool {
    matches!(s.page, Page::Item(g, m) if matches!(GROUPS.get(g as usize).and_then(|x| x.members.get(m as usize)), Some((_, Target::Tool(Tool::Intern)))))
}

// ---------------------------------------------------------------------------------------------- kept in the browser

fn intern_save() {
    let i = &st().intern;
    let pats: Vec<String> = i
        .patients
        .iter()
        .map(|p| {
            let notes: Vec<String> = p.notes.iter().map(|(at, t)| format!("[{:.0},{}]", at, json::quote(t))).collect();
            let photos: Vec<String> = p.photos.iter().map(|u| json::quote(u)).collect();
            format!(
                "{{\"id\":{},\"name\":{},\"born\":{},\"sex\":{},\"added\":{:.0},\"notes\":[{}],\"photos\":[{}]}}",
                p.id,
                json::quote(&p.name),
                json::quote(&p.born),
                json::quote(&p.sex),
                p.added,
                notes.join(","),
                photos.join(",")
            )
        })
        .collect();
    let cases: Vec<String> = i
        .cases
        .iter()
        .map(|c| {
            format!(
                "{{\"id\":{},\"patient\":{},\"title\":{},\"text\":{},\"at\":{:.0},\"sent\":{},\"result\":{}}}",
                c.id,
                c.patient.map(|x| x.to_string()).unwrap_or_else(|| "null".into()),
                json::quote(&c.title),
                json::quote(&c.text),
                c.at,
                json::quote(&c.sent),
                json::quote(&c.result)
            )
        })
        .collect();
    host::store_set("intern:patients", &format!("[{}]", pats.join(",")));
    host::store_set("intern:cases", &format!("[{}]", cases.join(",")));
    host::store_set("intern:next", &i.next.to_string());
}

fn intern_load() {
    let s = st();
    if !s.intern.loaded {
        s.intern.loaded = true;
        let i = &mut s.intern;
        if let Some(v) = host::store_get("intern:patients").and_then(|t| json::parse(&t)) {
            i.patients = v
                .arr()
                .iter()
                .map(|p| IPatient {
                    id: p.get("id").f() as u32,
                    name: p.get("name").text(),
                    born: p.get("born").text(),
                    sex: p.get("sex").text(),
                    added: p.get("added").f(),
                    notes: p.get("notes").arr().iter().map(|n| (n.arr().first().map(|x| x.f()).unwrap_or(0.0), n.arr().get(1).map(|x| x.text()).unwrap_or_default())).collect(),
                    photos: p.get("photos").arr().iter().map(|u| u.text()).filter(|u| u.starts_with("data:image/")).collect(),
                })
                .collect();
        }
        if let Some(v) = host::store_get("intern:cases").and_then(|t| json::parse(&t)) {
            i.cases = v
                .arr()
                .iter()
                .map(|c| ICase {
                    id: c.get("id").f() as u32,
                    patient: if c.get("patient").is_null() { None } else { Some(c.get("patient").f() as u32) },
                    title: c.get("title").text(),
                    text: c.get("text").text(),
                    at: c.get("at").f(),
                    sent: c.get("sent").text(),
                    result: c.get("result").text(),
                })
                .collect();
        }
        let top = i.patients.iter().map(|p| p.id).chain(i.cases.iter().map(|c| c.id)).max().unwrap_or(0);
        i.next = host::store_get("intern:next").and_then(|v| v.parse().ok()).unwrap_or(0).max(top + 1);
    }
    // the parts that need the server: who you are as a doctor, your conversations
    if signed_in(s) {
        let i = &mut s.intern;
        if i.me.needed() {
            i.me.busy = true;
            request(Want::Tool(Tool::Intern, 0), "GET", "/api/intern/me", "", 0);
        }
    }
    host::call("rtc", "listen");
    intern_tick();
}

fn intern_tick() {
    let s = st();
    if !s.intern.ticking {
        s.intern.ticking = true;
        host::timer(2500, T_INTERN);
    }
}

/// Every few seconds while Intern is open: the call's state, new messages in the open chat, the conversations.
fn intern_timer() {
    let s = st();
    s.intern.ticking = false;
    if !intern_open(s) {
        return;
    }
    if let Some(v) = host::call("rtc", "state").and_then(|t| json::parse(&t)) {
        s.intern.call = v;
    }
    if signed_in(s) && s.intern.me.data.as_ref().map(|d| !d.get("doctor").is_null()).unwrap_or(false) {
        if s.intern.tab == 3 {
            if let Some((k, _)) = s.intern.peer.clone() {
                let after = s.intern.msgs.last().map(|m| m.0).unwrap_or(0);
                request(Want::Tool(Tool::Intern, 4), "GET", &format!("/api/intern/messages?peer={}&after={}", url_encode(&k), after), "", 0);
            } else if !s.intern.conv.busy {
                s.intern.conv.busy = true;
                request(Want::Tool(Tool::Intern, 3), "GET", "/api/intern/conversations", "", 0);
            }
        }
    }
    intern_tick();
}

fn now_year() -> f64 {
    1970.0 + host::now() / 31_557_600_000.0
}

fn patient_age(p: &IPatient) -> Option<u32> {
    let y: f64 = p.born.get(0..4)?.parse().ok()?;
    let m: f64 = p.born.get(5..7).and_then(|x| x.parse().ok()).unwrap_or(6.0);
    let age = now_year() - (y + (m - 0.5) / 12.0);
    (0.0..=130.0).contains(&age).then_some(age as u32)
}

fn patient_by(i: &Intern, id: u32) -> Option<&IPatient> {
    i.patients.iter().find(|p| p.id == id)
}

/// A case as it may leave the browser: the patient's name and birth date out, their age and sex in.
fn case_for_panel(i: &Intern, c: &ICase) -> String {
    let mut text = c.text.clone();
    let mut head = String::new();
    if let Some(p) = c.patient.and_then(|id| patient_by(i, id)) {
        for part in p.name.split_whitespace().filter(|w| w.chars().count() >= 2) {
            text = replace_word(&text, part, "[name]");
        }
        if !p.born.is_empty() {
            text = text.replace(&p.born, "[date]");
        }
        let age = patient_age(p).map(|a| format!("{}-year-old ", a)).unwrap_or_default();
        let sex = if p.sex.is_empty() { "patient".to_string() } else { p.sex.to_lowercase() };
        head = format!("Patient: {}{}.\n", age, sex);
    }
    format!("{}{}", head, text.trim())
}

/// Every whole-word occurrence of `w` (any case) replaced.
fn replace_word(text: &str, w: &str, with: &str) -> String {
    let lower = text.to_lowercase();
    let wl = w.to_lowercase();
    let mut out = String::new();
    let mut i = 0;
    while let Some(j) = lower[i..].find(&wl) {
        let a = i + j;
        let b = a + wl.len();
        let before = lower[..a].chars().last().map(|c| c.is_alphanumeric()).unwrap_or(false);
        let after = lower[b..].chars().next().map(|c| c.is_alphanumeric()).unwrap_or(false);
        out.push_str(&text[i..a]);
        out.push_str(if before || after { &text[a..b] } else { with });
        i = b;
    }
    out.push_str(&text[i..]);
    out
}

// ---------------------------------------------------------------------------------------------- what comes back

fn intern_apply(w: u8, v: Value, err: Option<String>) {
    let s = st();
    let i = &mut s.intern;
    match w {
        0 => {
            if err.is_none() {
                let d = v.get("doctor");
                if !d.is_null() {
                    i.prof = [d.get("name").text(), d.get("specialty").text(), d.get("place").text(), d.get("bio").text()];
                    i.listed = d.get("listed").truthy();
                } else {
                    i.listed = true;
                }
            }
            put(&mut i.me, v, err);
        }
        1 => match err {
            Some(e) => i.prof_msg = e,
            None => {
                i.prof_msg = "Saved: colleagues can find you and write to you.".into();
                i.me = Slot { data: Some(v), err: None, busy: false };
            }
        },
        2 => put(&mut i.doctors, v, err),
        3 => put(&mut i.conv, v, err),
        4 => {
            if err.is_none() {
                for m in v.get("messages").arr() {
                    let id = m.get("id").f() as u64;
                    if !i.msgs.iter().any(|x| x.0 == id) {
                        i.msgs.push((id, m.get("mine").truthy(), m.get("text").text(), m.get("at").f()));
                    }
                }
            }
        }
        5 => {
            i.msg_busy = false;
            match err {
                Some(e) => i.msg_err = Some(e),
                None => {
                    i.msg.clear();
                    i.msg_err = None;
                    if let Some((k, _)) = i.peer.clone() {
                        let after = i.msgs.last().map(|m| m.0).unwrap_or(0);
                        request(Want::Tool(Tool::Intern, 4), "GET", &format!("/api/intern/messages?peer={}&after={}", url_encode(&k), after), "", 0);
                    }
                }
            }
        }
        6 => {
            i.diag_busy = false;
            match err {
                Some(e) => i.diag_err = Some(e),
                None => {
                    i.diag_err = None;
                    if let Some(c) = i.case_open.and_then(|id| i.cases.iter_mut().find(|c| c.id == id)) {
                        c.sent = v.get("sent").text();
                        c.result = v.get("text").text();
                    }
                    intern_save();
                }
            }
        }
        7 => {
            if err.is_none() {
                i.me = Slot::default();
                i.prof = Default::default();
                i.prof_msg = "Your profile and your messages are gone from the server.".into();
                i.me.busy = true;
                request(Want::Tool(Tool::Intern, 0), "GET", "/api/intern/me", "", 0);
            }
        }
        _ => {}
    }
}

/// A picture chosen for a patient's file, back from host.js as a data: URL.
fn intern_photo(token: u32, data: Vec<u8>) {
    let url = String::from_utf8(data).unwrap_or_default();
    if !url.starts_with("data:image/") {
        return;
    }
    let i = &mut st().intern;
    if let Some(p) = i.patients.iter_mut().find(|p| p.id == token) {
        p.photos.push(url);
        intern_save();
    }
}

// ---------------------------------------------------------------------------------------------- what is done

fn intern_update(a: u16, v: String) {
    let s = st();
    let signed = signed_in(s);
    let i = &mut s.intern;
    let now = host::now();
    // deleting takes two presses, so that a stray tap deletes nothing
    if matches!(a, 21 | 38 | 66) {
        if !matches!(i.arm, Some((k, at)) if k == a && now - at < 4000.0) {
            i.arm = Some((a, now));
            return;
        }
        i.arm = None;
    } else {
        i.arm = None;
    }
    match a {
        1 => {
            i.tab = v.parse().unwrap_or(0);
            if i.tab == 2 && signed && i.doctors.needed() {
                i.doctors.busy = true;
                request(Want::Tool(Tool::Intern, 2), "GET", "/api/intern/doctors", "", 0);
            }
            if i.tab == 3 && signed && i.peer.is_none() {
                i.conv.busy = true;
                request(Want::Tool(Tool::Intern, 3), "GET", "/api/intern/conversations", "", 0);
            }
        }
        // patients
        10 => i.q = v,
        11 => {
            i.open = v.parse().ok();
            i.note.clear();
        }
        12 => i.open = None,
        13 => i.adding = !i.adding,
        14..=16 => i.form[(a - 14) as usize] = v.chars().take(120).collect(),
        18 => {
            let name = i.form[0].trim().to_string();
            if name.is_empty() {
                return;
            }
            let id = i.next;
            i.next += 1;
            i.patients.insert(0, IPatient { id, name, born: i.form[1].trim().to_string(), sex: i.form[2].trim().to_string(), added: now, notes: Vec::new(), photos: Vec::new() });
            i.form = Default::default();
            i.adding = false;
            i.open = Some(id);
            intern_save();
        }
        19 => i.note = v,
        20 => {
            let t = i.note.trim().to_string();
            if let (false, Some(p)) = (t.is_empty(), i.open.and_then(|id| i.patients.iter_mut().find(|p| p.id == id))) {
                p.notes.push((now, t));
                i.note.clear();
                intern_save();
            }
        }
        21 => {
            if let Some(id) = i.open.take() {
                i.patients.retain(|p| p.id != id);
                for c in i.cases.iter_mut().filter(|c| c.patient == Some(id)) {
                    c.patient = None;
                }
                intern_save();
            }
        }
        22 => {
            if let Some(id) = i.open {
                for line in v.lines() {
                    if let Some(h) = line.split('\t').next().and_then(|h| h.parse::<u32>().ok()) {
                        host::call("imgurl", &format!("{}\t{}\t900", INTERN_TOKEN + id, h));
                    }
                }
            }
        }
        23 => {
            let k: usize = v.parse().unwrap_or(usize::MAX);
            if let Some(p) = i.open.and_then(|id| i.patients.iter_mut().find(|p| p.id == id)) {
                if k < p.photos.len() {
                    p.photos.remove(k);
                    intern_save();
                }
            }
        }
        // cases
        30 => {
            let id = i.next;
            i.next += 1;
            let patient = v.parse::<u32>().ok().filter(|p| i.patients.iter().any(|x| x.id == *p));
            i.cases.insert(0, ICase { id, patient, title: String::new(), text: String::new(), at: now, sent: String::new(), result: String::new() });
            i.case_open = Some(id);
            i.tab = 1;
            i.diag_err = None;
            intern_save();
        }
        31 => {
            i.case_open = v.parse().ok();
            i.diag_err = None;
        }
        32 => i.case_open = None,
        33 | 34 | 35 => {
            if let Some(c) = i.case_open.and_then(|id| i.cases.iter_mut().find(|c| c.id == id)) {
                match a {
                    33 => c.title = v.chars().take(160).collect(),
                    34 => c.text = v.chars().take(6000).collect(),
                    _ => c.patient = v.parse().ok(),
                }
                intern_save();
            }
        }
        36 => i.consent = !i.consent,
        37 => {
            let Some(c) = i.case_open.and_then(|id| i.cases.iter().find(|c| c.id == id)).cloned() else { return };
            if !i.consent {
                i.diag_err = Some("Tick that the case may go to outside AI models first.".into());
                return;
            }
            let case = case_for_panel(i, &c);
            i.diag_busy = true;
            i.diag_err = None;
            let body = format!("{{\"case\":{},\"consent\":true}}", json::quote(&case));
            request(Want::Tool(Tool::Intern, 6), "POST", "/api/intern/diagnose", &body, 0);
        }
        38 => {
            if let Some(id) = i.case_open.take() {
                i.cases.retain(|c| c.id != id);
                intern_save();
            }
        }
        // doctors and chat
        50 => i.dq = v,
        51 => {
            i.doctors.busy = true;
            request(Want::Tool(Tool::Intern, 2), "GET", &format!("/api/intern/doctors?q={}", url_encode(&i.dq)), "", 0);
        }
        52 => {
            let (k, n) = v.split_once('\t').map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or((v.clone(), String::new()));
            i.peer = Some((k.clone(), n));
            i.msgs.clear();
            i.msg_err = None;
            i.tab = 3;
            request(Want::Tool(Tool::Intern, 4), "GET", &format!("/api/intern/messages?peer={}", url_encode(&k)), "", 0);
        }
        53 => i.msg = v.chars().take(2000).collect(),
        54 => {
            let t = i.msg.trim().to_string();
            if let (false, false, Some((k, _))) = (t.is_empty(), i.msg_busy, i.peer.clone()) {
                i.msg_busy = true;
                let body = format!("{{\"to\":{},\"text\":{}}}", json::quote(&k), json::quote(&t));
                request(Want::Tool(Tool::Intern, 5), "POST", "/api/intern/messages", &body, 0);
            }
        }
        55 => {
            i.peer = None;
            i.conv.busy = true;
            request(Want::Tool(Tool::Intern, 3), "GET", "/api/intern/conversations", "", 0);
        }
        // your profile
        60..=63 => i.prof[(a - 60) as usize] = v.chars().take(if a == 63 { 500 } else { 80 }).collect(),
        64 => i.listed = !i.listed,
        65 => {
            let body = format!(
                "{{\"name\":{},\"specialty\":{},\"place\":{},\"bio\":{},\"listed\":{}}}",
                json::quote(&i.prof[0]),
                json::quote(&i.prof[1]),
                json::quote(&i.prof[2]),
                json::quote(&i.prof[3]),
                i.listed
            );
            i.prof_msg = "Saving…".into();
            request(Want::Tool(Tool::Intern, 1), "PUT", "/api/intern/me", &body, 0);
        }
        66 => request(Want::Tool(Tool::Intern, 7), "DELETE", "/api/intern/me", "", 0),
        // calls (host.js does the call; the page shows it)
        70 => {
            host::call("rtc", &format!("call\t{}", v));
        }
        71 => {
            host::call("rtc", "accept");
        }
        72 => {
            host::call("rtc", "hangup");
        }
        73 => {
            host::call("rtc", "mute");
        }
        _ => {}
    }
    if let Some(v) = host::call("rtc", "state").and_then(|t| json::parse(&t)) {
        st().intern.call = v;
    }
}

// ---------------------------------------------------------------------------------------------- the view

fn armed(i: &Intern, a: u16, label: &str) -> String {
    match i.arm {
        Some((k, at)) if k == a && host::now() - at < 4000.0 => "Press again to delete".to_string(),
        _ => label.to_string(),
    }
}

fn when(ms: f64) -> String {
    date_of_epoch(ms / 1000.0)
}

fn intern_view(s: &State) -> N {
    let i = &s.intern;
    let tabs = el("div").cls("seg intern-tabs").attr("role", "tablist").kids(INTERN_TABS.iter().enumerate().map(|(k, t)| -> N {
        el("button").attr("type", "button").attr("role", "tab").cls_if(i.tab as usize == k, "on").on("click", Msg::T(Tool::Intern, 1, k.to_string())).text(*t).into()
    }));
    let body = match i.tab {
        0 => patients_view(i),
        1 => cases_view(i),
        2 => doctors_view(s),
        3 => chat_view(s),
        _ => intern_profile_view(s),
    };
    el("div")
        .cls("tool intern")
        .kid(el("p").cls("lede").text("Assist Diagnosis: patients and their files, cases with a differential from the Super AI panel, and colleagues to message and call."))
        .kid(el("p").cls("intern-applink").kid(el("a").attr("href", "/intern/").attr("target", "_blank").attr("rel", "noopener").text("Open Intern as an app ↗")).kid(txt(" On a phone, then choose Add to Home Screen (iPhone: Share; Android: the ⋮ menu).")))
        .kid(call_view(i))
        .kid(tabs)
        .kid(body)
        .into()
}

/// Intern as an app (at /intern/): a title bar, the tab's content, and the tabs along the bottom, as on a phone.
fn intern_app_view(s: &State) -> N {
    let i = &s.intern;
    const ICONS: [&str; 5] = [
        // patients, cases, doctors, chat, profile
        "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
        "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6",
        "M5 3v6a5 5 0 0 0 10 0V3M10 14v2a5 5 0 0 0 10 0v-3M20 13a2 2 0 1 0 0-4a2 2 0 0 0 0 4z",
        "M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z",
        "M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
    ];
    let body = match i.tab {
        0 => patients_view(i),
        1 => cases_view(i),
        2 => doctors_view(s),
        3 => chat_view(s),
        _ => intern_profile_view(s),
    };
    el("div")
        .cls("iapp")
        .kid(
            el("header")
                .cls("iapp-top")
                .kid(el("b").text(INTERN_TABS[i.tab as usize % INTERN_TABS.len()]))
                .kid(el("span").cls("iapp-brand").text("Intern")),
        )
        .kid(el("main").cls("iapp-main tool intern").kid(call_view(i)).kid(body))
        .kid(el("nav").cls("iapp-tabs").attr("role", "tablist").kids(INTERN_TABS.iter().enumerate().map(|(k, t)| -> N {
            el("button")
                .attr("type", "button")
                .attr("role", "tab")
                .attr("aria-selected", if i.tab as usize == k { "true" } else { "false" })
                .cls_if(i.tab as usize == k, "on")
                .on("click", Msg::T(Tool::Intern, 1, k.to_string()))
                .kid(
                    el("svg:svg")
                        .attr("viewBox", "0 0 24 24")
                        .attr("aria-hidden", "true")
                        .kid(el("svg:path").attr("d", ICONS[k])),
                )
                .kid(el("span").text(*t))
                .into()
        })))
        .into()
}

fn patients_view(i: &Intern) -> N {
    if let Some(p) = i.open.and_then(|id| patient_by(i, id)) {
        return patient_file(i, p);
    }
    let q = i.q.trim().to_lowercase();
    let list: Vec<&IPatient> = i.patients.iter().filter(|p| q.is_empty() || p.name.to_lowercase().contains(&q)).collect();
    let mut root = el("div")
        .kid(el("p").cls("hint").text("Patients are kept in this browser only: nothing about them is sent to the server."))
        .kid(
            el("div")
                .cls("row intern-bar")
                .kid(el("input").cls("input").attr("type", "search").attr("placeholder", "Find a patient").attr("aria-label", "Find a patient").prop("value", i.q.clone()).on("input", Msg::TV(Tool::Intern, 10)))
                .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Intern, 13, String::new())).text(if i.adding { "Cancel" } else { "New patient" })),
        );
    if i.adding {
        let f = |k: usize, label: &str, kind: &str| -> N {
            el("label").cls("ifield").kid(el("span").text(label)).kid(el("input").cls("input").attr("type", kind).prop("value", i.form[k].clone()).on("input", Msg::TV(Tool::Intern, 14 + k as u16))).into()
        };
        root = root.kid(
            el("div")
                .cls("card intern-form")
                .kid(f(0, "Name", "text"))
                .kid(f(1, "Born", "date"))
                .kid(f(2, "Sex", "text"))
                .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Intern, 18, String::new())).text("Add")),
        );
    }
    if list.is_empty() {
        return root.kid(el("p").cls("hint").text(if i.patients.is_empty() { "No patients yet." } else { "No patient by that name." })).into();
    }
    root.kid(el("div").cls("intern-list").kids(list.iter().map(|p| -> N {
        let age = patient_age(p).map(|a| format!("{} y", a)).unwrap_or_default();
        el("button")
            .attr("type", "button")
            .cls("card intern-item")
            .on("click", Msg::T(Tool::Intern, 11, p.id.to_string()))
            .kid(el("b").text(p.name.clone()))
            .kid(el("span").cls("hint").text([age, p.sex.clone(), format!("{} notes", p.notes.len())].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(" · ")))
            .into()
    })))
    .into()
}

fn patient_file(i: &Intern, p: &IPatient) -> N {
    let age = patient_age(p).map(|a| format!("{} years", a)).unwrap_or_default();
    let cases: Vec<&ICase> = i.cases.iter().filter(|c| c.patient == Some(p.id)).collect();
    el("div")
        .cls("intern-file")
        .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 12, String::new())).text("← Patients"))
        .kid(el("h3").text(p.name.clone()))
        .kid(el("p").cls("hint").text([age, p.sex.clone(), if p.born.is_empty() { String::new() } else { format!("born {}", p.born) }, format!("added {}", when(p.added))].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(" · ")))
        .kid(el("h4").text("Notes"))
        .kid(el("div").cls("intern-notes").kids(p.notes.iter().rev().map(|(at, t)| -> N { el("div").cls("card intern-note").kid(el("span").cls("hint").text(when(*at))).kid(el("p").text(t.clone())).into() })))
        .kid(
            el("div")
                .cls("intern-add-note")
                .kid(el("textarea").cls("input").attr("rows", "3").attr("placeholder", "A note: history, findings, plan…").attr("aria-label", "A new note").prop("value", i.note.clone()).on("input", Msg::TV(Tool::Intern, 19)))
                .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Intern, 20, String::new())).text("Add the note")),
        )
        .kid(el("h4").text("Photos"))
        .kid(el("div").cls("intern-photos").kids(p.photos.iter().enumerate().map(|(k, u)| -> N {
            el("figure")
                .kid(el("img").attr("src", u.clone()).attr("alt", format!("Photo {}", k + 1)))
                .kid(el("button").attr("type", "button").cls("chip").on("click", Msg::T(Tool::Intern, 23, k.to_string())).text("Remove"))
                .into()
        })))
        .kid(el("label").cls("btn").kid(txt("Add photos")).kid(el("input").attr("type", "file").attr("accept", "image/*").attr("multiple", "").attr("hidden", "").on("files", Msg::TV(Tool::Intern, 22))))
        .kid(el("h4").text("Cases"))
        .kid(el("div").cls("chips").kids(cases.iter().map(|c| -> N { el("button").attr("type", "button").cls("chip").on("click", Msg::T(Tool::Intern, 31, c.id.to_string())).text(if c.title.is_empty() { "Untitled case".to_string() } else { c.title.clone() }).into() })))
        .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 30, p.id.to_string())).text("New case for this patient"))
        .kid(el("p").kid(el("button").attr("type", "button").cls("btn danger").on("click", Msg::T(Tool::Intern, 21, String::new())).text(armed(i, 21, "Delete this patient"))))
        .into()
}

fn cases_view(i: &Intern) -> N {
    if let Some(c) = i.case_open.and_then(|id| i.cases.iter().find(|c| c.id == id)) {
        return case_file(i, c);
    }
    let mut root = el("div").kid(
        el("div")
            .cls("row intern-bar")
            .kid(el("p").cls("hint").text("Case reports, kept in this browser. Ask the Super AI panel for a differential; the case goes out without the patient's name or dates."))
            .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Intern, 30, String::new())).text("New case")),
    );
    if i.cases.is_empty() {
        root = root.kid(el("p").cls("hint").text("No cases yet."));
    }
    root.kid(el("div").cls("intern-list").kids(i.cases.iter().map(|c| -> N {
        let who = c.patient.and_then(|id| patient_by(i, id)).map(|p| p.name.clone()).unwrap_or_default();
        el("button")
            .attr("type", "button")
            .cls("card intern-item")
            .on("click", Msg::T(Tool::Intern, 31, c.id.to_string()))
            .kid(el("b").text(if c.title.is_empty() { "Untitled case".to_string() } else { c.title.clone() }))
            .kid(el("span").cls("hint").text([who, when(c.at), if c.result.is_empty() { String::new() } else { "differential".into() }].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(" · ")))
            .into()
    })))
    .into()
}

fn case_file(i: &Intern, c: &ICase) -> N {
    let preview = case_for_panel(i, c);
    el("div")
        .cls("intern-file")
        .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 32, String::new())).text("← Cases"))
        .kid(el("label").cls("ifield").kid(el("span").text("Title")).kid(el("input").cls("input").attr("type", "text").attr("placeholder", "Fever and cough, three days").prop("value", c.title.clone()).on("input", Msg::TV(Tool::Intern, 33))))
        .kid(
            el("label").cls("ifield").kid(el("span").text("Patient")).kid(
                el("select")
                    .cls("input")
                    .on("change", Msg::TV(Tool::Intern, 35))
                    .kid(el("option").attr("value", "").prop("selected", if c.patient.is_none() { "true" } else { "" }).text("None"))
                    .kids(i.patients.iter().map(|p| -> N { el("option").attr("value", p.id.to_string()).prop("selected", if c.patient == Some(p.id) { "true" } else { "" }).text(p.name.clone()).into() })),
            ),
        )
        .kid(el("label").cls("ifield").kid(el("span").text("The case")).kid(el("textarea").cls("input").attr("rows", "9").attr("placeholder", "Presentation, history, examination, results so far…").prop("value", c.text.clone()).on("input", Msg::TV(Tool::Intern, 34))))
        .kid(el("h4").text("Differential diagnosis"))
        .kid(el("p").cls("hint").text("What would be sent (the patient's name and birth date out; the server also takes out dates, numbers, emails and links):"))
        .kid(el("pre").cls("intern-sent").text(if preview.is_empty() { "—".into() } else { preview }))
        .kid(el("label").cls("intern-consent").kid(el("input").attr("type", "checkbox").prop("checked", if i.consent { "1" } else { "0" }).on("change", Msg::T(Tool::Intern, 36, String::new()))).kid(txt(" The case, as above, may go to outside AI models (the Super AI panel).")))
        .kid(el("button").attr("type", "button").cls("btn primary").attr_if(i.diag_busy, "disabled", "").on("click", Msg::T(Tool::Intern, 37, String::new())).text(if i.diag_busy { "Asking the panel…" } else { "Ask for a differential" }))
        .kid_if(i.diag_err.is_some(), || el("p").cls("err-box").text(i.diag_err.clone().unwrap_or_default()).into())
        .kid_if(!c.result.is_empty(), || el("div").cls("card intern-result").kid(markdown(&c.result)).kid(el("p").cls("hint").text("Support for your judgement, not a diagnosis.")).into())
        .kid(el("p").kid(el("button").attr("type", "button").cls("btn danger").on("click", Msg::T(Tool::Intern, 38, String::new())).text(armed(i, 38, "Delete this case"))))
        .into()
}

fn need_doctor(s: &State) -> Option<N> {
    if !signed_in(s) {
        return Some(el("p").cls("hint").kid(txt("Sign in (ORCID or a wallet) to find colleagues, message and call them. ")).kid(el("a").attr("href", if s.app_mode { "/#/account" } else { "#/account" }).text("Sign in")).into());
    }
    let i = &s.intern;
    match i.me.data.as_ref() {
        None => Some(spinner("")),
        Some(d) if d.get("doctor").is_null() => Some(el("p").cls("hint").kid(txt("Make your doctor's profile first, in ")).kid(el("button").attr("type", "button").cls("linkish").on("click", Msg::T(Tool::Intern, 1, "4".into())).text("Profile")).kid(txt(".")).into()),
        _ => None,
    }
}

fn doctors_view(s: &State) -> N {
    if let Some(n) = need_doctor(s) {
        return n;
    }
    let i = &s.intern;
    let list = match i.doctors.data.as_ref() {
        None if i.doctors.err.is_some() => failure(i.doctors.err.as_deref().unwrap_or("")),
        None => spinner("Finding doctors"),
        Some(d) => {
            let ds = d.get("doctors").arr();
            if ds.is_empty() {
                el("p").cls("hint").text("No doctor matches yet.").into()
            } else {
                el("div").cls("intern-list").kids(ds.iter().map(|d| -> N {
                    let key = d.get("key").text();
                    let name = d.get("name").text();
                    el("div")
                        .cls("card intern-doc")
                        .kid(el("div").kid(el("b").text(name.clone())).kid_if(d.get("online").truthy(), || el("span").cls("intern-dot").attr("title", "Online").into()))
                        .kid(el("span").cls("hint").text([d.get("specialty").text(), d.get("place").text()].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(" · ")))
                        .kid_if(!d.get("bio").str().is_empty(), || el("p").text(d.get("bio").text()).into())
                        .kid(
                            el("div")
                                .cls("row")
                                .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 52, format!("{}\t{}", key, name))).text("Message"))
                                .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 70, format!("{}\t0\t{}", key, name))).text("Call"))
                                .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 70, format!("{}\t1\t{}", key, name))).text("Video call")),
                        )
                        .into()
                }))
                .into()
            }
        }
    };
    el("div")
        .kid(
            el("div")
                .cls("row intern-bar")
                .kid(el("input").cls("input").attr("type", "search").attr("placeholder", "Name, specialty or place").attr("aria-label", "Find a doctor").prop("value", i.dq.clone()).on("input", Msg::TV(Tool::Intern, 50)).on("enter", Msg::T(Tool::Intern, 51, String::new())))
                .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Intern, 51, String::new())).text("Find")),
        )
        .kid(list)
        .into()
}

fn chat_view(s: &State) -> N {
    if let Some(n) = need_doctor(s) {
        return n;
    }
    let i = &s.intern;
    let Some((key, name)) = i.peer.clone() else {
        let list = match i.conv.data.as_ref() {
            None => spinner(""),
            Some(d) => {
                let cs = d.get("conversations").arr();
                if cs.is_empty() {
                    el("p").cls("hint").text("No conversations yet: find a colleague in Doctors.").into()
                } else {
                    el("div").cls("intern-list").kids(cs.iter().map(|c| -> N {
                        el("button")
                            .attr("type", "button")
                            .cls("card intern-item")
                            .on("click", Msg::T(Tool::Intern, 52, format!("{}\t{}", c.get("key").text(), c.get("name").text())))
                            .kid(el("b").text(c.get("name").text()))
                            .kid(el("span").cls("hint").text(format!("{}{}", if c.get("mine").truthy() { "You: " } else { "" }, c.get("last").text())))
                            .into()
                    }))
                    .into()
                }
            }
        };
        return el("div").kid(list).into();
    };
    el("div")
        .cls("intern-chat")
        .kid(
            el("div")
                .cls("row intern-bar")
                .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 55, String::new())).text("← Chats"))
                .kid(el("b").text(name.clone()))
                .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 70, format!("{}\t0\t{}", key, name))).text("Call"))
                .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 70, format!("{}\t1\t{}", key, name))).text("Video")),
        )
        .kid(el("p").cls("hint").text("Do not write anything that identifies a patient here: messages are kept on the server."))
        .kid(el("div").cls("chat").attr("aria-live", "polite").kids(i.msgs.iter().map(|(_, mine, t, _)| -> N { el("div").cls("chat-msg").cls(if *mine { "you" } else { "ai" }).text(t.clone()).into() })))
        .kid(
            el("div")
                .cls("row chat-form")
                .kid(el("input").attr("type", "text").attr("placeholder", "Write a message").attr("aria-label", "Your message").prop("value", i.msg.clone()).on("input", Msg::TV(Tool::Intern, 53)).on("enter", Msg::T(Tool::Intern, 54, String::new())))
                .kid(el("button").attr("type", "button").cls("btn primary").attr_if(i.msg_busy, "disabled", "").on("click", Msg::T(Tool::Intern, 54, String::new())).text("Send")),
        )
        .kid_if(i.msg_err.is_some(), || el("p").cls("err-box").text(i.msg_err.clone().unwrap_or_default()).into())
        .into()
}

fn intern_profile_view(s: &State) -> N {
    if !signed_in(s) {
        return need_doctor(s).unwrap_or_else(|| txt(""));
    }
    let i = &s.intern;
    let has = i.me.data.as_ref().map(|d| !d.get("doctor").is_null()).unwrap_or(false);
    let f = |k: usize, label: &str, ph: &str| -> N {
        el("label").cls("ifield").kid(el("span").text(label)).kid(el("input").cls("input").attr("type", "text").attr("placeholder", ph).prop("value", i.prof[k].clone()).on("input", Msg::TV(Tool::Intern, 60 + k as u16))).into()
    };
    el("div")
        .cls("card intern-form")
        .kid(el("p").cls("hint").text("Your doctor's profile: how colleagues find you, message you and call you."))
        .kid(f(0, "Name", "Dr Ada Rossi"))
        .kid(f(1, "Specialty", "Cardiology"))
        .kid(f(2, "Place", "Rome, Policlinico"))
        .kid(el("label").cls("ifield").kid(el("span").text("About")).kid(el("textarea").cls("input").attr("rows", "3").prop("value", i.prof[3].clone()).on("input", Msg::TV(Tool::Intern, 63))))
        .kid(el("label").cls("intern-consent").kid(el("input").attr("type", "checkbox").prop("checked", if i.listed { "1" } else { "0" }).on("change", Msg::T(Tool::Intern, 64, String::new()))).kid(txt(" List me in Doctors")))
        .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Intern, 65, String::new())).text(if has { "Save" } else { "Make my profile" }))
        .kid(el("p").cls("hint").text(i.prof_msg.clone()))
        .kid_if(has, || el("button").attr("type", "button").cls("btn danger").on("click", Msg::T(Tool::Intern, 66, String::new())).text(armed(i, 66, "Delete my profile and messages")).into())
        .into()
}

/// The call, when there is one: ringing, calling, connected; the video, when it is a video call.
fn call_view(i: &Intern) -> N {
    let c = &i.call;
    let state = c.get("state").str();
    if state.is_empty() || state == "idle" {
        return txt("");
    }
    let name = c.get("name").text().or_text("A colleague");
    let video = c.get("video").truthy();
    let label = match state {
        "ringing" => format!("{} is calling{}", name, if video { " (video)" } else { "" }),
        "calling" => format!("Calling {}…", name),
        "connected" => format!("In a call with {}", name),
        "ended" => format!("The call ended{}", if c.get("error").str().is_empty() { String::new() } else { format!(": {}", c.get("error").text()) }),
        _ => state.to_string(),
    };
    el("div")
        .cls("card intern-call")
        .cls(state)
        .kid(el("b").text(label))
        .kid_if(video && matches!(state, "connected" | "calling"), || {
            el("div").cls("intern-videos").kid(el("video").attr("id", "intern-remote").attr("autoplay", "").attr("playsinline", "")).kid(el("video").attr("id", "intern-local").attr("autoplay", "").attr("playsinline", "").attr("muted", "")).into()
        })
        .kid(
            el("div")
                .cls("row")
                .kid_if(state == "ringing", || el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Intern, 71, String::new())).text("Answer").into())
                .kid_if(matches!(state, "connected"), || el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Intern, 73, String::new())).text(if c.get("muted").truthy() { "Unmute" } else { "Mute" }).into())
                .kid(el("button").attr("type", "button").cls("btn danger").on("click", Msg::T(Tool::Intern, 72, String::new())).text(match state {
                    "ringing" => "Decline",
                    "ended" => "Close",
                    _ => "Hang up",
                })),
        )
        .into()
}

const INTERN_CSS: &str = "\
.intern-app-root{position:fixed;inset:0;background:var(--paper)}\
.iapp{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--paper);overscroll-behavior:none}\
.iapp-top{flex:none;display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:calc(env(safe-area-inset-top) + 12px) 18px 10px;border-bottom:1px solid var(--line);background:var(--paper)}\
.iapp-top b{font-size:22px;letter-spacing:-.01em}.iapp-brand{color:var(--accent);font-weight:600;font-size:14px}\
.iapp-main{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 16px 24px;touch-action:pan-y}\
.iapp-main .lede{display:none}\
.iapp-tabs{flex:none;display:grid;grid-template-columns:repeat(5,1fr);border-top:1px solid var(--line);background:var(--card);padding:6px 4px calc(env(safe-area-inset-bottom) + 6px)}\
.iapp-tabs button{border:0;background:none;display:grid;justify-items:center;gap:3px;padding:4px 0;font:inherit;font-size:11px;color:var(--muted);cursor:pointer}\
.iapp-tabs svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}\
.iapp-tabs button.on{color:var(--accent)}\
.iapp-top,.iapp-tabs{border-radius:0!important;clip-path:none!important;-webkit-mask:none!important;mask:none!important;border-left:0;border-right:0}\
.intern-applink{margin:-4px 0 12px;font-size:14px}\
@media (min-width:700px){.iapp{max-width:560px;margin:0 auto;border-left:1px solid var(--line);border-right:1px solid var(--line)}}\
.intern-tabs{margin-top:6px;overflow-x:auto;max-width:100%;scrollbar-width:none}\
.intern-bar{align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 12px}.intern-bar .input{flex:1;min-width:160px}\
.intern-list{display:grid;gap:10px}.intern-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;cursor:pointer;width:100%;padding:12px 14px}\
.intern-form{display:grid;gap:10px;margin-bottom:14px;padding:14px}.ifield{display:grid;gap:4px}.ifield span{font-size:13px;color:var(--muted)}\
.intern-file h3{margin:12px 0 2px}.intern-file h4{margin:18px 0 8px}.intern-notes{display:grid;gap:8px}.intern-note p{margin:4px 0 0;white-space:pre-wrap}\
.intern-add-note{display:grid;gap:8px;margin-top:10px}\
.intern-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:10px}.intern-photos figure{margin:0;display:grid;gap:4px}.intern-photos img{width:100%;aspect-ratio:1;object-fit:cover;border:1.5px solid #2b2b2b}\
.intern-sent{white-space:pre-wrap;background:#fbfbf9;border:1px solid var(--line2);padding:10px;font-size:13px;max-height:220px;overflow:auto}\
.intern-consent{display:flex;gap:8px;align-items:flex-start;margin:10px 0}\
.intern-result{margin-top:12px;padding:14px}.btn.danger{color:var(--bad);border-color:var(--bad)}\
.intern-doc{display:grid;gap:6px;padding:12px 14px}.intern-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#2e9e5b;margin-left:8px}\
.intern-call{position:sticky;top:0;z-index:5;display:grid;gap:10px;padding:14px;margin-bottom:12px;border-color:var(--accent)}\
.intern-call.ringing{animation:lockblink 1.2s ease-in-out infinite}\
.intern-videos{display:grid;grid-template-columns:3fr 1fr;gap:8px}.intern-videos video{width:100%;background:#111;aspect-ratio:4/3;object-fit:cover}\
.linkish{border:0;background:none;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer;font:inherit}\
@media (max-width:699px){.intern-videos{grid-template-columns:1fr}}\
";
