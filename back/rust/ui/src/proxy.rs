// The web proxy (owner, 2026-10-17: "A web proxy on piii.app"): another website, opened through this server, so it
// sees the server's address instead of yours. Nothing to install. Behind a password the owner sets
// (PROXY_PASSWORD); websites only, and their own scripts do not run. The page itself is served by the server
// (/proxy?u=…); this is where the address is typed. Included into app.rs.

#[derive(Default)]
pub struct WebProxy {
    status: Slot,
    pw: String,
    url: String,
    note: String,
    busy: bool,
}

fn proxy_load() {
    let p = &mut st().proxy;
    if p.status.needed() {
        p.status.busy = true;
        request(Want::Tool(Tool::Proxy, 0), "GET", "/api/proxy/status", "", 0);
    }
}

fn proxy_apply(what: u8, v: Value, err: Option<String>) {
    let p = &mut st().proxy;
    match what {
        0 => put(&mut p.status, v, err),
        // the password
        1 => {
            p.busy = false;
            match err {
                Some(e) => p.note = e,
                None => {
                    p.pw.clear();
                    p.note.clear();
                    p.status.reset();
                    proxy_load();
                }
            }
        }
        2 => {
            p.status.reset();
            proxy_load();
        }
        _ => {}
    }
}

fn proxy_update(a: u16, v: String) {
    let p = &mut st().proxy;
    match a {
        1 => p.pw = v,
        2 => {
            if p.pw.trim().is_empty() || p.busy {
                return;
            }
            p.busy = true;
            p.note.clear();
            let body = format!("{{\"password\":{}}}", json::quote(p.pw.trim()));
            request(Want::Tool(Tool::Proxy, 1), "POST", "/api/proxy/enter", &body, 0);
        }
        3 => p.url = v,
        // open: in a new tab, the proxied site
        4 => {
            let u = if v.is_empty() { p.url.trim().to_string() } else { v };
            if u.is_empty() {
                p.note = "Type an address first.".into();
                return;
            }
            p.note.clear();
            host::open(&format!("/proxy?u={}", url_encode(&u)));
        }
        5 => request(Want::Tool(Tool::Proxy, 2), "POST", "/api/proxy/leave", "", 0),
        _ => {}
    }
}

fn proxy_view(s: &State) -> N {
    let p = &s.proxy;
    let d = p.status.data.as_ref();
    let mut root = el("div").cls("tool proxy").kid(el("p").cls("lede").text(
        "Open another website through piii.app: the site sees this server's address, not yours. Nothing to install. \
         Websites only (not apps), and a website's own scripts do not run here, so pages that depend on them will not work.",
    ));
    if p.status.busy && d.is_none() {
        return root.kid(el("p").cls("hint").text("Loading…")).into();
    }
    if let Some(e) = &p.status.err {
        return root.kid(el("p").cls("hint warn").text(e.clone())).into();
    }
    let enabled = d.map(|d| d.get("enabled").truthy()).unwrap_or(false);
    let allowed = d.map(|d| d.get("allowed").truthy()).unwrap_or(false);
    if !enabled {
        return root
            .kid(el("p").cls("hint warn").text("The proxy is off on this server: it has no proxy password yet."))
            .kid(el("p").cls("hint").text("Owner: add a line PROXY_PASSWORD=… to /etc/piii-site.env on the server, then: sudo systemctl restart piii-site"))
            .into();
    }
    if !allowed {
        return root
            .kid(el("label").cls("field").kid(el("span").text("The proxy password")).kid(
                el("input")
                    .attr("type", "password")
                    .attr("autocomplete", "current-password")
                    .prop("value", p.pw.clone())
                    .on("input", Msg::TV(Tool::Proxy, 1))
                    .on("enter", Msg::T(Tool::Proxy, 2, String::new())),
            ))
            .kid(
                el("div").cls("row").kid(
                    el("button")
                        .attr("type", "button")
                        .cls("btn primary")
                        .attr_if(p.busy || p.pw.trim().is_empty(), "disabled", "")
                        .on("click", Msg::T(Tool::Proxy, 2, String::new()))
                        .text(if p.busy { "Checking…" } else { "Enter" }),
                ),
            )
            .kid(el("p").cls("hint warn").text(p.note.clone()))
            .into();
    }
    let quick: [(&str, &str); 3] = [
        ("Search (DuckDuckGo)", "https://html.duckduckgo.com/html/"),
        ("Wikipedia", "https://en.m.wikipedia.org/"),
        ("What is my address?", "https://api.ipify.org/"),
    ];
    root = root
        .kid(
            el("div")
                .cls("proxy-go")
                .kid(
                    el("input")
                        .attr("type", "url")
                        .attr("aria-label", "An address")
                        .attr("placeholder", "an address: wikipedia.org, or https://…")
                        .prop("value", p.url.clone())
                        .on("input", Msg::TV(Tool::Proxy, 3))
                        .on("enter", Msg::T(Tool::Proxy, 4, String::new())),
                )
                .kid(el("button").attr("type", "button").cls("btn primary").on("click", Msg::T(Tool::Proxy, 4, String::new())).text("Open")),
        )
        .kid(el("p").cls("hint warn").text(p.note.clone()))
        .kid(el("div").cls("row proxy-quick").kids(quick.iter().map(|(l, u)| -> N {
            el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Proxy, 4, u.to_string())).text(l.to_string()).into()
        })))
        .kid(el("p").cls("hint").text("Opens in a new tab, with an address bar on top to go on from there. Logging in to other sites does not work through it."))
        .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Proxy, 5, String::new())).text("Forget the password on this browser"));
    root.into()
}

const PROXY_CSS: &str = "\
.proxy{max-width:760px}\
.proxy-go{display:flex;gap:10px;margin:14px 0 4px}\
.proxy-go input{flex:1;min-width:0;font:inherit;padding:10px 12px;border:1px solid var(--line2);background:var(--card);color:var(--ink);border-radius:10px}\
.proxy-quick{flex-wrap:wrap;gap:8px;margin:8px 0}\
";
