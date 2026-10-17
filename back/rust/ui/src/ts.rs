// piii VPN through Tailscale (owner, 2026-10-17: "can tailscale be integrated to my website" — "do it"): no router
// needed. The owner's computer runs Tailscale as an exit node; from here the owner invites people (Tailscale's device
// invites: the one computer shared with them, as a way out to the internet, nothing else). They install Tailscale,
// open the link, and choose the computer as their exit node. Shown at the top of the piii VPN tool. Included into
// app.rs.

#[derive(Default)]
pub struct TsVpn {
    status: Slot,
    pw: String,
    name: String,
    email: String,
    multi: bool,
    note: String,
    busy: bool,
    made: Option<(String, String, bool)>,
    armed: String,
}

fn ts_load() {
    let t = &mut st().ts;
    if t.status.needed() {
        t.status.busy = true;
        request(Want::Tool(Tool::TsVpn, 0), "GET", "/api/ts/status", "", 0);
    }
}

fn ts_refresh() {
    st().ts.status.reset();
    ts_load();
}

fn ts_apply(what: u8, v: Value, err: Option<String>) {
    let t = &mut st().ts;
    t.busy = false;
    match what {
        0 => put(&mut t.status, v, err),
        // signed in, approved, withdrawn, signed out
        1 | 3 | 4 | 5 => match err {
            Some(e) => t.note = e,
            None => {
                t.note.clear();
                t.pw.clear();
                ts_refresh();
            }
        },
        // an invite made
        2 => match err {
            Some(e) => t.note = e,
            None => {
                t.note.clear();
                t.made = Some((v.get("name").text(), v.get("url").text(), v.get("emailed").truthy()));
                t.name.clear();
                t.email.clear();
                ts_refresh();
            }
        },
        _ => {}
    }
}

fn ts_update(a: u16, v: String) {
    let t = &mut st().ts;
    match a {
        1 => t.pw = v,
        2 => {
            if t.pw.trim().is_empty() {
                return;
            }
            t.busy = true;
            let body = format!("{{\"password\":{}}}", json::quote(t.pw.trim()));
            request(Want::Tool(Tool::TsVpn, 1), "POST", "/api/ts/login", &body, 0);
        }
        3 => t.name = v,
        4 => t.email = v,
        5 => t.multi = v == "1",
        6 => {
            t.busy = true;
            t.made = None;
            let body = format!("{{\"name\":{},\"email\":{},\"multi\":{}}}", json::quote(t.name.trim()), json::quote(t.email.trim()), t.multi);
            request(Want::Tool(Tool::TsVpn, 2), "POST", "/api/ts/invite", &body, 0);
        }
        7 => {
            t.busy = true;
            request(Want::Tool(Tool::TsVpn, 3), "POST", "/api/ts/approve-exit", "", 0);
        }
        // withdraw: first "sure?"
        8 => {
            if t.armed != v {
                t.armed = v;
                return;
            }
            t.armed.clear();
            t.busy = true;
            request(Want::Tool(Tool::TsVpn, 4), "POST", &format!("/api/ts/invite/{}/delete", url_encode(&v)), "", 0);
        }
        9 => {
            host::call("copy", &v);
            t.note = "Copied: send it to the person.".into();
        }
        10 => request(Want::Tool(Tool::TsVpn, 5), "POST", "/api/ts/logout", "", 0),
        11 => ts_refresh(),
        _ => {}
    }
}

fn ts_guest() -> N {
    el("div")
        .cls("ts-guest")
        .kid(el("h4").text("Got an invite? Three steps"))
        .kid(
            el("ol")
                .cls("ts-steps")
                .kid(
                    el("li")
                        .kid(txt("Install Tailscale on your phone or computer: "))
                        .kid(ext_link("https://tailscale.com/download", "tailscale.com/download ↗"))
                        .kid(el("div").cls("ts-get").kid(txt("Android: ")).kid(ext_link("https://play.google.com/store/apps/details?id=com.tailscale.ipn", "Google Play ↗")).kid(txt(" · or the APK file, no Google account needed: ")).kid(ext_link("https://f-droid.org/packages/com.tailscale.ipn/", "F-Droid ↗")))
                        .kid(el("div").cls("ts-get").kid(txt("iPhone, iPad and Mac: ")).kid(ext_link("https://apps.apple.com/app/tailscale/id1470499037", "App Store ↗"))),
                )
                .kid(el("li").text("Open the invite link you were sent, sign in (Google, Apple, Microsoft or GitHub: a free account), and accept."))
                .kid(el("li").text("In the Tailscale app, choose Exit node → piii. Everything you do online now goes out through it; turn the exit node off to stop.")),
        )
        .into()
}

fn ts_view(s: &State) -> N {
    let t = &s.ts;
    let d = t.status.data.as_ref();
    let mut root = el("section").cls("ts").kid(el("h3").text("piii VPN through Tailscale")).kid(el("p").cls("lede").text(
        "No router settings: the owner's computer is the way out, and Tailscale connects you to it from anywhere. One app to install.",
    ));
    if let Some(e) = &t.status.err {
        return root.kid(el("p").cls("hint warn").text(e.clone())).kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::TsVpn, 11, String::new())).text("Try again")).into();
    }
    let Some(d) = d else { return root.kid(el("p").cls("hint").text("Loading…")).into() };
    let admin = d.get("admin").truthy();
    let configured = d.get("configured").truthy();
    if !admin {
        root = root.kid(ts_guest());
        if d.get("can_login").truthy() {
            root = root.kid(
                el("details").cls("ts-owner").kid(el("summary").text("Owner: manage invites")).kid(
                    el("div")
                        .cls("ts-row")
                        .kid(
                            el("input")
                                .attr("type", "password")
                                .attr("placeholder", "VPN admin password")
                                .attr("autocomplete", "current-password")
                                .prop("value", t.pw.clone())
                                .on("input", Msg::TV(Tool::TsVpn, 1))
                                .on("enter", Msg::T(Tool::TsVpn, 2, String::new())),
                        )
                        .kid(el("button").attr("type", "button").cls("btn").attr_if(t.busy, "disabled", "").on("click", Msg::T(Tool::TsVpn, 2, String::new())).text("Sign in")),
                ),
            );
        }
        return root.kid(el("p").cls("hint warn").text(t.note.clone())).into();
    }
    if !configured {
        return root
            .kid(el("p").cls("hint warn").text("Tailscale is not connected to the site yet."))
            .kid(ts_setup(false))
            .into();
    }
    // the computer
    let ex = d.get("exit_node");
    if matches!(ex, Value::Null) {
        root = root.kid(el("p").cls("hint warn").text("Your computer is not in Tailscale yet. On it:")).kid(ts_setup(true));
        return root.kid(el("p").cls("hint warn").text(t.note.clone())).into();
    }
    let online = ex.get("online").truthy();
    let offers = ex.get("offers_exit").truthy();
    let approved = ex.get("exit_approved").truthy();
    let mut pc = el("div")
        .cls("ts-pc")
        .kid(el("span").cls("vp-dot").cls_if(online, "on").cls_if(!online, "bad"))
        .kid(el("b").text(ex.get("name").text()))
        .kid(el("span").cls("hint").text(format!(
            "{} · {}",
            if online { "online" } else { "offline: is the computer on?" },
            if !offers { "not offering itself as exit node yet" } else if approved { "exit node ready" } else { "exit node not approved yet" }
        )));
    if offers && !approved {
        pc = pc.kid(el("button").attr("type", "button").cls("btn small primary").attr_if(t.busy, "disabled", "").on("click", Msg::T(Tool::TsVpn, 7, String::new())).text("Approve as exit node"));
    }
    root = root.kid(pc);
    if !offers {
        root = root.kid(el("p").cls("hint").text("On the computer: sudo tailscale set --advertise-exit-node"));
    }
    // a new invite
    root = root.kid(el("h4").text("Invite someone")).kid(
        el("div")
            .cls("ts-row")
            .kid(el("input").attr("type", "text").attr("maxlength", "60").attr("placeholder", "Their name (for you)").prop("value", t.name.clone()).on("input", Msg::TV(Tool::TsVpn, 3)))
            .kid(el("input").attr("type", "email").attr("placeholder", "Their email (optional: Tailscale sends it)").prop("value", t.email.clone()).on("input", Msg::TV(Tool::TsVpn, 4)))
            .kid(el("button").attr("type", "button").cls("btn primary").attr_if(t.busy, "disabled", "").on("click", Msg::T(Tool::TsVpn, 6, String::new())).text(if t.busy { "…" } else { "Make invite" })),
    ).kid(
        el("label")
            .cls("ts-multi")
            .kid(el("input").attr("type", "checkbox").prop("checked", if t.multi { "1" } else { "0" }).on_val("change", |v| Msg::T(Tool::TsVpn, 5, v)))
            .kid(txt(" One link for several people (up to 1000), instead of one person")),
    );
    if let Some((name, url, emailed)) = &t.made {
        let who = if name.is_empty() { "them".to_string() } else { name.clone() };
        let mut box_ = el("div").cls("ts-made").kid(el("p").text(if *emailed { format!("Invite made and emailed to {}.", who) } else { format!("Invite made. Send this link to {}:", who) }));
        if !url.is_empty() {
            box_ = box_.kid(el("div").cls("ts-row").kid(el("code").cls("ts-url").text(url.clone())).kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::TsVpn, 9, url.clone())).text("Copy")));
        }
        root = root.kid(box_.kid(el("p").cls("hint").text("With it, they install Tailscale, accept, and choose Exit node → your computer.")));
    }
    // everyone invited
    let invites = d.get("invites").arr();
    root = root.kid(el("h4").text(format!("Invited ({})", invites.len())));
    if invites.is_empty() {
        root = root.kid(el("p").cls("hint").text("Nobody yet."));
    }
    root = root.kid(el("ul").cls("ts-list").kids(invites.iter().map(|i| -> N {
        let id = i.get("id").text();
        let name = i.get("name").text();
        let by = i.get("by").text();
        let state = if i.get("accepted").truthy() { if by.is_empty() { "joined".to_string() } else { format!("joined as {}", by) } } else { "not accepted yet".to_string() };
        let mut li = el("li")
            .kid(el("b").text(if name.is_empty() { "Invite".to_string() } else { name }))
            .kid(el("span").cls("hint").text(format!(" · {}{}", state, if i.get("multi").truthy() { " · for several people" } else { "" })));
        let url = i.get("url").text();
        if !url.is_empty() {
            li = li.kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::TsVpn, 9, url)).text("Copy link"));
        }
        let sure = t.armed == id;
        li.kid(el("button").attr("type", "button").cls("btn small").cls_if(sure, "danger").on("click", Msg::T(Tool::TsVpn, 8, id)).text(if sure { "Sure? Withdraw" } else { "Withdraw" })).into()
    })));
    root.kid(el("p").cls("hint warn").text(t.note.clone()))
        .kid(el("div").cls("row").kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::TsVpn, 11, String::new())).text("Refresh")).kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::TsVpn, 10, String::new())).text("Sign out")))
        .into()
}

/// What the owner does once: Tailscale on the computer, and its key for the site.
fn ts_setup(only_pc: bool) -> N {
    let mut ol = el("ol").cls("ts-steps").kid(el("li").kid(txt("On the computer: ")).kid(el("code").text(
        "curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --advertise-exit-node",
    )));
    if !only_pc {
        ol = ol
            .kid(el("li").kid(txt("In Tailscale (")).kid(ext_link("https://login.tailscale.com/admin/settings/keys", "Settings → Keys ↗")).kid(txt("), generate an API access token.")))
            .kid(el("li").kid(txt("Add it to the server's settings, then restart: ")).kid(el("code").text(
                "echo 'TAILSCALE_API_KEY=tskey-api-…' | sudo tee -a /etc/piii-site.env && sudo systemctl restart piii-site",
            )));
    }
    ol.into()
}

const TS_CSS: &str = "\
.ts{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:16px 18px;margin:0 0 22px;max-width:820px}\
.ts h3{margin:0 0 4px}.ts h4{margin:16px 0 6px;font-size:15px}\
.ts-steps{padding-left:20px;line-height:1.6;margin:6px 0}.ts-steps li{margin:4px 0}.ts-steps code{font-size:12px;word-break:break-all}\
.ts-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}\
.ts-row input{flex:1 1 200px;min-width:0;font:inherit;padding:8px 10px;border:1px solid var(--line2);background:var(--card);color:var(--ink);border-radius:9px}\
.ts-pc{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}\
.ts-multi{display:block;font-size:13px;margin:4px 0}\
.ts-made{border-left:3px solid #1f8a4c;padding:6px 12px;margin:10px 0}\
.ts-url{word-break:break-all;font-size:12px;flex:1}\
.ts-list{list-style:none;padding:0;margin:6px 0}.ts-list li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line)}\
.ts-list li .btn:first-of-type{margin-left:auto}\
.ts-owner{margin-top:10px;font-size:14px}\
.ts-get{font-size:13px;margin:2px 0}\
";
