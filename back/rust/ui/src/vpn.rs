// piii VPN: the client for your own VPN service (back/vpn-server), here on the site (owner, 2026-10-16: "I want to
// make my own VPN provider. Make an app for it and merge it to the tools"; "make it web-based client and user
// interface on the site"). Included into app.rs.
//
// The page talks to the person's own server, at the name they type once (kept in this browser). It signs in with a
// token the server hands back, kept here as `pvpn_token:<server>`; host.js adds it, and the X-PVPN header the server
// asks for, to requests to that server's /api/pvpn/ (the server lets only piii.app ask from a browser). Everyone sees
// their plan, usage and devices, adds a device (a QR code and a file for the WireGuard app, shown once) or removes
// one; the owner also sees the people, every device, invite codes and the settings. The server re-checks all of it on
// every call. The tunnel itself is the WireGuard app on each device: a page cannot carry a device's internet.

#[derive(Default)]
pub struct Vpn {
    /// the server, as https://name (kept in this browser), and what is being typed for it
    server: String,
    server_in: String,
    token: String,
    public: Slot,
    me: Slot,
    devices: Slot,
    overview: Slot,
    // signing in and joining
    joining: bool,
    name: String,
    pw: String,
    invite: String,
    note: String,
    msg: (String, &'static str),
    busy: bool,
    // your devices
    dev_name: String,
    conf: Option<Value>,
    /// a button pressed once that asks "sure?" (its key); the second press acts
    sure: String,
    tab: u8,
    // the owner: a person's plan being edited, invites, settings
    edit: Option<(i64, String, String)>,
    inv: [String; 5],
    inv_made: String,
    set: [String; 5],
    set_loaded: bool,
    // your password
    pw_old: String,
    pw_new: String,
    // the set-up guide (nothing of it is kept)
    g_domain: String,
    g_admin: String,
    g_duck: String,
    guide: bool,
    ticking: bool,
}

const T_VPN: u32 = 37;

/// The name typed, as the server's address: https://name (http:// only when typed, for a server on this computer).
fn vpn_base(s: &str) -> String {
    let t = s.trim().trim_end_matches('/').to_lowercase();
    let (scheme, rest) = if let Some(r) = t.strip_prefix("https://") {
        ("https://", r)
    } else if let Some(r) = t.strip_prefix("http://") {
        ("http://", r)
    } else {
        ("https://", &t[..])
    };
    let host: String = rest.split(['/', '?', '#']).next().unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']')).collect();
    if host.is_empty() {
        return String::new();
    }
    // a bare DuckDNS name ("yourname"): its full name
    let host = if !host.contains(['.', ':']) && host != "localhost" { format!("{}.duckdns.org", host) } else { host };
    format!("{}{}", scheme, host)
}

fn vpn_key(server: &str) -> String {
    format!("pvpn_token:{}", server)
}

fn vpn_get(w: u8, path: &str) {
    let url = format!("{}{}", st().vpn.server, path);
    request(Want::Tool(Tool::Vpn, w), "GET", &url, "", 0);
}

fn vpn_send(w: u8, method: &str, path: &str, body: &str) {
    let url = format!("{}{}", st().vpn.server, path);
    request(Want::Tool(Tool::Vpn, w), method, &url, body, 0);
}

fn vpn_load() {
    let v = &mut st().vpn;
    if v.server.is_empty() {
        if let Some(sv) = host::store_get("pvpn_server") {
            v.server = sv.clone();
            v.server_in = sv.trim_start_matches("https://").to_string();
            v.token = host::store_get(&vpn_key(&sv)).unwrap_or_default();
        }
    }
    if v.server.is_empty() {
        return;
    }
    if v.public.needed() {
        v.public.busy = true;
        vpn_get(0, "/api/pvpn/public");
    }
    vpn_refresh();
    if !v.ticking {
        v.ticking = true;
        host::timer(30_000, T_VPN);
    }
}

/// What a signed-in person sees, fetched again (and the owner's view).
fn vpn_refresh() {
    let v = &mut st().vpn;
    if v.token.is_empty() {
        return;
    }
    v.me.busy = true;
    vpn_get(3, "/api/pvpn/me");
    let active = v.me.data.as_ref().map(|d| d.get("status").str() == "active").unwrap_or(true);
    if active {
        vpn_get(4, "/api/pvpn/devices");
    }
    if v.me.data.as_ref().map(|d| d.get("admin").truthy()).unwrap_or(false) {
        vpn_get(7, "/api/pvpn/admin/overview");
    }
}

fn vpn_open() -> bool {
    let s = st();
    matches!(s.page, Page::Item(g, m) if matches!(GROUPS.get(g as usize).and_then(|x| x.members.get(m as usize)), Some((_, Target::Tool(Tool::Vpn)))))
}

/// Every half minute while the window is open: who is online, and the usage.
fn vpn_tick() {
    let v = &mut st().vpn;
    v.ticking = false;
    if vpn_open() && !v.server.is_empty() {
        if v.conf.is_none() && v.edit.is_none() {
            vpn_refresh();
        }
        v.ticking = true;
        host::timer(30_000, T_VPN);
    }
}

fn vpn_signed_out(v: &mut Vpn) {
    host::store_del(&vpn_key(&v.server));
    v.token.clear();
    v.me.reset();
    v.devices.reset();
    v.overview.reset();
    v.conf = None;
    v.edit = None;
    v.set_loaded = false;
    v.tab = 0;
}

fn vpn_apply(w: u8, val: Value, err: Option<String>) {
    let s = st();
    let v = &mut s.vpn;
    v.busy = false;
    // the server no longer knows this sign-in (signed out elsewhere, turned off): back to the sign-in form
    if matches!(w, 3 | 4 | 7) && err.as_deref() == Some("Sign in first.") {
        vpn_signed_out(v);
        return;
    }
    match w {
        0 => put(&mut v.public, val, err.map(|e| format!("{} ({} answered this; is it a piii VPN server, and is it on?)", e, v.server.trim_start_matches("https://")))),
        1 => match err {
            Some(e) => v.msg = (e, "warn"),
            None => {
                v.token = val.get("token").text();
                host::store_set(&vpn_key(&v.server), &v.token);
                v.pw.clear();
                v.msg = (String::new(), "");
                vpn_refresh();
            }
        },
        2 => match err {
            Some(e) => v.msg = (e, "warn"),
            None => {
                if val.get("status").str() == "active" {
                    // in at once: sign in with what was just typed
                    let body = format!("{{\"name\":{},\"password\":{}}}", json::quote(v.name.trim()), json::quote(&v.pw));
                    v.busy = true;
                    vpn_send(1, "POST", "/api/pvpn/login", &body);
                } else {
                    v.msg = (val.get("message").text(), "ok");
                    v.pw.clear();
                    v.joining = false;
                }
            }
        },
        3 => {
            let admin = val.get("admin").truthy();
            let was = v.me.data.as_ref().map(|d| d.get("admin").truthy()).unwrap_or(false);
            put(&mut v.me, val, err);
            if admin && !was {
                vpn_get(7, "/api/pvpn/admin/overview");
            }
        }
        4 => put(&mut v.devices, val, err),
        5 => match err {
            Some(e) => v.msg = (e, "warn"),
            None => {
                v.conf = Some(val);
                v.dev_name.clear();
                v.msg = (String::new(), "");
                vpn_refresh();
            }
        },
        7 => {
            if !v.set_loaded && err.is_none() {
                let st_ = val.get("settings");
                v.set = [st_.get("provider").text(), st_.get("signup").text(), st_.get("default_gb").text(), st_.get("default_devices").text(), st_.get("default_days").text()];
                v.inv = [st_.get("default_gb").text(), st_.get("default_devices").text(), st_.get("default_days").text(), "1".into(), String::new()];
                v.set_loaded = true;
            }
            put(&mut v.overview, val, err);
        }
        10 => match err {
            Some(e) => v.msg = (e, "warn"),
            None => {
                v.inv_made = val.get("code").text();
                v.inv[4].clear();
                vpn_refresh();
            }
        },
        12 => {
            v.msg = match err {
                Some(e) => (e, "warn"),
                None => ("Saved.".into(), "ok"),
            };
            v.public.reset();
            vpn_load();
        }
        14 => vpn_signed_out(v),
        15 => match err {
            Some(e) => v.msg = (e, "warn"),
            None => {
                v.pw_old.clear();
                v.pw_new.clear();
                vpn_signed_out(v);
                v.msg = ("Password changed: sign in again.".into(), "ok");
            }
        },
        // the rest change something: show any failure, and fetch again
        _ => {
            match err {
                Some(e) => v.msg = (e, "warn"),
                None => v.msg = (String::new(), ""),
            }
            vpn_refresh();
        }
    }
}

fn vpn_update(a: u16, val: String) {
    let s = st();
    let v = &mut s.vpn;
    match a {
        // the server
        1 => v.server_in = val,
        2 => {
            let b = vpn_base(&v.server_in);
            if b.is_empty() {
                v.msg = ("Type your server's name, e.g. yourname.duckdns.org.".into(), "warn");
                return;
            }
            if b != v.server {
                vpn_signed_out(v);
                v.server = b.clone();
                v.token = host::store_get(&vpn_key(&b)).unwrap_or_default();
            }
            host::store_set("pvpn_server", &b);
            v.public.reset();
            v.msg = (String::new(), "");
            vpn_load();
        }
        3 => {
            vpn_signed_out(v);
            host::store_del("pvpn_server");
            v.server.clear();
            v.public.reset();
            v.msg = (String::new(), "");
        }
        // signing in, joining
        4 => v.name = val,
        5 => v.pw = val,
        6 => v.invite = val,
        7 => v.note = val,
        8 => {
            v.joining = !v.joining;
            v.msg = (String::new(), "");
        }
        9 => {
            if v.name.trim().is_empty() || v.pw.is_empty() {
                v.msg = ("Type your user name and password.".into(), "warn");
                return;
            }
            v.busy = true;
            let body = format!("{{\"name\":{},\"password\":{}}}", json::quote(v.name.trim()), json::quote(&v.pw));
            vpn_send(1, "POST", "/api/pvpn/login", &body);
        }
        10 => {
            if v.pw.chars().count() < 10 {
                v.msg = ("Use a password of at least 10 characters.".into(), "warn");
                return;
            }
            v.busy = true;
            let body = format!("{{\"name\":{},\"password\":{},\"invite\":{},\"note\":{}}}", json::quote(v.name.trim()), json::quote(&v.pw), json::quote(v.invite.trim()), json::quote(v.note.trim()));
            vpn_send(2, "POST", "/api/pvpn/signup", &body);
        }
        11 => vpn_send(14, "POST", "/api/pvpn/logout", ""),
        // your devices
        12 => v.dev_name = val,
        13 => {
            let n = if v.dev_name.trim().is_empty() { "Device".to_string() } else { v.dev_name.trim().to_string() };
            v.busy = true;
            vpn_send(5, "POST", "/api/pvpn/devices", &format!("{{\"name\":{}}}", json::quote(&n)));
        }
        14 => {
            let key = format!("dev:{}", val);
            if v.sure != key {
                v.sure = key;
                return;
            }
            v.sure.clear();
            vpn_send(6, "DELETE", &format!("/api/pvpn/devices/{}", val), "");
        }
        15 => {
            if let Some(c) = &v.conf {
                host::download(&c.get("file").text().or_text("piiivpn.conf"), "text/plain", c.get("conf").str().as_bytes());
            }
        }
        16 => v.conf = None,
        17 => {
            if let Some(c) = &v.conf {
                host::call("copy", c.get("conf").str());
            }
        }
        18 => {
            v.tab = val.parse().unwrap_or(0);
            v.sure.clear();
            v.msg = (String::new(), "");
        }
        19 => vpn_refresh(),
        // the owner: people
        20 => vpn_send(8, "POST", &format!("/api/pvpn/admin/users/{}", val), "{\"status\":\"active\"}"),
        21 => {
            let key = format!("off:{}", val);
            if v.sure != key {
                v.sure = key;
                return;
            }
            v.sure.clear();
            vpn_send(8, "POST", &format!("/api/pvpn/admin/users/{}", val), "{\"status\":\"disabled\"}");
        }
        22 => {
            let key = format!("del:{}", val);
            if v.sure != key {
                v.sure = key;
                return;
            }
            v.sure.clear();
            vpn_send(9, "DELETE", &format!("/api/pvpn/admin/users/{}", val), "");
        }
        23 => vpn_send(8, "POST", &format!("/api/pvpn/admin/users/{}", val), "{\"extend_days\":30}"),
        24 => vpn_send(8, "POST", &format!("/api/pvpn/admin/users/{}", val), "{\"until\":0}"),
        25 => {
            let key = format!("reset:{}", val);
            if v.sure != key {
                v.sure = key;
                return;
            }
            v.sure.clear();
            vpn_send(8, "POST", &format!("/api/pvpn/admin/users/{}", val), "{\"reset_usage\":true}");
        }
        26 => {
            // edit a plan: the person's id; its fields start from what it has now
            let id: i64 = val.parse().unwrap_or(0);
            let u = v.overview.data.as_ref().and_then(|d| d.get("users").arr().iter().find(|u| u.get("id").f() as i64 == id).cloned());
            if let Some(u) = u {
                v.edit = Some((id, gb_in(u.get("allowance").f()), u.get("max_devices").text()));
            }
        }
        27 => {
            if let Some(e) = &mut v.edit {
                e.1 = val;
            }
        }
        28 => {
            if let Some(e) = &mut v.edit {
                e.2 = val;
            }
        }
        29 => {
            if let Some((id, gb, dev)) = v.edit.take() {
                let body = format!("{{\"allowance_gb\":{},\"max_devices\":{}}}", num_or(&gb, 0.0), num_or(&dev, 5.0));
                vpn_send(8, "POST", &format!("/api/pvpn/admin/users/{}", id), &body);
            }
        }
        30 => v.edit = None,
        // invites
        n @ 31..=35 => v.inv[(n - 31) as usize] = val,
        36 => {
            let body = format!(
                "{{\"allowance_gb\":{},\"max_devices\":{},\"days\":{},\"uses\":{},\"note\":{}}}",
                num_or(&v.inv[0], 0.0),
                num_or(&v.inv[1], 5.0),
                num_or(&v.inv[2], 0.0),
                num_or(&v.inv[3], 1.0),
                json::quote(v.inv[4].trim())
            );
            v.inv_made.clear();
            vpn_send(10, "POST", "/api/pvpn/admin/invites", &body);
        }
        37 => vpn_send(11, "DELETE", &format!("/api/pvpn/admin/invites/{}", url_encode(&val)), ""),
        38 => {
            host::call("copy", &invite_link(&val));
            v.msg = ("Link copied: send it to them.".into(), "ok");
        }
        // settings
        n @ 41..=45 => v.set[(n - 41) as usize] = val,
        46 => {
            let body = format!(
                "{{\"provider\":{},\"signup\":{},\"default_gb\":{},\"default_devices\":{},\"default_days\":{}}}",
                json::quote(v.set[0].trim()),
                json::quote(&v.set[1]),
                num_or(&v.set[2], 0.0),
                num_or(&v.set[3], 5.0),
                num_or(&v.set[4], 0.0)
            );
            vpn_send(12, "POST", "/api/pvpn/admin/settings", &body);
        }
        // all devices: the owner removes one
        50 => {
            let key = format!("adev:{}", val);
            if v.sure != key {
                v.sure = key;
                return;
            }
            v.sure.clear();
            vpn_send(13, "DELETE", &format!("/api/pvpn/admin/devices/{}", val), "");
        }
        // the set-up guide
        60 => v.g_domain = val,
        61 => v.g_admin = val,
        62 => v.g_duck = val,
        63 => {
            host::call("copy", &install_cmd(v));
            v.msg = ("Copied: paste it on your server.".into(), "ok");
        }
        64 => v.guide = !v.guide,
        // your password
        70 => v.pw_old = val,
        71 => v.pw_new = val,
        72 => {
            if v.pw_new.chars().count() < 10 {
                v.msg = ("Use a new password of at least 10 characters.".into(), "warn");
                return;
            }
            let body = format!("{{\"old\":{},\"new\":{}}}", json::quote(&v.pw_old), json::quote(&v.pw_new));
            vpn_send(15, "POST", "/api/pvpn/password", &body);
        }
        _ => {}
    }
}

fn num_or(s: &str, d: f64) -> String {
    let n: f64 = s.trim().parse().unwrap_or(d);
    let n = if n.is_finite() && n >= 0.0 { n } else { d };
    format!("{}", n)
}

fn gb_in(b: f64) -> String {
    let g = b / 1e9;
    let r = (g + 0.5) as i64; // no_std: no f64::round; plans are never negative
    if (g - r as f64).abs() < 1e-9 { format!("{}", r) } else { format!("{:.2}", g) }
}

/// Bytes as people read them (25 GB, not 25.0 GB).
fn vgb(b: f64) -> String {
    vgb_(b).replace(".0 ", " ").replace(".00 ", " ")
}

fn vgb_(b: f64) -> String {
    if b >= 1e12 {
        format!("{:.2} TB", b / 1e12)
    } else if b >= 1e9 {
        format!("{:.1} GB", b / 1e9)
    } else if b >= 1e6 {
        format!("{:.1} MB", b / 1e6)
    } else if b >= 1e3 {
        format!("{:.0} kB", b / 1e3)
    } else {
        format!("{:.0} B", b)
    }
}

fn plan_text(allowance: f64) -> String {
    if allowance > 0.0 { format!("{} a month", vgb(allowance)) } else { "unlimited".into() }
}

fn until_text(t: f64) -> String {
    if t > 0.0 { date_of_epoch(t) } else { "no end".into() }
}

fn ago_text(t: f64) -> String {
    if t <= 0.0 {
        return "never".into();
    }
    let s = host::now() / 1000.0 - t;
    if s < 120.0 {
        "just now".into()
    } else if s < 3600.0 {
        format!("{:.0} min ago", s / 60.0)
    } else if s < 86400.0 {
        format!("{:.0} h ago", s / 3600.0)
    } else {
        date_of_epoch(t)
    }
}

fn invite_link(code: &str) -> String {
    format!("{}/?invite={}", st().vpn.server, url_encode(code))
}

fn install_cmd(v: &Vpn) -> String {
    let d = v.g_domain.trim().trim_start_matches("https://").trim_end_matches('/').to_lowercase();
    // the field asks for the DuckDNS name: "yourname" is yourname.duckdns.org
    let d = if d.is_empty() { "yourname.duckdns.org".to_string() } else if !d.contains('.') { format!("{}.duckdns.org", d) } else { d };
    let a = if v.g_admin.trim().is_empty() { "yourname".to_string() } else { v.g_admin.trim().to_lowercase() };
    let duck = if v.g_duck.trim().is_empty() { String::new() } else { format!(" PVPN_DUCKDNS_TOKEN={}", v.g_duck.trim()) };
    format!("git clone https://github.com/ex-tern/pi && cd pi\nsudo PVPN_DOMAIN={} PVPN_ADMIN={}{} bash back/vpn-server/install.sh\n\n# already have it? in that folder:  git pull  and then only the sudo line", d, a, duck)
}

// ---------------------------------------------------------------------------------------------- views

fn vbtn(label: &str, a: u16, val: String) -> El<Msg> {
    el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Vpn, a, val)).text(label.to_string())
}

fn vfield(label: &str, kind: &'static str, value: &str, a: u16) -> N {
    el("label")
        .cls("vp-f")
        .kid(el("span").text(label.to_string()))
        .kid(el("input").attr("type", kind).prop("value", value.to_string()).on("input", Msg::TV(Tool::Vpn, a)))
        .into()
}

fn vstat(big: String, small: String) -> N {
    el("div").cls("vp-stat").kid(el("b").text(big)).kid(el("span").text(small)).into()
}

fn vmsg(v: &Vpn) -> N {
    el("p").cls("vp-msg").cls(v.msg.1).attr("role", "status").text(v.msg.0.clone()).into()
}

fn vpn_view(s: &State) -> N {
    let v = &s.vpn;
    // through Tailscale first (no router needed); a WireGuard server of your own below
    let mut root = el("div").cls("tool vp").kid(ts_view(s)).kid(el("h3").cls("vp-own").text("Or: your own WireGuard server"));
    if v.server.is_empty() {
        return root.kid(connect_view(v)).kid(guide_view(v, true)).into();
    }
    // the server's name, and a way to change it
    let provider = v.public.data.as_ref().map(|d| d.get("provider").text()).unwrap_or_default();
    root = root.kid(
        el("div")
            .cls("vp-top")
            .kid(el("span").cls("vp-dot").cls_if(v.public.data.is_some(), "on").cls_if(v.public.err.is_some(), "bad"))
            .kid(el("b").text(if provider.is_empty() { "piii VPN".to_string() } else { provider }))
            .kid(el("span").cls("hint").text(v.server.trim_start_matches("https://").to_string()))
            .kid(vbtn("Change server", 3, String::new())),
    );
    if let Some(e) = &v.public.err {
        return root.kid(failure(e)).kid(el("p").cls("hint").text("Check the name, that the server is on, and that your router sends port 443 to it.")).kid(guide_view(v, false)).into();
    }
    if v.token.is_empty() {
        return root.kid(signin_view(v)).into();
    }
    let me = match (&v.me.data, &v.me.err) {
        (Some(d), _) => d,
        (None, Some(e)) => return root.kid(failure(e)).kid(vbtn("Sign out", 11, String::new())).into(),
        _ => return root.kid(spinner("Signing in…")).into(),
    };
    if me.get("status").str() != "active" {
        let pending = me.get("status").str() == "pending";
        return root
            .kid(el("h3").text(if pending { "Waiting for approval" } else { "Account turned off" }))
            .kid(el("p").cls("lede").text(if pending { "The owner of this server approves new accounts. Come back once they have." } else { "The owner has turned this account off." }))
            .kid(el("div").cls("row").kid(vbtn("Check again", 19, String::new())).kid(vbtn("Sign out", 11, String::new())))
            .into();
    }
    let admin = me.get("admin").truthy();
    if admin {
        let ov = v.overview.data.as_ref();
        let waiting = ov.map(|d| d.get("users").arr().iter().filter(|u| u.get("status").str() == "pending").count()).unwrap_or(0);
        let tabs: [(u8, String); 6] = [
            (0, "Your VPN".into()),
            (1, if waiting > 0 { format!("People · {} waiting", waiting) } else { "People".into() }),
            (2, "Devices".into()),
            (3, "Invites".into()),
            (4, "Settings".into()),
            (5, "Set up".into()),
        ];
        root = root.kid(el("div").cls("seg").attr("role", "tablist").kids(tabs.iter().map(|(i, l)| -> N {
            el("button").attr("type", "button").attr("role", "tab").cls_if(v.tab == *i, "on").on("click", Msg::T(Tool::Vpn, 18, format!("{}", i))).text(l.clone()).into()
        })));
    }
    let body = match (admin, v.tab) {
        (true, 1) => people_view(v),
        (true, 2) => all_devices_view(v),
        (true, 3) => invites_view(v),
        (true, 4) => settings_view(v),
        (true, 5) => guide_view(v, false),
        _ => mine_view(v, me, admin),
    };
    root.kid(body).kid(vmsg(v)).into()
}

fn connect_view(v: &Vpn) -> N {
    el("div")
        .kid(el("p").cls("lede").text("Your own VPN service, run from a computer at home. Connect to your server to manage your devices and, if it is yours, the people on it."))
        .kid(
            el("div")
                .cls("vp-row")
                .kid(el("label").cls("vp-f grow").kid(el("span").text("Your server")).kid(el("input").attr("type", "text").attr("placeholder", "yourname.duckdns.org").attr("autocomplete", "url").attr("spellcheck", "false").prop("value", v.server_in.clone()).on("input", Msg::TV(Tool::Vpn, 1))))
                .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Vpn, 2, String::new())).text("Connect")),
        )
        .kid(vmsg(v))
        .into()
}

fn signin_view(v: &Vpn) -> N {
    let signup = v.public.data.as_ref().map(|d| d.get("signup").text()).unwrap_or_default();
    let invite_only = signup == "invite";
    let mut f = el("div").cls("vp-card");
    if v.joining {
        f = f
            .kid(el("h3").text("Create an account"))
            .kid(el("p").cls("hint").text(if invite_only {
                "This server takes new people by invite code only."
            } else if signup == "open" {
                "Accounts are open: you can start right after."
            } else {
                "With an invite code you start at once; without one, the owner approves you first."
            }))
            .kid(vfield(if invite_only { "Invite code" } else { "Invite code (if you have one)" }, "text", &v.invite, 6))
            .kid(vfield("User name", "text", &v.name, 4))
            .kid(vfield("Password (10 characters or more)", "password", &v.pw, 5))
            .kid(vfield("A note for the owner (who you are)", "text", &v.note, 7))
            .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn primary").attr_if(v.busy, "disabled", "").on("click", Msg::T(Tool::Vpn, 10, String::new())).text("Create the account")).kid(vbtn("I have an account", 8, String::new())));
    } else {
        f = f
            .kid(el("h3").text("Sign in"))
            .kid(vfield("User name", "text", &v.name, 4))
            .kid(vfield("Password", "password", &v.pw, 5))
            .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn primary").attr_if(v.busy, "disabled", "").on("click", Msg::T(Tool::Vpn, 9, String::new())).text("Sign in")).kid(vbtn("Create an account", 8, String::new())));
    }
    f.kid(vmsg(v)).into()
}

fn mine_view(v: &Vpn, me: &Value, admin: bool) -> N {
    let used = me.get("used").f();
    let allowance = me.get("allowance").f();
    let blocked = me.get("blocked").text();
    let mut out = el("div");
    if !blocked.is_empty() {
        out = out.kid(el("p").cls("vp-warn").text(format!(
            "Your devices are off: {}.{}",
            blocked,
            if blocked.contains("used up") { " They come back on the 1st of next month, or when the owner raises your plan." } else { "" }
        )));
    }
    if !me.get("vpn").truthy() {
        out = out.kid(el("p").cls("vp-warn").text("This server runs without its VPN (development mode): devices are kept but do not connect."));
    }
    let pct = if allowance > 0.0 { (100.0 * used / allowance).min(100.0) } else { 0.0 };
    let devs = v.devices.data.as_ref();
    let n = devs.map(|d| d.get("devices").arr().len()).unwrap_or(0);
    let max = me.get("max_devices").f() as usize;
    out = out.kid(
        el("div")
            .cls("vp-stats")
            .kid(
                el("div")
                    .cls("vp-stat")
                    .kid(el("b").text(vgb(used)))
                    .kid(el("span").text(format!("used in {} · {}", me.get("month").text(), plan_text(allowance))))
                    .kid_if(allowance > 0.0, || el("span").cls("vp-bar").cls_if(pct >= 100.0, "full").kid(el("i").style(format!("width:{:.0}%", pct))).into()),
            )
            .kid(vstat(format!("{} / {}", n, max), "devices".into()))
            .kid(vstat(until_text(me.get("until").f()), "access until".into())),
    );
    // a device just added: its QR code and file, shown once
    if let Some(c) = &v.conf {
        out = out.kid(
            el("div")
                .cls("vp-conf")
                .kid(el("img").attr("src", c.get("qr").text()).attr("alt", "QR code of the configuration").attr("width", "240").attr("height", "240"))
                .kid(
                    el("div")
                        .kid(el("h3").text(format!("{} is ready", c.get("name").text())))
                        .kid(el("p").cls("vp-warn").text("Shown once. Its key is not kept on the server: scan it or save the file now. If it is lost, remove the device and add it again."))
                        .kid_if(!c.get("blocked").str().is_empty(), || el("p").cls("hint").text(format!("It connects once your account is on again ({}).", c.get("blocked").text())).into())
                        .kid(el("ol").cls("vp-steps")
                            .kid(el("li").text("Install WireGuard: App Store, Google Play, or wireguard.com for computers."))
                            .kid(el("li").text("On a phone: + → Scan from QR code. On a computer: Import tunnel from file."))
                            .kid(el("li").text("Switch it on. To check, look up your IP address: it is now your server's.")))
                        .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn primary small").on("click", Msg::T(Tool::Vpn, 15, String::new())).text(format!("Download {}", c.get("file").text()))).kid(vbtn("Copy", 17, String::new())).kid(vbtn("Done", 16, String::new())))
                        .kid(el("details").kid(el("summary").cls("hint").text("Show the configuration")).kid(el("pre").cls("vp-pre").text(c.get("conf").text()))),
                ),
        );
    }
    let list = slot_view(&v.devices, "Loading your devices…", |d| {
        let ds = d.get("devices").arr();
        if ds.is_empty() {
            return el("p").cls("hint").text("No devices yet. Add your phone or computer below.").into();
        }
        el("div")
            .cls("vp-tw")
            .kid(
                el("table").cls("vp-t").kid(el("thead").kid(el("tr").kid(el("th").text("Device")).kid(el("th").text("Address")).kid(el("th").text("Data (all time)")).kid(el("th").text("Last seen")).kid(el("th")))).kid(el("tbody").kids(ds.iter().map(|x| -> N {
                    let id = x.get("id").text();
                    let sure = v.sure == format!("dev:{}", id);
                    el("tr")
                        .kid(el("td").kid(el("span").cls("vp-dot").cls_if(x.get("online").truthy(), "on")).kid(el("span").text(x.get("name").text())))
                        .kid(el("td").cls("n").text(x.get("ip").text()))
                        .kid(el("td").cls("n").text(format!("{} ↓ · {} ↑", vgb(x.get("tx").f()), vgb(x.get("rx").f()))))
                        .kid(el("td").text(if x.get("online").truthy() { "connected".into() } else { ago_text(x.get("handshake").f()) }))
                        .kid(el("td").kid(vbtn(if sure { "Sure? It stops connecting" } else { "Remove" }, 14, id).cls("danger")))
                        .into()
                }))),
            )
            .into()
    });
    out = out.kid(el("h3").text("Your devices")).kid(list).kid(
        el("div")
            .cls("vp-row")
            .kid(el("label").cls("vp-f grow").kid(el("span").text("New device")).kid(el("input").attr("type", "text").attr("maxlength", "40").attr("placeholder", "e.g. Phone").prop("value", v.dev_name.clone()).on("input", Msg::TV(Tool::Vpn, 12))))
            .kid(el("button").attr("type", "button").cls("btn primary").attr_if(n >= max || v.busy, "disabled", "").on("click", Msg::T(Tool::Vpn, 13, String::new())).text("Add a device")),
    );
    out = out.kid(
        el("details")
            .cls("vp-more")
            .kid(el("summary").text("Your account"))
            .kid(el("p").cls("hint").text(format!("Signed in as {}{}.", me.get("name").text(), if admin { ", the owner" } else { "" })))
            .kid(el("div").cls("vp-row").kid(vfield("Present password", "password", &v.pw_old, 70)).kid(vfield("New password", "password", &v.pw_new, 71)).kid(vbtn("Change password", 72, String::new())))
            .kid(el("div").cls("row").kid(vbtn("Refresh", 19, String::new())).kid(vbtn("Sign out", 11, String::new()))),
    );
    out.into()
}

fn people_view(v: &Vpn) -> N {
    slot_view(&v.overview, "Loading…", |d| {
        let sv = d.get("server");
        let users = d.get("users").arr();
        let mut out = el("div")
            .kid(
                el("div")
                    .cls("vp-stats")
                    .kid(vstat(sv.get("online").text(), "devices connected now".into()))
                    .kid(vstat(format!("{}", users.len()), "people".into()))
                    .kid(vstat(vgb(sv.get("month_bytes").f()), format!("through the VPN in {}", sv.get("month").text())))
                    .kid(el("div").cls("vp-stat addr").kid(el("b").cls("vp-code").text(sv.get("endpoint").text().or_text("not set"))).kid(el("span").text("public address"))),
            )
            .kid(el("p").cls("vp-warn").text("Everyone's traffic leaves from your home connection: what they do online looks as if it came from you. Let in only people you trust."));
        // a plan being edited
        if let Some((id, gb, dev)) = &v.edit {
            let who = users.iter().find(|u| u.get("id").f() as i64 == *id).map(|u| u.get("name").text()).unwrap_or_default();
            out = out.kid(
                el("div")
                    .cls("vp-card")
                    .kid(el("h3").text(format!("{}'s plan", who)))
                    .kid(el("div").cls("vp-row").kid(vfield("GB a month (0 = unlimited)", "number", gb, 27)).kid(vfield("Devices", "number", dev, 28)))
                    .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn primary small").on("click", Msg::T(Tool::Vpn, 29, String::new())).text("Save")).kid(vbtn("Cancel", 30, String::new()))),
            );
        }
        let rows = users.iter().map(|u| -> N {
            let id = u.get("id").text();
            let st_ = u.get("status").str();
            let blocked = u.get("blocked").text();
            let (pill, label) = if st_ == "pending" { ("wait", "waiting") } else if !blocked.is_empty() { ("off", "off") } else { ("on", "on") };
            let allowance = u.get("allowance").f();
            let used = u.get("used").f();
            let pct = if allowance > 0.0 { (100.0 * used / allowance).min(100.0) } else { 0.0 };
            let is_admin = u.get("admin").truthy();
            let mut acts = el("div").cls("row");
            if st_ != "active" {
                acts = acts.kid(el("button").attr("type", "button").cls("btn primary small").on("click", Msg::T(Tool::Vpn, 20, id.clone())).text("Approve"));
            } else if !is_admin {
                acts = acts.kid(vbtn(if v.sure == format!("off:{}", id) { "Sure?" } else { "Turn off" }, 21, id.clone()));
            }
            acts = acts.kid(vbtn("Plan", 26, id.clone())).kid(vbtn("+30 days", 23, id.clone()));
            if u.get("until").f() > 0.0 {
                acts = acts.kid(vbtn("No end", 24, id.clone()));
            }
            if used > 0.0 {
                acts = acts.kid(vbtn(if v.sure == format!("reset:{}", id) { "Sure?" } else { "Reset month" }, 25, id.clone()));
            }
            if !is_admin {
                acts = acts.kid(vbtn(if v.sure == format!("del:{}", id) { "Delete with their devices?" } else { "Delete" }, 22, id.clone()).cls("danger"));
            }
            el("tr")
                .kid(el("td").kid(el("b").text(u.get("name").text())).kid_if(is_admin, || el("span").cls("vp-pill").text("owner").into()).kid_if(!u.get("note").str().is_empty(), || el("div").cls("hint").text(u.get("note").text()).into()))
                .kid(el("td").kid(el("span").cls("vp-pill").cls(pill).text(label)).kid_if(!blocked.is_empty() && st_ != "pending", || el("div").cls("hint").text(blocked.clone()).into()))
                .kid(el("td").cls("n").text(format!("{} of {}", vgb(used), plan_text(allowance))).kid_if(allowance > 0.0, || el("span").cls("vp-bar").cls_if(pct >= 100.0, "full").kid(el("i").style(format!("width:{:.0}%", pct))).into()))
                .kid(el("td").cls("n").text(format!("{} on · {} of {}", u.get("online").text(), u.get("devices").text(), u.get("max_devices").text())))
                .kid(el("td").cls("n").text(until_text(u.get("until").f())))
                .kid(el("td").kid(acts))
                .into()
        });
        out = out.kid(el("div").cls("vp-tw").kid(el("table").cls("vp-t").kid(el("thead").kid(el("tr").kid(el("th").text("Person")).kid(el("th").text("State")).kid(el("th").text("This month")).kid(el("th").text("Devices")).kid(el("th").text("Access until")).kid(el("th")))).kid(el("tbody").kids(rows))));
        let log = d.get("log").arr();
        out = out.kid(el("details").cls("vp-more").kid(el("summary").text("What happened")).kids(log.iter().map(|l| -> N { el("div").cls("hint").text(format!("{} · {}", date_of_epoch(l.get("at").f()), l.get("what").text())).into() })));
        out.into()
    })
}

fn all_devices_view(v: &Vpn) -> N {
    slot_view(&v.overview, "Loading…", |d| {
        let ds = d.get("devices").arr();
        if ds.is_empty() {
            return el("p").cls("hint").text("No devices yet.").into();
        }
        el("div")
            .cls("vp-tw")
            .kid(el("table").cls("vp-t").kid(el("thead").kid(el("tr").kid(el("th").text("Device")).kid(el("th").text("Person")).kid(el("th").text("Address")).kid(el("th").text("Connects from")).kid(el("th").text("Data")).kid(el("th").text("Last seen")).kid(el("th")))).kid(el("tbody").kids(ds.iter().map(|x| -> N {
                let id = x.get("id").text();
                el("tr")
                    .kid(el("td").kid(el("span").cls("vp-dot").cls_if(x.get("online").truthy(), "on")).kid(el("span").text(x.get("name").text())))
                    .kid(el("td").text(x.get("owner").text()))
                    .kid(el("td").cls("n").text(x.get("ip").text()))
                    .kid(el("td").cls("n").text(x.get("endpoint").text().or_text("—")))
                    .kid(el("td").cls("n").text(format!("{} ↓ · {} ↑", vgb(x.get("tx").f()), vgb(x.get("rx").f()))))
                    .kid(el("td").text(if x.get("online").truthy() { "connected".into() } else { ago_text(x.get("handshake").f()) }))
                    .kid(el("td").kid(vbtn(if v.sure == format!("adev:{}", id) { "Sure?" } else { "Remove" }, 50, id).cls("danger")))
                    .into()
            }))))
            .into()
    })
}

fn invites_view(v: &Vpn) -> N {
    slot_view(&v.overview, "Loading…", |d| {
        let invs = d.get("invites").arr();
        el("div")
            .kid(el("p").cls("lede").text("A code lets someone in at once, with the plan you choose. Send them the link: it opens their sign-up on your server."))
            .kid(
                el("div")
                    .cls("vp-row")
                    .kid(vfield("GB a month (0 = unlimited)", "number", &v.inv[0], 31))
                    .kid(vfield("Devices", "number", &v.inv[1], 32))
                    .kid(vfield("Days (0 = no end)", "number", &v.inv[2], 33))
                    .kid(vfield("People it admits", "number", &v.inv[3], 34))
                    .kid(vfield("Note (for you)", "text", &v.inv[4], 35))
                    .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Vpn, 36, String::new())).text("Make a code")),
            )
            .kid_if(!v.inv_made.is_empty(), || {
                el("div")
                    .cls("vp-card")
                    .kid(el("p").kid(el("span").text("New code ")).kid(el("b").cls("vp-code").text(v.inv_made.clone())))
                    .kid(el("p").cls("vp-code hint").text(invite_link(&v.inv_made)))
                    .kid(vbtn("Copy the link", 38, v.inv_made.clone()))
                    .into()
            })
            .kid_if(!invs.is_empty(), || {
                el("div")
                    .cls("vp-tw")
                    .kid(el("table").cls("vp-t").kid(el("thead").kid(el("tr").kid(el("th").text("Code")).kid(el("th").text("Plan")).kid(el("th").text("Devices")).kid(el("th").text("Access")).kid(el("th").text("Left")).kid(el("th").text("Note")).kid(el("th")))).kid(el("tbody").kids(invs.iter().map(|i| -> N {
                        let code = i.get("code").text();
                        let days = i.get("days").f();
                        el("tr")
                            .kid(el("td").cls("vp-code").text(code.clone()))
                            .kid(el("td").text(plan_text(i.get("allowance").f())))
                            .kid(el("td").cls("n").text(i.get("max_devices").text()))
                            .kid(el("td").text(if days > 0.0 { format!("{:.0} days", days) } else { "no end".into() }))
                            .kid(el("td").cls("n").text(i.get("uses").text()))
                            .kid(el("td").text(i.get("note").text()))
                            .kid(el("td").kid(el("div").cls("row").kid(vbtn("Copy link", 38, code.clone())).kid(vbtn("Cancel", 37, code).cls("danger"))))
                            .into()
                    }))))
                    .into()
            })
            .into()
    })
}

fn settings_view(v: &Vpn) -> N {
    let modes = [("approval", "Sign up, then I approve (or an invite code)"), ("invite", "Invite code only"), ("open", "Open: anyone, at once")];
    let sv = v.overview.data.as_ref().map(|d| d.get("server").clone()).unwrap_or(Value::Null);
    el("div")
        .kid(vfield("Name of your service", "text", &v.set[0], 41))
        .kid(
            el("label")
                .cls("vp-f")
                .kid(el("span").text("How people join"))
                .kid(el("select").on_val("change", |x| Msg::T(Tool::Vpn, 42, x)).kids(modes.iter().map(|(k, l)| -> N { el("option").attr("value", *k).attr_if(v.set[1] == *k, "selected", "").text(*l).into() }))),
        )
        .kid(el("p").cls("hint").text("The plan a newly approved person starts with:"))
        .kid(el("div").cls("vp-row").kid(vfield("GB a month (0 = unlimited)", "number", &v.set[2], 43)).kid(vfield("Devices", "number", &v.set[3], 44)).kid(vfield("Days (0 = no end)", "number", &v.set[4], 45)))
        .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Vpn, 46, String::new())).text("Save")))
        .kid_if(!sv.is_null(), || el("p").cls("hint").text(format!("Server: piii VPN {} · VPN addresses {} · DNS for devices {}. On the VPN, its page is also at http://10.77.0.1.", sv.get("version").text(), sv.get("net").text(), sv.get("dns").text())).into())
        .into()
}

/// How to make a server: what to have, and the one command, filled in (owner, 2026-10-16: "I have a PC with Linux
/// Ubuntu server on it and I have an internet").
fn guide_view(v: &Vpn, folded: bool) -> N {
    let open = !folded || v.guide;
    let mut g = el("div").cls("vp-guide").cls_if(!folded, "flat");
    g = g.kid(
        el("button")
            .attr("type", "button")
            .cls("vp-guide-h")
            .attr("aria-expanded", if open { "true" } else { "false" })
            .on("click", Msg::T(Tool::Vpn, 64, String::new()))
            .text(if folded { "No server yet? Set one up on a Linux computer at home →" } else { "Set up a server" }),
    );
    if !open && folded {
        return g.into();
    }
    g.kid(el("ol").cls("vp-steps")
        .kid(el("li").kid(el("b").text("A computer that stays on")).kid(el("span").text(" with Ubuntu Server 22.04 or newer (or Debian, or Raspberry Pi OS), wired to your router if you can.")))
        .kid(el("li").kid(el("b").text("A name for your home.")).kid(el("span").text(" Your home's address changes, so make a free name at duckdns.org (yourname.duckdns.org) and copy its token.")))
        .kid(el("li").kid(el("b").text("Open three ports in your router")).kid(el("span").text(" to that computer (\"port forwarding\"): TCP 80 and 443, and UDP 51820.")))
        .kid(el("li").kid(el("b").text("Run one command on it:")).kid(el("span").text(" fill in your details and copy it."))))
        .kid(el("div").cls("vp-row").kid(vfield("Your DuckDNS name", "text", &v.g_domain, 60)).kid(vfield("Your user name", "text", &v.g_admin, 61)).kid(vfield("DuckDNS token (optional)", "password", &v.g_duck, 62)))
        .kid(el("pre").cls("vp-pre").text(install_cmd(v)))
        .kid(el("div").cls("row").kid(vbtn("Copy the command", 63, String::new())).kid(ext_link("https://github.com/ex-tern/pi/tree/main/back/vpn-server", "The full guide")))
        .kid(el("p").cls("hint").text("It asks for your password once, sets up WireGuard, a firewall that keeps devices off your home network, HTTPS and the service, and checks your name points home. Then connect here with your DuckDNS name. Each device runs the free WireGuard app with the code this page gives it."))
        .kid(el("p").cls("hint").text("Your token stays in this page: it is put in the command, not kept or sent anywhere."))
        .into()
}

const VPN_CSS: &str = "\
.vp{max-width:880px}\
.vp h3{font-size:16px;margin:18px 0 8px}\
.vp-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}\
.vp-top .btn{margin-left:auto}\
.vp-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--line2);margin-right:7px;vertical-align:middle;flex:none}\
.vp-dot.on{background:#1f8a4c}.vp-dot.bad{background:#b3261e}\
.vp-f{display:grid;gap:4px;font-size:14px;min-width:120px}\
.vp-f.grow{flex:1;min-width:200px}\
.vp-f input,.vp-f select{font:inherit;padding:8px 10px;border:1px solid var(--line2);background:var(--card);color:var(--ink);width:100%}\
.vp-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:10px 0}\
.vp-card{border:1px solid var(--line);background:var(--card);padding:14px 16px;margin:12px 0;max-width:480px}\
.vp-card .vp-f{margin:8px 0}\
.vp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}\
.vp-stat{border:1px solid var(--line);background:var(--card);padding:10px 12px;min-width:0}\
.vp-stat b{display:block;font-size:20px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}\
.vp-stat span{color:var(--muted);font-size:13px}\
.vp-stat.addr b{font-size:14px;line-height:1.5;padding:3px 0}\
.vp-bar{display:block;height:6px;background:var(--line);overflow:hidden;margin-top:6px}.vp-bar i{display:block;height:100%;background:var(--accent)}.vp-bar.full i{background:#b3261e}\
.vp-tw{overflow-x:auto;margin:8px 0}\
.vp-t{border-collapse:collapse;width:100%;font-size:14px}\
.vp-t th,.vp-t td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:middle}\
.vp-t th{font-weight:600;color:var(--muted);font-size:13px}\
.vp-t td.n{font-variant-numeric:tabular-nums;white-space:nowrap}\
.vp-t .row{margin:0;gap:6px}\
.vp .btn.danger{color:#b3261e}\
.vp-pill{font-size:12px;padding:1px 8px;border:1px solid var(--line2);white-space:nowrap;margin-left:6px}\
.vp-pill.on{color:#1f8a4c;border-color:currentColor;margin:0}.vp-pill.wait{color:#b4561b;border-color:currentColor;margin:0}.vp-pill.off{color:#b3261e;border-color:currentColor;margin:0}\
.vp-warn{border-left:3px solid #b4561b;padding:8px 12px;background:var(--card);font-size:14px}\
.vp-msg{font-size:14px;min-height:1em}.vp-msg.warn{color:#b3261e}.vp-msg.ok{color:#1f8a4c}\
.vp-conf{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start;margin:14px 0;padding:14px;border:1px solid var(--line);background:var(--card)}\
.vp-conf img{width:240px;height:240px;background:var(--surface);display:block}\
.vp-conf h3{margin-top:0}\
.vp-steps{padding-left:20px;line-height:1.6;font-size:14px}\
.vp-pre{font-size:12.5px;white-space:pre-wrap;word-break:break-all;background:var(--card);border:1px solid var(--line);padding:10px;margin:8px 0}\
.vp-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.03em;overflow-wrap:anywhere}\
.vp-more{margin-top:18px}.vp-more summary{cursor:pointer;font-weight:600}\
.vp-guide{margin-top:22px;border-top:1px solid var(--line);padding-top:12px}.vp-guide.flat{border-top:0;margin-top:4px;padding-top:0}\
.vp-guide-h{background:none;border:0;padding:0;font:inherit;font-weight:600;color:var(--accent);cursor:pointer}\
@media (max-width:600px){.vp-conf{grid-template-columns:1fr}.vp-conf img{width:100%;height:auto;max-width:260px}.vp-top .btn{margin-left:0}}\
";
