// The Proof-of-Research ledger explorer, the two leaderboards (sortable, paged, an author's papers), the help behind
// every ? button, the chain's status, signing in with an Ethereum wallet, and donations — app.js of the old page, in
// Rust. The wallet is the browser's (window.ethereum), reached through the host's "eth" op; nothing here holds a key.
// Included into app.rs.

#[derive(Default)]
pub struct Ledger {
    // explorer
    ex: Slot,
    ex_q: String,
    ex_min: String,
    ex_field: String,
    ex_sort: String,
    ex_asc: bool,
    ex_page: usize,
    ex_fields: Vec<String>,
    // leaderboards
    lb_a: Slot,
    lb_p: Slot,
    a_sort: String,
    a_asc: bool,
    a_off: usize,
    p_sort: String,
    p_asc: bool,
    p_off: usize,
    author: String,
    author_papers: Slot,
    // chain, help, wallet, donations
    chain: Slot,
    contracts: Slot,
    donate: Slot,
    amount: String,
    dmsg: (String, &'static str),
    dtx: String,
    copied: bool,
    wmsg: String,
    step: Eth,
    acct: String,
    sign_msg: String,
    tx: Slot,
    tx_for: String,
}

#[derive(Default, Clone, Copy, PartialEq)]
enum Eth {
    #[default]
    Idle,
    Accounts,
    Switch,
    Add,
    Sign,
    DAccounts,
    DSwitch,
    DAdd,
    DSend,
}

const ETH_TOKEN: u32 = 3_000_000;
const API_GUIDE: &str = "Everything the site shows comes from a public JSON API on this same address. Read endpoints need no key.\n\n\
• GET /api/rubric: the eight piX criteria and every weight\n\
• GET /api/explorer/latest: the newest blocks on the Proof-of-Research ledger\n\
• GET /api/explorer/search?q=: search assessed papers\n\
• GET /api/explorer/dossier/{hash}: one assessment in full\n\
• GET /api/dossier/{hash}/fair: that assessment as FAIR JSON\n\
• GET /api/analytics/top-papers and /api/analytics/leaderboard: the two leaderboards\n\
• GET /api/chain/status: the chain and the contracts\n\
• GET /api/emission: how much piQ an assessment earns now\n\
• GET /api/cookies: what the site keeps in your browser\n\
• GET /api/health: whether the server is up\n\n\
Writing (assessing a paper, reviewing, your profile) needs a signed-in session: sign in on the site, then send its token as Authorization: Bearer <token>.";
const EX_PAGE: usize = 20;
const LB_PAGE: usize = 10;
const SEPOLIA: &str = "{\"chainId\":\"0xaa36a7\",\"chainName\":\"Sepolia Test Network\",\"nativeCurrency\":{\"name\":\"Sepolia Ether\",\"symbol\":\"SepoliaETH\",\"decimals\":18},\"rpcUrls\":[\"https://ethereum-sepolia-rpc.publicnode.com\",\"https://rpc.sepolia.org\"],\"blockExplorerUrls\":[\"https://sepolia.etherscan.io\"]}";

// ---------------------------------------------------------------------------------------------- help

fn help_btn(key: &str) -> N {
    el("button").attr("type", "button").cls("help-btn").attr("data-stop", "1").attr("aria-label", "What is this?").on("click", Msg::T(Tool::Ledger, 30, key.to_string())).text("?").into()
}

fn head_help(title: &str, lede: &str, key: &str) -> N {
    el("div").cls("head").kid(el("h1").text(title).kid(help_btn(key))).kid(el("p").cls("lede").text(lede)).into()
}

fn help_view(s: &State, key: &str) -> N {
    let Some((_, title, body)) = HELP.iter().find(|h| h.0 == key) else { return txt("") };
    let mut root = el("div").cls("help-modal").kid(el("h2").text(title.to_string()));
    for (i, part) in body.split("@@CHAIN@@").enumerate() {
        if i > 0 {
            root = root.kid(slot_view(&s.ledger.contracts, "Loading the on-chain addresses…", |d| {
                el("div")
                    .cls("addr-list")
                    .kids(d.get("addresses").arr().iter().map(|a| -> N {
                        let state = a.get("state").str();
                        let badge: N = match state {
                            "invalid" => el("span").cls("pill bad").text("invalid").into(),
                            "unset" => el("span").cls("pill").text(if a.get("optional").truthy() { "not used" } else { "not configured" }).into(),
                            _ => txt(""),
                        };
                        let addr = a.get("address").text();
                        let code: N = if addr.is_empty() {
                            el("code").text("—").into()
                        } else if !a.get("explorer_url").str().is_empty() {
                            el("a").attr("href", a.get("explorer_url").text()).attr("target", "_blank").attr("rel", "noopener").kid(el("code").cls("wrap").text(addr)).into()
                        } else {
                            el("code").cls("wrap").text(addr).into()
                        };
                        el("div")
                            .cls("addr-item")
                            .kid(el("div").cls("addr-label").kid(el("b").text(a.get("label").text())).kid(txt(" ")).kid(badge))
                            .kid(code)
                            .kid(el("div").cls("hint").text(a.get("description").text()))
                            .kid_if(state == "invalid" && !a.get("problem").str().is_empty(), || el("div").cls("hint warn").text(a.get("problem").text()).into())
                            .into()
                    }))
                    .kid(el("p").cls("hint").text(format!("Network: {} (chain {}).", d.get("network").text(), d.get("chain_id").text())))
                    .into()
            }));
        }
        if !part.trim().is_empty() {
            root = root.kid(markdown(part));
        }
    }
    root.into()
}

// ---------------------------------------------------------------------------------------------- loading

fn ledger_load(t: Tool) {
    let s = st();
    let l = &mut s.ledger;
    match t {
        Tool::Ledger => {
            if l.ex_sort.is_empty() {
                l.ex_sort = "date".into();
            }
            if l.ex.needed() {
                ex_fetch();
            }
            if l.chain.needed() {
                l.chain.busy = true;
                request(Want::Tool(Tool::Ledger, 1), "GET", "/api/chain/status", "", 0);
            }
        }
        Tool::Board => {
            if l.a_sort.is_empty() {
                l.a_sort = "piq".into();
                l.p_sort = "score".into();
            }
            if l.lb_a.needed() {
                lb_fetch(true);
            }
            if st().ledger.lb_p.needed() {
                lb_fetch(false);
            }
        }
        Tool::Donate => {
            if l.donate.needed() {
                l.donate.busy = true;
                request(Want::Tool(Tool::Donate, 0), "GET", "/api/donate/info", "", 0);
            }
        }
        _ => {}
    }
}

fn ex_fetch() {
    let l = &mut st().ledger;
    l.ex.busy = true;
    l.ex.err = None;
    l.ex_page = 0;
    let url = if !l.ex_q.trim().is_empty() {
        format!("/api/explorer/search?q={}", url_encode(l.ex_q.trim()))
    } else {
        let min: f64 = l.ex_min.trim().parse().unwrap_or(0.0);
        format!(
            "/api/explorer/latest?min_score={}&max_score=100&field={}&sort={}&order={}&limit=200",
            min.max(0.0).min(100.0),
            url_encode(&l.ex_field),
            l.ex_sort,
            if l.ex_asc { "asc" } else { "desc" }
        )
    };
    request(Want::Tool(Tool::Ledger, 0), "GET", &url, "", 0);
}

fn lb_fetch(authors: bool) {
    let l = &mut st().ledger;
    if authors {
        l.lb_a.busy = true;
        let u = format!("/api/analytics/leaderboard?sort={}&order={}&limit={}&offset={}", l.a_sort, if l.a_asc { "asc" } else { "desc" }, LB_PAGE, l.a_off);
        request(Want::Tool(Tool::Board, 0), "GET", &u, "", 0);
    } else {
        l.lb_p.busy = true;
        let u = format!("/api/analytics/top-papers?sort={}&order={}&limit={}&offset={}&min_score=0&max_score=100", l.p_sort, if l.p_asc { "asc" } else { "desc" }, LB_PAGE, l.p_off);
        request(Want::Tool(Tool::Board, 1), "GET", &u, "", 0);
    }
}

fn ledger_apply(t: Tool, w: u8, v: Value, err: Option<String>) {
    let s = st();
    let l = &mut s.ledger;
    match (t, w) {
        (Tool::Ledger, 0) => {
            if err.is_none() && l.ex_fields.is_empty() {
                l.ex_fields = v.get("available_fields").arr().iter().map(|f| if f.str().is_empty() { f.any(&["field", "name"]).text() } else { f.text() }).filter(|f| !f.is_empty()).collect();
            }
            put(&mut l.ex, v, err)
        }
        (Tool::Ledger, 1) => put(&mut l.chain, v, err),
        (Tool::Ledger, 2) => put(&mut l.contracts, v, err),
        (Tool::Ledger, 4) => put(&mut l.tx, v, err),
        (Tool::Ledger, 3) => {
            l.step = Eth::Idle;
            match err {
                Some(e) => l.wmsg = format!("Signature verification failed, so you are not signed in. {}", e),
                None if v.get("authenticated").truthy() && !v.get("token").str().is_empty() => {
                    let w = v.get("address").text();
                    let tok = v.get("token").text();
                    host::store_set("sp_token", &tok);
                    host::store_set("sp_wallet", &w);
                    l.wmsg.clear();
                    s.token = tok;
                    s.wallet = w;
                    s.piq.reset();
                    s.mine.reset();
                    request(Want::Session, "GET", "/api/auth/session", "", 0);
                    load();
                }
                None => l.wmsg = v.get("detail").text().or_text("Signature verification failed, so you are not signed in."),
            }
        }
        (Tool::Ledger, 6) => {
            if let Some(e) = err {
                open_modal(Modal::Info("Cookies and storage".into(), format!("The list could not be loaded. {}", e)));
                return;
            }
            let mut text = String::from("What this site keeps in your browser, and why. Nothing optional is kept before you choose.\n");
            for (head, key) in [("Cookies", "cookies"), ("Browser storage", "storage")] {
                text.push_str(&format!("\n{}\n", head));
                for c in v.get(key).arr() {
                    text.push_str(&format!(
                        "\n• {}{}\n  {}\n  Lasts: {}\n",
                        c.get("name").text(),
                        if c.get("essential").truthy() { " (essential)" } else { "" },
                        c.get("purpose").text(),
                        c.get("lasts").text()
                    ));
                }
            }
            open_modal(Modal::Info("Cookies and storage".into(), text));
        }
        (Tool::Ledger, 5) => {
            let msg = v.get("message").text();
            if err.is_some() || msg.is_empty() {
                l.step = Eth::Idle;
                l.wmsg = format!("Sign-in could not start, so you are not signed in. {}", err.unwrap_or_default());
                return;
            }
            l.sign_msg = msg;
            l.wmsg = "Signing… confirm in your wallet.".into();
            eth("personal_sign", &format!("[{},{}]", json::quote(&l.sign_msg), json::quote(&l.acct)));
        }
        (Tool::Board, 0) => put(&mut l.lb_a, v, err),
        (Tool::Board, 1) => put(&mut l.lb_p, v, err),
        (Tool::Board, 2) => put(&mut l.author_papers, v, err),
        (Tool::Donate, 0) => put(&mut l.donate, v, err),
        _ => {}
    }
}

fn ledger_update(t: Tool, a: u16, v: String) {
    let s = st();
    let l = &mut s.ledger;
    match (t, a) {
        // the sidebar's cookies icon: what this site keeps in your browser, read from the server, shown here
        (Tool::Ledger, 50) => request(Want::Tool(Tool::Ledger, 6), "GET", "/api/cookies", "", 0),
        // the sidebar's API icon: the public endpoints (the interactive reference is off on the live site)
        (Tool::Ledger, 51) => open_modal(Modal::Info("The API".into(), API_GUIDE.into())),
        (Tool::Ledger, 52) => example_toggle(),
        (Tool::Ledger, 53) => wire_mode_toggle(),
        (Tool::Ledger, 54) => undo(),
        (Tool::Ledger, 2) => ex_fetch(),
        (Tool::Ledger, 3) => l.ex_min = v,
        (Tool::Ledger, 4) => {
            l.ex_field = v;
            ex_fetch();
        }
        (Tool::Ledger, 5) => {
            if l.ex_sort == v {
                l.ex_asc = !l.ex_asc;
            } else {
                l.ex_sort = v;
                l.ex_asc = false;
            }
            ex_fetch();
        }
        (Tool::Ledger, 6) => l.ex_page = l.ex_page.saturating_sub(1),
        (Tool::Ledger, 7) => l.ex_page += 1,
        (Tool::Ledger, 8) => {
            l.ex_q.clear();
            l.ex_min.clear();
            l.ex_field.clear();
            ex_fetch();
        }
        (Tool::Ledger, 20) => wallet_connect(),
        (Tool::Ledger, 40) => host::go(&v),
        (Tool::Ledger, 41) => paper_download(&v),
        (Tool::Ledger, 30) => {
            if v == "explorer" && l.contracts.needed() {
                l.contracts.busy = true;
                request(Want::Tool(Tool::Ledger, 2), "GET", "/api/chain/contracts", "", 0);
            }
            s.modal = Some(Modal::Help(v));
        }
        (Tool::Board, 1) | (Tool::Board, 4) => {
            let authors = a == 1;
            let (sort, asc, off) = if authors { (&mut l.a_sort, &mut l.a_asc, &mut l.a_off) } else { (&mut l.p_sort, &mut l.p_asc, &mut l.p_off) };
            if *sort == v {
                *asc = !*asc;
            } else {
                *sort = v;
                *asc = false;
            }
            *off = 0;
            lb_fetch(authors);
        }
        (Tool::Board, 2) => {
            l.a_off = l.a_off.saturating_sub(LB_PAGE);
            lb_fetch(true);
        }
        (Tool::Board, 3) => {
            l.a_off += LB_PAGE;
            lb_fetch(true);
        }
        (Tool::Board, 5) => {
            l.p_off = l.p_off.saturating_sub(LB_PAGE);
            lb_fetch(false);
        }
        (Tool::Board, 6) => {
            l.p_off += LB_PAGE;
            lb_fetch(false);
        }
        (Tool::Board, 7) => {
            l.author_papers.reset();
            l.author_papers.busy = true;
            request(Want::Tool(Tool::Board, 2), "GET", &format!("/api/analytics/top-papers?q={}&sort=score&order=desc&limit=50&offset=0", url_encode(&v)), "", 0);
            l.author = v;
        }
        (Tool::Board, 8) => l.author.clear(),
        (Tool::Donate, 1) => {
            l.amount = v;
            l.dmsg = (String::new(), "");
        }
        (Tool::Donate, 2) => donate_send(),
        (Tool::Donate, 3) => {
            let w = l.donate.data.as_ref().map(|d| d.get("wallet").text()).unwrap_or_default();
            if !w.is_empty() {
                host::call("copy", &w);
                l.copied = true;
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------------------------- the wallet

fn eth(method: &str, params: &str) -> bool {
    host::call("eth", &format!("{}\t{}\t{}", ETH_TOKEN, method, params)).is_some()
}

fn wallet_connect() {
    let l = &mut st().ledger;
    if !eth("eth_requestAccounts", "[]") {
        l.wmsg = "No Ethereum wallet was found in this browser. Install MetaMask (metamask.io) to sign in with a wallet.".into();
        return;
    }
    l.step = Eth::Accounts;
    l.wmsg = "Connecting… approve the request in your wallet.".into();
}

fn donate_send() {
    let l = &mut st().ledger;
    let amt = l.amount.trim().to_string();
    if wei_hex(&amt).is_none() {
        l.dmsg = ("Enter a valid amount.".into(), "warn");
        return;
    }
    if !eth("eth_requestAccounts", "[]") {
        l.dmsg = ("No wallet was found in this browser — copy the address below and send manually.".into(), "warn");
        return;
    }
    l.step = Eth::DAccounts;
    l.dtx.clear();
    l.dmsg = ("Preparing the transaction…".into(), "");
}

/// A decimal ether amount as hexadecimal wei, built from the digits typed (no float on the way).
fn wei_hex(amount: &str) -> Option<String> {
    let (whole, frac) = amount.split_once('.').unwrap_or((amount, ""));
    if (whole.is_empty() && frac.is_empty()) || !whole.bytes().all(|c| c.is_ascii_digit()) || !frac.bytes().all(|c| c.is_ascii_digit()) || frac.len() > 18 {
        return None;
    }
    let w: u128 = if whole.is_empty() { 0 } else { whole.parse().ok()? };
    let mut f = String::from(frac);
    while f.len() < 18 {
        f.push('0');
    }
    let wei = w.checked_mul(1_000_000_000_000_000_000)?.checked_add(f.parse::<u128>().ok()?)?;
    if wei == 0 {
        return None;
    }
    Some(format!("0x{:x}", wei))
}

/// Now, as ISO 8601 (UTC), from the host's clock.
fn iso_now() -> String {
    let ms = host::now() as i64;
    let secs = ms.div_euclid(1000);
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // days since 1970-01-01 to a civil date (Howard Hinnant's algorithm)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, m, d, rem / 3600, rem % 3600 / 60, rem % 60, ms.rem_euclid(1000))
}

/// The wallet answered: {"ok": result} or {"err": code, "msg": text}.
fn eth_got(data: Vec<u8>) {
    let s = st();
    let text = String::from_utf8(data).unwrap_or_default();
    let v = json::parse(&text).unwrap_or(Value::Null);
    let code = v.get("err").f() as i64;
    let failed = !v.get("err").is_null();
    let ok = v.get("ok");
    let l = &mut s.ledger;
    let reason = |code: i64, msg: &str| -> String {
        match code {
            4001 => "The request was rejected in the wallet.".to_string(),
            -32002 => "A wallet request is already open — click the wallet icon in your toolbar to find it.".to_string(),
            _ => format!("The wallet said: {}", msg),
        }
    };
    match l.step {
        Eth::Accounts => {
            let acct = ok.arr().first().map(|a| a.text()).unwrap_or_default();
            if failed || acct.is_empty() {
                l.step = Eth::Idle;
                l.wmsg = if failed { reason(code, v.get("msg").str()) } else { "No account was shared.".into() };
                return;
            }
            l.acct = acct;
            l.step = Eth::Switch;
            l.wmsg = "Checking the network…".into();
            eth("wallet_switchEthereumChain", "[{\"chainId\":\"0xaa36a7\"}]");
        }
        Eth::Switch | Eth::Add => {
            if failed && code == 4902 && l.step == Eth::Switch {
                l.step = Eth::Add;
                eth("wallet_addEthereumChain", &format!("[{}]", SEPOLIA));
                return;
            }
            // Signing proves control of the address; the network only matters for later settlement. The message to
            // sign comes from the server, with a nonce it issued and will accept once, so a signature made anywhere
            // else (or replayed) can not sign anybody in.
            l.step = Eth::Sign;
            l.sign_msg.clear();
            l.wmsg = "Preparing the sign-in message…".into();
            request(Want::Tool(Tool::Ledger, 5), "GET", &format!("/api/auth/wallet/nonce?address={}", url_encode(&l.acct)), "", 0);
        }
        Eth::Sign => {
            if failed {
                l.step = Eth::Idle;
                l.wmsg = if code == 4001 {
                    "Signing was rejected, so you are not signed in. Connecting proves you can name an address; signing proves you control it.".into()
                } else {
                    "The signature could not be completed, so you are not signed in.".into()
                };
                return;
            }
            l.wmsg = "Verifying…".into();
            let body = format!("{{\"address\":{},\"message\":{},\"signature\":{}}}", json::quote(&l.acct), json::quote(&l.sign_msg), json::quote(&ok.text()));
            request(Want::Tool(Tool::Ledger, 3), "POST", "/api/auth/wallet/verify", &body, 0);
        }
        Eth::DAccounts => {
            let acct = ok.arr().first().map(|a| a.text()).unwrap_or_default();
            if failed || acct.is_empty() {
                l.step = Eth::Idle;
                l.dmsg = (if failed { reason(code, v.get("msg").str()) } else { String::new() }, "warn");
                return;
            }
            l.acct = acct;
            l.step = Eth::DSwitch;
            let hex = l.donate.data.as_ref().map(|d| d.get("chain_id_hex").text()).unwrap_or_default().or_text("0x1");
            eth("wallet_switchEthereumChain", &format!("[{{\"chainId\":{}}}]", json::quote(&hex)));
        }
        Eth::DSwitch | Eth::DAdd => {
            let d = l.donate.data.clone().unwrap_or(Value::Null);
            if failed && code == 4902 && l.step == Eth::DSwitch {
                l.step = Eth::DAdd;
                let rpcs: Vec<String> = d.get("rpc_urls").arr().iter().map(|r| json::quote(r.str())).collect();
                let base = d.get("tx_explorer_base").text().or_text("https://etherscan.io/tx/");
                let p = format!(
                    "[{{\"chainId\":{},\"chainName\":{},\"nativeCurrency\":{{\"name\":{},\"symbol\":{},\"decimals\":18}},\"rpcUrls\":[{}],\"blockExplorerUrls\":[{}]}}]",
                    json::quote(&d.get("chain_id_hex").text().or_text("0x1")),
                    json::quote(&d.get("chain_name").text().or_text("Ethereum")),
                    json::quote(&d.get("chain_name").text().or_text("Ether")),
                    json::quote(&d.get("currency").text().or_text("ETH")),
                    if rpcs.is_empty() { json::quote("https://ethereum-rpc.publicnode.com") } else { rpcs.join(",") },
                    json::quote(base.trim_end_matches("/tx/"))
                );
                eth("wallet_addEthereumChain", &p);
                return;
            }
            if failed {
                l.step = Eth::Idle;
                l.dmsg = (format!("Please switch your wallet to {} and try again.", d.get("chain_name").text().or_text("Ethereum")), "warn");
                return;
            }
            let Some(wei) = wei_hex(l.amount.trim()) else {
                l.step = Eth::Idle;
                return;
            };
            l.step = Eth::DSend;
            l.dmsg = ("Confirm the transaction in your wallet…".into(), "");
            eth("eth_sendTransaction", &format!("[{{\"from\":{},\"to\":{},\"value\":{}}}]", json::quote(&l.acct), json::quote(d.get("wallet").str()), json::quote(&wei)));
        }
        Eth::DSend => {
            l.step = Eth::Idle;
            if failed {
                l.dmsg = (if code == 4001 { "Transaction rejected.".into() } else { format!("Could not send: {}", v.get("msg").text()) }, "warn");
            } else {
                l.dtx = ok.text();
                l.dmsg = ("Thank you. Transaction submitted:".into(), "ok");
            }
        }
        Eth::Idle => {}
    }
}

// ---------------------------------------------------------------------------------------------- views

fn chain_badge(s: &State) -> N {
    let Some(c) = s.ledger.chain.data.as_ref() else { return txt("") };
    let (cls, label) = if !c.get("connected").truthy() {
        ("chain-down", format!("{} unreachable", c.get("chain_name").text().or_text("The chain")))
    } else if c.get("minting_enabled").truthy() {
        ("chain-ok", format!("{} · block {} · minting live", c.get("chain_name").text(), c.get("block_number").text().or_text("—")))
    } else {
        ("chain-warn", format!("{} · block {} · read-only", c.get("chain_name").text(), c.get("block_number").text().or_text("—")))
    };
    el("span").cls("chain-badge").cls(cls).attr("title", c.get("reason").text()).kid(el("span").cls("chain-dot")).text(label).into()
}

fn sort_th(label: &str, col: &str, cur: &str, asc: bool, tool: Tool, a: u16, num_col: bool) -> N {
    let on = cur == col;
    el("th")
        .cls_if(num_col, "num")
        .cls("sortable")
        .cls_if(on, if asc { "sorted-asc" } else { "sorted-desc" })
        .attr("role", "button")
        .attr("tabindex", "0")
        .on("click", Msg::T(tool, a, col.to_string()))
        .text(format!("{}{}", label, if on { if asc { " ▲" } else { " ▼" } } else { "" }))
        .into()
}

fn pager(off: usize, limit: usize, total: usize, tool: Tool, prev: u16, next: u16) -> N {
    let pages = ((total + limit - 1) / limit).max(1);
    let page = off / limit + 1;
    el("div")
        .cls("pagination")
        .kid(el("button").attr("type", "button").cls("btn small").attr_if(page <= 1, "disabled", "").on("click", Msg::T(tool, prev, String::new())).text("‹ Prev"))
        .kid(el("span").cls("hint").text(format!("Page {} of {} · {} total", page, pages, total)))
        .kid(el("button").attr("type", "button").cls("btn small").attr_if(page >= pages, "disabled", "").on("click", Msg::T(tool, next, String::new())).text("Next ›"))
        .into()
}

fn rank(n: usize) -> N {
    el("span").cls("rank").cls(match n { 1 => "rank-1", 2 => "rank-2", 3 => "rank-3", _ => "rank-n" }).text(format!("{}", n)).into()
}

fn piq_cell(p: &Value) -> String {
    let held = p.any(&["piq_held", "escrowed", "piq_escrowed"]).f();
    let total = p.get("piq").f();
    if held > 0.0 { format!("{:.2} ({:.2} held)", total, held) } else { format!("{:.2}", total) }
}

fn compact_authors(a: &str) -> String {
    let names: Vec<&str> = a.split(',').map(|x| x.trim()).filter(|x| !x.is_empty()).collect();
    match names.len() {
        0 => "—".into(),
        1 => names[0].to_string(),
        _ => format!("{} et al.", names[0]),
    }
}

fn compact_title(t: &str) -> String {
    let t = t.trim();
    if t.chars().count() <= 90 {
        return t.to_string();
    }
    let cut: String = t.chars().take(90).collect();
    let at = cut.rfind(' ').filter(|&i| i > 54).unwrap_or(cut.len());
    format!("{}…", cut[..at].trim_end_matches(|c: char| c.is_whitespace() || ",;:.-".contains(c)))
}

fn settlement_cell(r: &Value) -> N {
    let state = r.get("settlement").text().or_text(if r.get("settled").truthy() { "on-chain" } else { "local" });
    let note = r.get("settlement_note").text();
    if state == "on-chain" && !r.get("explorer_url").str().is_empty() {
        return el("a").cls("pill good").attr("href", r.get("explorer_url").text()).attr("target", "_blank").attr("rel", "noopener").attr("data-stop", "1").attr("title", note).text("On-chain").into();
    }
    if state == "pending" {
        return el("span").cls("pill warn").attr("title", note).text("Pending").into();
    }
    el("span").cls("pill").attr("title", note).text("Local").into()
}

fn ledger_view(s: &State) -> N {
    let l = &s.ledger;
    let searching = !l.ex_q.trim().is_empty();
    let controls = el("div")
        .cls("ex-controls")
        .kid(el("input").cls("input").attr("type", "search").attr("aria-label", "Search the ledger").attr("placeholder", "Block hash, eval hash, title or author").prop("value", l.ex_q.clone()).on("input", Msg::TV(Tool::Ledger, 1)).on("enter", Msg::T(Tool::Ledger, 2, String::new())))
        .kid(el("input").cls("input ex-min").attr("type", "number").attr("min", "0").attr("max", "100").attr("aria-label", "Minimum piX").attr("placeholder", "Min piX").prop("value", l.ex_min.clone()).on("input", Msg::TV(Tool::Ledger, 3)).on("enter", Msg::T(Tool::Ledger, 2, String::new())))
        .kid(
            el("select")
                .cls("input ex-field")
                .attr("aria-label", "Field")
                .on("change", Msg::TV(Tool::Ledger, 4))
                .kid(el("option").attr("value", "").text("All fields"))
                .kids(l.ex_fields.iter().map(|f| -> N { el("option").attr("value", f.clone()).attr_if(*f == l.ex_field, "selected", "").text(f.clone()).into() })),
        )
        .kid(el("button").attr("type", "button").cls("btn").on("click", Msg::T(Tool::Ledger, 2, String::new())).text("Search"))
        .kid_if(searching || !l.ex_min.is_empty() || !l.ex_field.is_empty(), || el("button").attr("type", "button").cls("btn ghost").on("click", Msg::T(Tool::Ledger, 8, String::new())).text("Clear").into());
    let body = slot_view(&l.ex, "Reading the ledger…", |d| {
        let recs = d.get("records").arr();
        let filtered = !l.ex_min.trim().is_empty() || !l.ex_field.is_empty();
        if recs.is_empty() {
            return el("p")
                .cls("hint")
                .text(if searching {
                    "No matching ledger records found."
                } else if filtered {
                    "No ledger records match these filters. Widen the score range or choose a different field."
                } else {
                    "No assessments recorded yet."
                })
                .into();
        }
        let chain = d.get("chain");
        let total = recs.len();
        let pages = (total + EX_PAGE - 1) / EX_PAGE;
        let page = l.ex_page.min(pages.saturating_sub(1));
        let slice = &recs[page * EX_PAGE..((page + 1) * EX_PAGE).min(total)];
        let th = |label: &str, col: &str, n: bool| sort_th(label, col, &l.ex_sort, l.ex_asc, Tool::Ledger, 5, n);
        let plain = |label: &str, n: bool| -> N { el("th").cls_if(n, "num").text(label.to_string()).into() };
        let sortable = !searching;
        el("div")
            .kid(el("p").cls("hint").text(if searching {
                format!("{} search result{}.", total, if total == 1 { "" } else { "s" })
            } else {
                format!(
                    "{} record{}{}.{}",
                    d.get("count").f().max(total as f64) as i64,
                    if total == 1 { "" } else { "s" },
                    if filtered { " matching your filters" } else { "" },
                    if chain.get("network").is_null() { String::new() } else { format!(" {} · chain {}", chain.get("network").text(), chain.get("chain_id").text()) }
                )
            }))
            .kid(
                el("div").cls("table-scroll").kid(
                    el("table")
                        .cls("data-table ledger-table")
                        .kid(el("thead").kid(
                            el("tr")
                                .kid(plain("Block", true))
                                .kid(if sortable { th("Manuscript", "title", false) } else { plain("Manuscript", false) })
                                .kid(plain("Eval hash", false))
                                .kid(plain("Block hash", false))
                                .kid(plain("Validator", false))
                                .kid(if sortable { th("piX", "score", true) } else { plain("piX", true) })
                                .kid(if sortable { th("piQ", "piq", true) } else { plain("piQ", true) })
                                .kid(if sortable { th("Date", "date", false) } else { plain("Settlement", false) })
                                .kid_if(sortable, || plain("Settlement", false)),
                        ))
                        .kid(el("tbody").kids(slice.iter().map(|r| -> N {
                            let h = r.get("eval_hash").text();
                            let bh = r.get("block_hash").text();
                            el("tr")
                                .cls("clickable-row")
                                .on("click", Msg::T(Tool::Ledger, 40, format!("#/paper/{}", h)))
                                .kid(el("td").cls("num mono").text(r.get("block_height").text().or_text("—")))
                                .kid(
                                    el("td")
                                        .kid(el("a").attr("href", format!("#/paper/{}", h)).attr("data-stop", "1").text(r.get("title").str().chars().take(60).collect::<String>().or_text("Untitled")))
                                        .kid(el("div").cls("hint").text(r.any(&["author", "author_name"]).text().or_text("—")))
                                        .kid(el("div").cls("row").kids(badges(r))),
                                )
                                .kid(el("td").kid(el("code").cls("mono").text(format!("{}…", h.chars().take(10).collect::<String>()))))
                                .kid(el("td").kid(el("code").cls("mono").text(if bh.is_empty() { "—".to_string() } else { format!("{}…", bh.chars().take(10).collect::<String>()) })))
                                .kid(el("td").kid(el("code").cls("mono").text(r.get("validator_node").text().replace("Validator_Pi_", "").or_text("—"))))
                                .kid(el("td").cls("num strong").text(num(r.any(&["score", "final_score"]).f(), 1)))
                                .kid(el("td").cls("num").text(format!("{:.3}", r.get("piq").f())))
                                .kid(if sortable { el("td").cls("hint").text(r.get("timestamp").str().chars().take(10).collect::<String>()).into() } else { settlement_cell(r) })
                                .kid_if(sortable, || el("td").kid(settlement_cell(r)).into())
                                .into()
                        }))),
                ),
            )
            .kid_if(total > EX_PAGE, || pager(page * EX_PAGE, EX_PAGE, total, Tool::Ledger, 6, 7))
            .kid(el("p").cls("hint").text("Each row is one Proof-of-Research block. The block hash chains to its predecessor, the validator signature is derived from the server's signing secret, and \"On-chain\" links to the settlement transaction. Select a row for the full dossier."))
            .into()
    });
    el("div")
        .cls("tool ledger")
        .kid(el("div").cls("spread").kid(el("p").cls("lede").text("Every assessment is a block on the Proof-of-Research ledger.").kid(help_btn("explorer"))).kid(chain_badge(s)))
        .kid(controls)
        .kid(body)
        .into()
}

fn board_view(s: &State) -> N {
    let l = &s.ledger;
    let papers = slot_view(&l.lb_p, "Loading…", |d| {
        let rows = d.get("papers").arr();
        let total = d.get("total").f() as usize;
        let th = |label: &str, col: &str, n: bool| sort_th(label, col, &l.p_sort, l.p_asc, Tool::Board, 4, n);
        el("div")
            .kid(
                el("div").cls("table-scroll").kid(
                    el("table")
                        .cls("data-table")
                        .kid(el("thead").kid(el("tr").kid(el("th").text("#")).kid(th("Title", "title", false)).kid(el("th").text("Author")).kid(th("piX", "score", true)).kid(th("piQ", "piq", true)).kid(th("Logic", "logic", true)).kid(th("Date", "date", true))))
                        .kid(el("tbody").kids(if rows.is_empty() {
                            alloc::vec![el("tr").kid(el("td").attr("colspan", "7").cls("hint").text("No papers assessed yet.")).into()]
                        } else {
                            rows.iter()
                                .enumerate()
                                .map(|(i, p)| -> N {
                                    let h = p.get("eval_hash").text();
                                    el("tr")
                                        .cls("clickable-row")
                                        .attr("title", format!("{} — {}", p.get("title").text(), p.get("author").text()))
                                        .on("click", Msg::T(Tool::Ledger, 40, format!("#/paper/{}", h)))
                                        .kid(el("td").kid(rank(l.p_off + i + 1)))
                                        .kid(el("td").text(compact_title(p.get("title").str())))
                                        .kid(el("td").cls("hint").text(compact_authors(p.get("author").str())))
                                        .kid(el("td").cls("num strong").text(format!("{:.1}", p.get("score").f())))
                                        .kid(el("td").cls("num").text(piq_cell(p)))
                                        .kid(el("td").cls("num").text(format!("{:.1}", p.get("logic_score").f())))
                                        .kid(el("td").cls("num hint").text(p.get("date").str().chars().take(10).collect::<String>().or_text("—")))
                                        .into()
                                })
                                .collect()
                        })),
                ),
            )
            .kid(pager(l.p_off, LB_PAGE, total, Tool::Board, 5, 6))
            .into()
    });
    let authors = slot_view(&l.lb_a, "Loading…", |d| {
        let rows = d.get("rankings").arr();
        let total = d.get("total").f() as usize;
        let th = |label: &str, col: &str, n: bool| sort_th(label, col, &l.a_sort, l.a_asc, Tool::Board, 1, n);
        el("div")
            .kid(
                el("div").cls("table-scroll").kid(
                    el("table")
                        .cls("data-table")
                        .kid(el("thead").kid(el("tr").kid(el("th").text("#")).kid(th("Author", "author", false)).kid(th("piQ", "piq", true)).kid(th("Papers", "papers", true)).kid(th("Avg piX", "avg_score", true))))
                        .kid(el("tbody").kids(if rows.is_empty() {
                            alloc::vec![el("tr").kid(el("td").attr("colspan", "5").cls("hint").text("No authors yet.")).into()]
                        } else {
                            rows.iter()
                                .enumerate()
                                .map(|(i, r)| -> N {
                                    let held = r.get("held").f();
                                    el("tr")
                                        .cls("clickable-row")
                                        .cls_if(l.author == r.get("author").text(), "picked")
                                        .on("click", Msg::T(Tool::Board, 7, r.get("author").text()))
                                        .kid(el("td").kid(rank(l.a_off + i + 1)))
                                        .kid(el("td").text(r.get("author").text()))
                                        .kid(
                                            el("td")
                                                .cls("num strong")
                                                .text(format!("{:.2}", r.get("piq").f()))
                                                .kid_if(held > 0.0, || el("span").cls("lb-held").attr("title", format!("{:.2} piQ of this is held — earned by the paper but not released, because authorship has not been verified.", held)).text(format!(" {:.2} held", held)).into()),
                                        )
                                        .kid(el("td").cls("num").text(r.get("papers").text()))
                                        .kid(el("td").cls("num").text(format!("{:.1}", r.get("avg_score").f())))
                                        .into()
                                })
                                .collect()
                        })),
                ),
            )
            .kid(pager(l.a_off, LB_PAGE, total, Tool::Board, 2, 3))
            .into()
    });
    let author: N = if l.author.is_empty() {
        txt("")
    } else {
        el("div")
            .cls("card author-papers")
            .kid(el("div").cls("spread").kid(el("h3").text(l.author.clone())).kid(el("button").attr("type", "button").cls("btn small ghost").on("click", Msg::T(Tool::Board, 8, String::new())).text("Close")))
            .kid(slot_view(&l.author_papers, "Loading assessed papers…", |d| {
                let ps = d.get("papers").arr();
                let n = d.get("total").f() as usize;
                if ps.is_empty() {
                    return el("p").cls("hint").text("No papers found for this author.").into();
                }
                el("div")
                    .kid(el("p").cls("hint").text(format!("{} assessed paper{}. Select one to open its full dossier.", n, if n == 1 { "" } else { "s" })))
                    .kid(el("table").cls("data-table").kid(el("thead").kid(el("tr").kid(el("th").text("Title")).kid(el("th").cls("num").text("piX")).kid(el("th").cls("num").text("piQ")))).kid(el("tbody").kids(ps.iter().map(|p| -> N {
                        el("tr")
                            .cls("clickable-row")
                            .on("click", Msg::T(Tool::Ledger, 40, format!("#/paper/{}", p.get("eval_hash").text())))
                            .kid(el("td").text(p.get("title").text()))
                            .kid(el("td").cls("num strong").text(format!("{:.1}", p.get("score").f())))
                            .kid(el("td").cls("num").text(piq_cell(p)))
                            .into()
                    }))))
                    .into()
            }))
            .into()
    };
    el("div")
        .cls("tool board")
        .kid(el("h3").text("pi-Index (piX) · top papers").kid(help_btn("pix")))
        .kid(papers)
        .kid(el("h3").style("margin-top:22px").text("pi-Quotient (piQ) · top authors").kid(help_btn("piq")))
        .kid(el("p").cls("hint").text("Select an author to see their assessed papers."))
        .kid(authors)
        .kid(author)
        .into()
}

fn donate_view(s: &State) -> N {
    let l = &s.ledger;
    slot_view(&l.donate, "Loading the donation address…", |d| {
        let cur = d.get("currency").text().or_text("ETH");
        el("div")
            .cls("tool donate")
            .kid(el("p").cls("lede").text(d.get("message").text()))
            .kid(el("h3").text(format!("Send {} on {}", cur, d.get("chain_name").text().or_text("Ethereum"))))
            .kid_if(!d.get("settlement_chain_note").str().is_empty(), || el("p").cls("hint").text(d.get("settlement_chain_note").text()).into())
            .kid(el("div").cls("row donate-amounts").kids(d.get("suggested_amounts").arr().iter().map(|a| -> N {
                let v = a.text();
                el("button").attr("type", "button").cls("btn").cls_if(l.amount == v, "primary").on("click", Msg::T(Tool::Donate, 1, v.clone())).text(v).into()
            })))
            .kid(
                el("div")
                    .cls("row")
                    .kid(el("input").cls("input").attr("type", "text").attr("inputmode", "decimal").attr("placeholder", "Custom amount").attr("aria-label", "Amount").prop("value", l.amount.clone()).on("input", Msg::TV(Tool::Donate, 1)))
                    .kid(el("button").attr("type", "button").cls("btn primary").attr_if(l.step != Eth::Idle, "disabled", "").on("click", Msg::T(Tool::Donate, 2, String::new())).text("Send with your wallet")),
            )
            .kid(
                el("p")
                    .cls("hint")
                    .cls(l.dmsg.1)
                    .text(l.dmsg.0.clone())
                    .kid_if(!l.dtx.is_empty(), || el("a").attr("href", format!("{}{}", d.get("tx_explorer_base").text().or_text("https://etherscan.io/tx/"), l.dtx)).attr("target", "_blank").attr("rel", "noopener").text(format!(" {}…", l.dtx.chars().take(18).collect::<String>())).into()),
            )
            .kid(el("h3").text("Or send it yourself"))
            .kid(el("div").cls("row addr-row").kid(el("code").cls("wrap").text(d.get("wallet").text())).kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::Donate, 3, String::new())).text(if l.copied { "Copied" } else { "Copy" })))
            .kid_if(!d.get("explorer_url").str().is_empty(), || el("p").cls("hint").kid(el("a").attr("href", d.get("explorer_url").text()).attr("target", "_blank").attr("rel", "noopener").text("View this address on the block explorer")).into())
            .kid(el("p").cls("hint").text("ScholarPi never takes custody of funds beyond this address, and donating confers no piQ, no scoring advantage and no influence over assessments."))
            .into()
    })
}

/// "Sign in with a wallet", for the account page.
fn wallet_card(s: &State) -> N {
    let l = &s.ledger;
    el("div")
        .cls("card")
        .kid(el("h3").text("Or sign in with an Ethereum wallet"))
        .kid(el("p").cls("hint").style("margin:4px 0 10px").text("Your wallet signs a message proving you control the address; nothing is sent and nothing is spent."))
        .kid(el("button").attr("type", "button").cls("btn").attr_if(l.step != Eth::Idle, "disabled", "").on("click", Msg::T(Tool::Ledger, 20, String::new())).text("Connect wallet"))
        .kid_if(!l.wmsg.is_empty(), || el("p").cls("hint warn").style("margin-top:8px").text(l.wmsg.clone()).into())
        .into()
}

const LEDGER_CSS: &str = "\
.help-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:8px;border-radius:50%;border:1px solid var(--line2);background:var(--surface);color:var(--faint);font:600 12px/1 inherit;cursor:pointer;vertical-align:middle}\
.help-btn:hover{color:var(--ink);border-color:var(--ink)}\
.help-modal ul{margin:6px 0 10px 18px}.help-modal p{margin:8px 0}\
.addr-item{margin:10px 0}.addr-item code.wrap,.addr-row code.wrap{word-break:break-all}\
.ex-controls{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.ex-controls .input{flex:1 1 220px}.ex-controls .ex-min{flex:0 0 100px}.ex-controls .ex-field{flex:0 1 200px}\
.data-table th.sortable{cursor:pointer;user-select:none}.data-table th.sortable:hover{color:var(--ink)}\
.clickable-row{cursor:pointer}.clickable-row:hover td{background:rgba(0,0,0,.025)}\
.data-table tr.picked td{background:rgba(37,99,235,.06)}\
.pagination{display:flex;align-items:center;gap:12px;justify-content:center;margin:10px 0}\
.rank{display:inline-flex;min-width:24px;height:24px;align-items:center;justify-content:center;border-radius:12px;font-size:12px;font-weight:600;background:var(--soft)}\
.rank-1{background:#f6d365}.rank-2{background:#dcdcdc}.rank-3{background:#e8b48a}\
.lb-held{display:block;font-size:11px;font-weight:400;color:var(--faint)}\
.chain-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 10px;border-radius:12px;border:1px solid var(--line2)}\
.chain-dot{width:8px;height:8px;border-radius:50%;background:#999}\
.chain-ok .chain-dot{background:#16a34a}.chain-warn .chain-dot{background:#eab308}.chain-down .chain-dot{background:#dc2626}\
.author-papers{margin-top:16px}\
.donate-amounts{margin:8px 0}.donate .input{max-width:220px}\
";
