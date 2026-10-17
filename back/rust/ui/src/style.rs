//! The style sheet: ink on flat paper, one cobalt accent, Geist type, sentence case.

/// The superellipse every super is drawn as: |x/a|^N + |y/b|^N = 1, with N = π (owner, 2026-10-14: "make all
/// n=3.1459", "yes pi"). N = 2 is an ellipse; the larger N, the squarer.
pub const N: f64 = core::f64::consts::PI;

/// The shape rule for everything boxy: in a browser that draws superellipse corners (CSS corner-shape, whose
/// parameter is log2 of the exponent), the whole box is the superellipse; elsewhere, a small rounded corner.
pub fn shape_css() -> alloc::string::String {
    // Every element, the page's frame included, has superellipse corners of exponent N: small things are the whole
    // superellipse, larger ones have its corners (up to 22 px), so a large window keeps all its content in view.
    // Where superellipse corners cannot be drawn, square corners rather than round ones.
    alloc::format!(
        "@supports (corner-shape:superellipse(2)){{*:not(svg *){{border-radius:min(50%,22px)!important;corner-shape:superellipse({k:.4})!important}}}}\
@supports not (corner-shape:superellipse(2)){{*:not(svg *){{border-radius:0!important}}}}",
        k = libm_log2(N)
    )
}

fn libm_log2(x: f64) -> f64 {
    // log2 without the standard library: the exponent from the bits, the rest from a short series
    let bits = x.to_bits();
    let e = ((bits >> 52) & 0x7ff) as i64 - 1023;
    let m = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000); // in [1, 2)
    let y = (m - 1.0) / (m + 1.0);
    let y2 = y * y;
    let mut term = y;
    let mut sum = 0.0;
    let mut k = 1.0;
    while k < 40.0 {
        sum += term / k;
        term *= y2;
        k += 2.0;
    }
    e as f64 + 2.0 * sum / core::f64::consts::LN_2
}

pub const CSS: &str = r#"
@font-face{font-family:Geist;src:url(/fonts/Geist-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Geist Mono";src:url(/fonts/GeistMono-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--paper:#f6f6f4;--card:#fbfbf9;--ink:#191919;--magenta:#b0447a;--muted:#5f6472;--faint:#8b8f99;--line:#e2ded2;--line2:#cfcabb;
--accent:#2f40e8;--accent-soft:#e9ebfd;--good:#1d7a4a;--good-soft:#e3f3ea;--warn:#9a5b00;--warn-soft:#fbf0dc;
--bad:#b3261e;--bad-soft:#fbe7e5;--r:4px;--r2:4px;color-scheme:light}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 Geist,system-ui,-apple-system,"Segoe UI",sans-serif;
-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
button,input,select{font:inherit;color:inherit}
h1,h2,h3{font-weight:600;letter-spacing:-.015em;line-height:1.2;margin:0}
h1{font-size:30px}h2{font-size:19px}h3{font-size:15.5px}
p{margin:0}
code,.mono{font-family:"Geist Mono",ui-monospace,monospace;font-size:.92em}
.app{min-height:100vh;display:flex;flex-direction:column}
.top{position:sticky;top:0;z-index:5;background:rgba(247,245,239,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
border-bottom:1px solid var(--line)}
.top-in{max-width:1080px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:18px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);font-weight:600;font-size:16px;white-space:nowrap}
.brand:hover{text-decoration:none}
.mark{width:30px;height:30px;border-radius:9px;background:var(--ink);color:var(--paper);display:grid;place-items:center;
font-size:18px;font-weight:500;line-height:1}
.nav{display:flex;gap:2px;margin-left:auto;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{color:var(--muted);padding:7px 12px;border-radius:999px;white-space:nowrap;font-weight:500}
.nav a:hover{color:var(--ink);background:#ece9df;text-decoration:none}
.nav a.on{color:var(--ink);background:#e6e2d6}
main{flex:1;width:100%;max-width:1080px;margin:0 auto;padding:28px 16px 48px}
.foot{border-top:1px solid var(--line);color:var(--faint);font-size:13px}
.foot-in{max-width:1080px;margin:0 auto;padding:16px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
.foot button{background:none;border:0;padding:0;color:var(--muted);cursor:pointer}
.foot button:hover{color:var(--ink)}
.lede{color:var(--muted);max-width:640px;margin-top:8px}
.head{margin-bottom:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:20px}
.card+.card,.stack>*+*{margin-top:14px}
.seg{display:inline-flex;background:#ece9df;border-radius:999px;padding:3px;gap:2px;margin-bottom:16px;max-width:100%;overflow-x:auto}
.seg button,.seg a{border:0;text-decoration:none;background:none;padding:6px 14px;border-radius:999px;cursor:pointer;color:var(--muted);font-weight:500;white-space:nowrap}
.seg button.on,.seg a.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.field{display:flex;gap:8px;flex-wrap:wrap}
.input{flex:1;min-width:0;width:100%;background:#fff;border:1px solid var(--line2);border-radius:var(--r2);padding:10px 12px;outline:none}
.input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.btn{border:1px solid var(--line2);background:var(--card);border-radius:var(--r2);padding:9px 16px;cursor:pointer;font-weight:500;
white-space:nowrap}
.btn:hover{border-color:var(--ink)}
.btn:disabled{opacity:.45;cursor:default}
.btn:disabled:hover{border-color:var(--line2)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{background:#1b3bb8}
.btn.primary:disabled:hover{background:var(--accent)}
.btn.small{padding:5px 11px;font-size:13.5px}
.btn.link{border:0;background:none;color:var(--accent);padding:0}
.hint{color:var(--muted);font-size:13.5px}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.spread{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.drop{display:block;border:1.5px dashed var(--line2);border-radius:var(--r);padding:26px;text-align:center;cursor:pointer;
color:var(--muted);background:#fbfaf6}
.drop:hover{border-color:var(--accent);color:var(--ink)}
.drop input{display:none}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--card);border-radius:999px;
padding:4px 11px;font-size:13.5px;cursor:pointer}
.chip:hover{border-color:var(--ink)}
.chip .x{color:var(--faint)}
.pill{display:inline-flex;align-items:center;border-radius:999px;padding:2px 9px;font-size:12.5px;font-weight:500;
background:#efece3;color:var(--muted);white-space:nowrap}
.pill.accent{background:var(--accent-soft);color:var(--accent)}
.pill.good{background:var(--good-soft);color:var(--good)}
.pill.warn{background:var(--warn-soft);color:var(--warn)}
.pill.bad{background:var(--bad-soft);color:var(--bad)}
.pills{display:flex;flex-wrap:wrap;gap:6px}
.list{border:1px solid var(--line);border-radius:var(--r);background:var(--card);overflow:hidden}
.item{display:flex;gap:14px;align-items:flex-start;padding:13px 16px;border-top:1px solid var(--line)}
.item:first-child{border-top:0}
.item.pick{cursor:pointer}
.item.pick:hover{background:#fbfaf6}
.item.off{opacity:.5;cursor:default}
.item .grow{flex:1;min-width:0}
.item .t{font-weight:500;color:var(--ink);overflow-wrap:anywhere}
a.t:hover{color:var(--accent);text-decoration:none}
.item .s{color:var(--muted);font-size:13.5px;margin-top:2px;overflow-wrap:anywhere}
.score{font-variant-numeric:tabular-nums;font-weight:600;font-size:17px;min-width:48px;text-align:right}
.score small{display:block;font-size:11px;color:var(--faint);font-weight:500}
.box{width:18px;height:18px;margin-top:2px;accent-color:var(--accent)}
.log{font-size:13.5px;max-height:260px;overflow:auto}
.log div{padding:5px 0;border-top:1px solid var(--line)}
.log div:first-child{border-top:0}
.log .live{color:var(--ink)}
.log .done{color:var(--good);font-weight:500}
.log .err{color:var(--bad)}
.log .fee,.log .old{color:var(--muted)}
.log .reward{color:var(--good)}
.res-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between}
.big{font-size:36px;font-weight:600;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.big small{display:block;font-size:12px;color:var(--faint);font-weight:500;letter-spacing:0;margin-top:4px;text-align:right}
.bars{display:grid;gap:7px;margin-top:16px}
.bar{display:grid;grid-template-columns:minmax(120px,190px) 1fr 38px;gap:10px;align-items:center;font-size:13.5px}
.bar .lab{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .track{display:block;height:7px;background:#ece9df;border-radius:99px;overflow:hidden}
.bar .fill{display:block;height:100%;background:var(--accent);border-radius:99px}
.bar .v{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.find{border-left:3px solid var(--line2);padding:2px 0 2px 12px;margin-top:10px}
.find.critical{border-color:var(--bad)}.find.major{border-color:var(--warn)}.find.positive{border-color:var(--good)}
.find .ft{font-weight:500}
.find .fa{color:var(--muted);font-size:13.5px;margin-top:2px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.ledger-peek{margin-bottom:18px;padding:14px 16px;position:relative}.ledger-peek h3{margin:0;font-size:15px}
.ledger-peek .peek-body{max-height:190px;overflow:hidden;margin-top:8px;-webkit-mask-image:linear-gradient(#000 55%,transparent);mask-image:linear-gradient(#000 55%,transparent)}
.ledger-peek .peek-more{display:inline-flex;margin-top:4px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px}
.stat b{display:block;font-size:22px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:13px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;color:var(--muted);font-weight:500;padding:8px 10px;border-bottom:1px solid var(--line2)}
td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tr.now td{background:var(--accent-soft)}
.scroll{overflow-x:auto}
.crit{padding:14px 0;border-top:1px solid var(--line)}
.crit:first-child{border-top:0;padding-top:0}
.md h3{margin:16px 0 6px}.md p{margin:6px 0}.md ul{margin:6px 0;padding-left:20px}
.empty{color:var(--muted);text-align:center;padding:28px 16px}
.err-box{background:var(--bad-soft);color:var(--bad);border-radius:var(--r2);padding:10px 14px;font-size:14px}
.note{background:var(--warn-soft);color:var(--warn);border-radius:var(--r2);padding:10px 14px;font-size:14px}
.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--line2);border-top-color:var(--accent);border-radius:50%;
animation:sp .8s linear infinite;vertical-align:-1px;margin-right:8px}
@keyframes sp{to{transform:rotate(360deg)}}
.consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483600;max-width:560px;margin:0 auto;background:var(--card);
border:1px solid var(--line2);border-radius:18px;padding:18px 20px;box-shadow:0 12px 40px rgba(20,20,30,.16)}
.opt{display:flex;gap:10px;align-items:flex-start;padding:8px 0;cursor:pointer}
.opt .s{color:var(--muted);font-size:13px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:14px}
.kv dt{color:var(--muted)}.kv dd{margin:0}
.back{display:inline-block;margin-bottom:14px;color:var(--muted)}
@media (max-width:760px){
 h1{font-size:25px}
 .top-in{gap:10px;padding:8px 12px}
 .brand span:last-child{display:none}
 .nav a{padding:6px 10px}
 main{padding:20px 16px 40px}
 .stats{grid-template-columns:1fr 1fr}
 .grid2{grid-template-columns:1fr}
 .card{padding:16px}
 .bar{grid-template-columns:minmax(90px,130px) 1fr 34px}
 .big{font-size:30px}
 .hide-sm{display:none}
}
/* the canvas: the π mark and the supers around it */
.canvas{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:7vh 16px 0}
.mark-wrap{display:flex;flex-direction:column;align-items:center;text-align:center;max-width:720px}
.mark-big{width:96px;height:96px;border-radius:30px;background:var(--ink);color:var(--paper);display:grid;place-items:center;
font-size:54px;line-height:1;font-weight:400}
.mark-big.small{width:56px;height:56px;border-radius:18px;font-size:30px}
.brand-name{margin-top:18px;font-size:30px}
.pi-digits{margin-top:10px;color:var(--faint);font-size:13px;letter-spacing:.04em;max-width:min(640px,92vw);overflow-wrap:anywhere;min-height:2.6em}
.supers{width:100%;max-width:1040px;margin:34px 0 40px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.super{position:relative;display:flex;flex-direction:column;gap:6px;min-height:150px;padding:20px 22px;background:var(--card);
border:1px solid var(--line);border-radius:28px;color:var(--ink);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.super:hover{text-decoration:none;border-color:var(--ink);transform:translateY(-2px);box-shadow:0 14px 30px -18px rgba(20,20,30,.35)}
.super.main{grid-column:span 2;background:var(--ink);color:var(--paper);border-color:var(--ink)}
.super.main .sp{color:rgba(247,245,239,.72)}
.super.main .sg{background:var(--paper);color:var(--ink)}
.super .sg{width:40px;height:40px;border-radius:13px;background:#ece9df;display:grid;place-items:center;font-weight:600;font-size:14px;margin-bottom:8px}
.super .st{font-weight:600;font-size:18px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.super .sp{color:var(--muted);font-size:14px}
.super.open::after,.ric.open::after{content:"";position:absolute;top:14px;right:14px;width:9px;height:9px;border-radius:50%;background:var(--accent)}
.canvas .foot{width:100%;border-top:0;margin-top:auto}
.canvas .foot-in{justify-content:center}
/* focus: the open super fills the canvas; everything else is an icon in the rail */
.focus{min-height:100vh}
.rail{position:fixed;left:0;top:0;bottom:0;width:68px;z-index:2147482999;display:flex;flex-direction:column;align-items:center;gap:8px;
padding:12px 0;background:var(--paper);border-right:1px solid var(--line)}
.ric{position:relative;flex:none;width:44px;height:44px;border-radius:14px;border:1px solid var(--line2);background:var(--card);
display:grid;place-items:center;color:var(--ink);font-weight:600;font-size:13px;transition:transform .15s ease,border-color .15s ease}
.ric:hover,.ric:focus-visible{text-decoration:none;border-color:var(--ink);transform:translateY(-1px);outline:none}
.ric.home{background:var(--ink);border-color:var(--ink);color:var(--paper);font-size:22px;font-weight:400}
.ric.on{border-color:var(--accent);color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.ric.open::after{top:-3px;right:-3px;border:2px solid var(--paper)}
.ric .g,.super .sg{display:grid;place-items:center}
.ric .tip{position:absolute;left:54px;top:50%;transform:translateY(-50%);padding:5px 9px;border-radius:8px;background:var(--ink);
color:var(--paper);font-size:12px;font-weight:500;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s;max-width:260px;
overflow:hidden;text-overflow:ellipsis}
.ric:hover .tip,.ric:focus-visible .tip{opacity:1}
.rsep{flex:none;width:26px;height:1px;background:var(--line)}
.rscroll{flex:1 1 auto;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;overflow-y:auto;overflow-x:hidden;padding:0 0 6px}
.rfoot{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:6px}
@media (max-width:699px){.rscroll{flex-direction:row;overflow-x:auto;overflow-y:hidden;height:100%;width:auto;padding:0 6px 0 0}.rfoot{flex-direction:row;padding:0 0 0 6px}}button.ric{font:inherit;padding:0;cursor:pointer}
.focus.peek .win{left:calc(88px + (100vw - 100px) * .15);right:calc((100vw - 100px) * .15 + 12px);top:15vh;bottom:15vh;box-shadow:0 30px 80px -30px rgba(20,20,30,.45)}
.focus.peek .scene{z-index:0}
.win-grip{position:absolute;z-index:3;touch-action:none}.win-grip.r{top:60px;right:0;bottom:22px;width:8px;cursor:ew-resize}.win-grip.b{left:22px;right:22px;bottom:0;height:8px;cursor:ns-resize}.win-grip.c{right:0;bottom:0;width:22px;height:22px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--line2) 50%,var(--line2) 56%,transparent 56%,transparent 70%,var(--line2) 70%,var(--line2) 76%,transparent 76%)}
.win.picked{outline:3px solid var(--accent);outline-offset:2px}
.win{min-width:360px;min-height:240px;position:fixed;z-index:8;left:88px;top:12px;right:12px;bottom:12px;display:flex;flex-direction:column;background:var(--card);
border:1px solid var(--line);border-radius:22px;overflow:hidden;box-shadow:0 18px 50px -30px rgba(20,20,30,.35)}
.win-head{flex:none;display:flex;align-items:center;gap:12px;padding:10px 12px 10px 22px}
.win-title{flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
.win-x{flex:none;width:34px;height:34px;border-radius:11px;border:1px solid var(--line2);background:var(--card);cursor:pointer;
font-size:20px;line-height:1;color:var(--muted)}
.win-x:hover{color:var(--ink);border-color:var(--ink)}
.win-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch}
.win-in{max-width:1000px;margin:0 auto;padding:26px 24px 40px}
.win .card{background:#fdfcf9}
.gate{min-height:100vh;display:grid;place-items:center;padding:16px}
.gate-in{display:grid;gap:12px;width:min(320px,100%);justify-items:center;text-align:center}
.gate-in .input{text-align:center}
.gate-in .btn{width:100%}
.gate-no{color:var(--bad);min-height:1.5em}
@media (max-width:899px){.supers{grid-template-columns:1fr 1fr}}
@media (max-width:699px){
 .canvas{padding-top:40px}
 .mark-big{width:76px;height:76px;border-radius:24px;font-size:42px}
 .brand-name{font-size:25px}
 .supers{grid-template-columns:1fr;gap:10px;margin-top:26px}
 .super.main{grid-column:auto}
 .super{min-height:0;padding:16px 18px;border-radius:24px}
 .rail{top:auto;right:0;width:auto;height:64px;flex-direction:row;padding:10px 12px;border-right:0;border-top:1px solid var(--line);
  overflow-x:auto;scrollbar-width:none}
 .rail::-webkit-scrollbar{display:none}
 .rsep{width:1px;height:26px}
 .ric .g,.super .sg{display:grid;place-items:center}
.ric .tip{display:none}
 .win{left:8px;top:8px;right:8px;bottom:72px;border-radius:18px}
 .win-in{padding:18px 16px 32px}
}
@media print{.rail,.win-head,.foot,.consent{display:none!important}.win{position:static;border:0;box-shadow:none}.win-body{overflow:visible}}
/* the canvas, as the site has always looked */
.scene{position:fixed;inset:0;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none}
.scene.over{z-index:9;pointer-events:none;background:transparent;touch-action:auto}.scene.over>.frame{display:none}
.scene.over .sx{pointer-events:auto}.scene.over .wire-note{position:fixed;left:50%;right:auto;bottom:24px;transform:translateX(-50%);z-index:2147483001;max-width:calc(100vw - 32px)}
@media (max-width:699px){.scene.over .wire-note{bottom:auto;top:12px;left:12px;right:12px;transform:none;max-width:none}}
.frame{position:absolute;inset:0;border:2px solid var(--accent);pointer-events:none;z-index:3}.scene:not(.floating):not(.picked)>.frame{border-color:#d6d6d1}
.stage{position:absolute;left:0;top:0;width:1440px;height:900px;transform-origin:0 0}
.wires{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.wires{--wz:1}.wires .w,.map .w{fill:none;stroke:#2b2b2b;stroke-width:calc(1.8px*var(--wz));stroke-linejoin:round;stroke-linecap:round}
.wires .w,.wires .w-temp,.wires .w-hit{vector-effect:non-scaling-stroke}
.map .w.data{stroke-width:2.4}.wires .w.flow,.map .w.data{stroke:var(--magenta);stroke-linecap:butt}
.wires .w.flow{stroke-width:calc(2.2px*var(--wz))}.wires .w.control{stroke-dasharray:calc(7px*var(--wz)) calc(5px*var(--wz))}
.wires .w.gate{stroke-width:calc(2.8px*var(--wz));stroke-dasharray:0.1px calc(6px*var(--wz));stroke-linecap:round}
.wires .head.flow{fill:var(--magenta)}.wires .head.ink{fill:#2b2b2b}
.ports-svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:5}
.ports-svg .port{pointer-events:all;cursor:pointer}
.ports-svg .port .pad{fill:transparent}
.ports-svg .port .mark{fill:var(--paper);stroke:var(--ink);stroke-width:1.5;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.ports-svg .port.out .mark{fill:var(--ink)}
.ports-svg .port:hover .mark{stroke:var(--accent)}
.ports-svg .port.out:hover .mark{fill:var(--accent)}
.ports-svg .port.on .mark{fill:var(--accent);stroke:var(--accent)}
.ports-svg .port.target .mark{stroke:var(--accent);stroke-width:2.6;fill:#eef0fe}
.scene.floating .ports-svg .port{pointer-events:none}
.ports-svg .port .mark{transition:opacity .15s}.ports-svg .port:not(.wired):not(.on):not(.target) .mark{opacity:0}.ports-svg .port:hover .mark,.wiring .ports-svg .port .mark,.board-ports.holding .port .mark{opacity:1}
.wires .ports,.map .ports{fill:var(--ink)}
.sx{position:absolute;background:var(--card);border:1px solid #9a9a95;box-sizing:border-box;cursor:grab;overflow:hidden;
box-shadow:0 10px 24px -18px rgba(25,25,25,.35)}
.sx:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.sx.moving,html.dragging .sx{cursor:grabbing}
.sx.moving{box-shadow:0 18px 40px -16px rgba(25,25,25,.4);z-index:2}
.sx.title{white-space:nowrap;border:2px solid #2b2b2b;display:flex;align-items:center;padding:0 22px;font:400 19px/1 "Geist Mono",ui-monospace,monospace;
letter-spacing:.02em;cursor:pointer}
.sx.ctl{border:1.5px solid #2b2b2b;display:grid;place-items:center;cursor:pointer}
.sx.ctl:hover{background:#fff}
.ci{color:var(--ink)}.ci.accent{color:var(--accent)}.ci.faint{color:#b8b8b3}.ci.gray{color:#8c8c87}
.sx.words{padding:12px 10px;font-size:12.4px;line-height:1.38;color:var(--ink);background:#fff;cursor:pointer}
.sx.pchip{display:grid;place-items:center;font-size:14.5px;border:1.2px solid #2b2b2b;background:#fff;cursor:pointer}
.sx.hold{background:transparent;border:1px solid #b9b9b4;box-shadow:none;pointer-events:none}
.sx.tools{background:#fff;cursor:pointer}
.t-in{position:absolute;left:12px;top:80px;padding:1px 7px;border:1px solid #2b2b2b;background:#fff;font-size:12px;line-height:16px;color:var(--ink)}
.t-brace{position:absolute;left:62px;top:72px;width:22px;height:34px;border:3px solid var(--magenta);border-right:0;border-radius:8px 0 0 8px;
opacity:.75}
.t-bars{position:absolute;left:84px;top:68px;width:120px;display:grid;gap:3px}
.t-bar{display:block;height:9px;border:1px solid #7d7d78;background:#f3f3f1;pointer-events:none}

.sx.bubble{background:#fbfbf9;cursor:pointer;display:flex;flex-direction:column;align-items:center;padding-top:6px}
.tag{display:inline-block;border:1.5px solid #2b2b2b;border-radius:9px;padding:1px 7px;background:#fff;
font:400 16px/1.25 "Geist Mono",ui-monospace,monospace;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.sx.bubble.big .tag{font-size:21px;padding:1px 22px}
.sx.bubble.small .tag{min-width:52px;min-height:14px;padding:0 6px;font-size:11px;line-height:14px}
.bars-tree{position:relative;align-self:stretch;margin:5px 10px 0 22px;display:grid;gap:2px;padding-left:10px}
.bars-tree::before{content:"";position:absolute;left:0;top:-4px;bottom:4px;border-left:1px solid #9a9a95;border-bottom:1px solid #9a9a95;
border-radius:0 0 0 6px}
.bar-i{display:block;height:6px;border:1px solid #8c8c87;border-radius:4px;background:#fff;pointer-events:none}
.sx.bubble.small .bars-tree{margin:4px 6px 0 12px;padding-left:6px;gap:1px}
.sx.bubble.small .bar-i{height:3px}
.scene .foot{position:absolute;left:0;right:0;bottom:0;z-index:4;border:0;background:transparent;pointer-events:none}
.scene .foot-in{justify-content:flex-end;padding:8px 14px;font-size:12px}
.scene .foot a,.scene .foot button,.scene .foot span{pointer-events:auto}
/* an open super, and the others as icons: the same supers, small */
.rail{background:var(--paper);border-right:2px solid var(--accent)}
@media (min-width:700px){.rail{border:2px solid var(--accent);border-radius:22px;left:8px;top:8px;bottom:8px}}
.ric{border-radius:0;border:1.5px solid #2b2b2b;background:#fff;overflow:visible}
.ric.home{border-radius:0;background:#fff;color:var(--ink);font-size:13px;font-weight:600;border:1.5px solid #2b2b2b}
.ric.on{border-color:var(--accent);color:var(--accent);box-shadow:none;outline:2px solid var(--accent);outline-offset:3px}
.ric.open::after{background:var(--magenta)}
.pts{position:absolute;inset:0;pointer-events:none}
.pt{position:absolute;fill:var(--ink);width:12px;height:12px}
.pt.l{left:-6px;top:calc(50% - 6px)}.pt.r{right:-6px;top:calc(50% - 6px)}.pt.t{top:-6px;left:calc(50% - 6px)}.pt.b{bottom:-6px;left:calc(50% - 6px)}
.ric .pt{width:9px;height:9px}
.ric .pt.l{left:-5px;top:calc(50% - 4.5px)}.ric .pt.r{right:-5px;top:calc(50% - 4.5px)}.ric .pt.t{top:-5px;left:calc(50% - 4.5px)}.ric .pt.b{bottom:-5px;left:calc(50% - 4.5px)}
.win{border-radius:0;border:1.5px solid #2b2b2b;overflow:visible;box-shadow:0 18px 50px -30px rgba(20,20,30,.35)}
.win-body{border-radius:0}
.win-head{border-bottom:0}
.win-title.tag{flex:none;color:var(--ink);font-size:15px;max-width:calc(100% - 60px)}
.win-head{justify-content:space-between}
.win-x{border-radius:0;border:1.5px solid #2b2b2b;color:var(--ink)}
.members{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:22px}
.member{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-height:96px;padding:16px;background:#fff;
border:1.2px solid #2b2b2b;color:var(--ink)}
.member:hover{text-decoration:none;border-color:var(--accent)}
.member .tag{font-size:14px;white-space:normal;border:0;background:none;padding:0;border-radius:0;box-shadow:none}
.m-note{color:var(--muted);font-size:13px}
.map-wrap{overflow-x:auto;border:1px solid #d6d6d1;background:#fff;padding:12px}
.map{display:block;width:100%;min-width:760px;height:auto}
.m-sec{fill:none;stroke:#cfcfca;stroke-dasharray:4 4}
.m-sec-t{font:12px "Geist Mono",ui-monospace,monospace;fill:var(--muted)}
.m-node rect{fill:#fff;stroke:#2b2b2b;stroke-width:1.2}
.m-node text{font:13px Geist,system-ui,sans-serif;fill:var(--ink)}
.m-node text.m-note{font-size:10px;fill:var(--muted)}
.m-node.ai rect,.m-node.judge rect{stroke-width:2}
.m-node.out rect{fill:#f4f4f2}
.m-node.site rect{stroke:var(--accent)}
.m-link{cursor:pointer}
.m-link:hover rect{stroke:var(--accent);fill:var(--accent-soft)}
.card{border-radius:0}.btn{border-radius:0}.input{border-radius:0}.list{border-radius:0}.stat{border-radius:0}.seg,.seg button,.seg a{border-radius:0}
.btn.primary{background:var(--ink);border-color:var(--ink)}
.btn.primary:hover{background:#000}
.btn.primary:disabled:hover{background:var(--ink)}
.bar .fill{background:var(--accent);border-radius:0}.bar .track{border-radius:0}
.consent{border-radius:0;border:1.5px solid #2b2b2b}
@media (max-width:699px){.scene .foot{display:none}}
/* no "open" dot on icons (owner, 2026-10-14) */
.ric.open::after,.super.open::after{content:none!important;display:none!important}
/* wiring */
.wires .w-hit{fill:none;stroke:transparent;stroke-width:calc(14px*max(1,var(--wz)));pointer-events:stroke;cursor:pointer}
.wires .w.sel{stroke:var(--accent);stroke-width:calc(3px*var(--wz))}
.wires .w-temp{fill:none;stroke:var(--accent);stroke-width:calc(2px*var(--wz));stroke-dasharray:calc(6px*var(--wz)) calc(5px*var(--wz));stroke-linecap:round;stroke-linejoin:round}.wires .w-temp.snapped{stroke-dasharray:none;stroke-width:calc(2.4px*var(--wz))}
.ports-svg .port.snap .mark{fill:var(--accent);stroke:var(--accent);opacity:1;transform-box:fill-box;transform-origin:center;transform:scale(1.7)}
.wires .w-hit:hover{stroke:rgba(47,64,232,.22)}
.scene.wiring,.scene.wiring *{cursor:crosshair!important}
.sx.wire-target{outline:3px solid var(--accent);outline-offset:3px;background:#f3f4fe}
.sx.locked{cursor:default}
/* panning: an open hand over what can be panned, a closed one while it is (owner, 2026-10-14) */
.scene,.win-body{cursor:grab}:where(.scene *,.win-body *){cursor:auto}
.scene.panning,.scene.panning *,html.panning,html.panning *{cursor:grabbing!important}
html.shift-on,html.shift-on *{cursor:move!important}
.marquee{position:fixed;z-index:60;border:1.5px dashed var(--accent);background:rgba(47,64,232,.06);border-radius:6px;pointer-events:none}
.scene .group-box{position:absolute;z-index:1;border:1.5px dashed var(--accent);border-radius:18px;pointer-events:none}
.tip-lab{font-family:ui-sans-serif,system-ui,sans-serif;font-weight:600;fill:var(--accent);stroke:var(--paper);stroke-width:3px;paint-order:stroke;vector-effect:non-scaling-stroke;opacity:0;pointer-events:none;transition:opacity .12s}
.app.wire-on .port.hov .tip-lab,.app.wire-on .port:hover .tip-lab{opacity:1}
.pl{position:absolute;z-index:3;font:600 10px/1 ui-sans-serif,system-ui,sans-serif;color:var(--accent);background:var(--paper);padding:2px 4px;border-radius:5px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s}
.pl.l{right:calc(100% + 9px);top:50%;transform:translateY(-50%)}.pl.r{left:calc(100% + 9px);top:50%;transform:translateY(-50%)}
.pl.t{bottom:calc(100% + 9px);left:50%;transform:translateX(-50%)}.pl.b{top:calc(100% + 9px);left:50%;transform:translateX(-50%)}
.app.wire-on .ric:hover .pl{opacity:1}
.app.wire-on .ric:hover{z-index:20}
.ctl-bar .pl.t{bottom:auto;top:-4px;left:calc(50% + 9px);transform:none}
.rail .pl.l{right:auto;left:-4px;top:auto;bottom:calc(50% + 7px);transform:none}.rail .pl.r{left:auto;right:-4px;top:auto;bottom:calc(50% + 7px);transform:none}
@keyframes lockblink{0%,100%{box-shadow:0 0 0 0 transparent}30%,70%{box-shadow:0 0 0 4px var(--accent)}}.ctl-bar .ric.blink{animation:lockblink .6s ease-in-out 2}
.ric{-webkit-user-drag:none;user-select:none}
/* wiring off: tips that hold no wire stay hidden and no tip takes a click; on: every tip shows and wires */
.app:not(.wire-on) .ports-svg .port,.app:not(.wire-on) .bar-pts .pt{pointer-events:none!important}
.app:not(.wire-on) .ports-svg .port:not(.wired) .mark{opacity:0!important}
.app.wire-on .ports-svg .port .mark{opacity:1!important}
.ctl-bar .ric.on{border-color:var(--accent);outline:2px solid var(--accent);outline-offset:3px}
.win,.win-in{user-select:none;-webkit-user-select:none}.win-in{position:relative}.win-in input,.win-in textarea{user-select:text;-webkit-user-select:text}
.page-layer{position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:6}
.layer-node{position:absolute;width:88px;height:88px;box-sizing:border-box;display:grid;place-items:center}
.layer-spark svg{display:block}.layer-spark path{fill:none;stroke:var(--ink);stroke-width:1.5px;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.layer-super{background:#fff;border:1.5px solid #2b2b2b;padding:8px}
.layer-in{width:100%;border:1.5px solid #9a9a95;background:#fbfbf9;padding:7px 4px;font:500 15px/1.2 'Geist Mono',ui-monospace,monospace;text-align:center;outline:none}.layer-in:focus{border-color:var(--accent)}
.win.picked .win-head{cursor:grab}
/* no scroll bar anywhere, ever; everything still scrolls (owner, 2026-10-14) */
*{scrollbar-width:none;-ms-overflow-style:none}*::-webkit-scrollbar{display:none;width:0;height:0}
.wire-note.page-note{position:fixed;left:50%;right:auto;bottom:24px;transform:translateX(-50%);z-index:2147483001;max-width:calc(100vw - 32px)}
@media (max-width:699px){.wire-note,.wire-note.page-note{bottom:auto;top:12px;left:12px;right:12px;max-width:none}}
.stage>.sx.under-bar{visibility:hidden}
.bar-pts{pointer-events:none}.bar-pts .pt{pointer-events:auto;cursor:pointer}
.hold-face{position:absolute;inset:6px;z-index:1;cursor:pointer;touch-action:none}
.stage>.sx.ctl{z-index:7}
.ric.ctlb.holding,.sx.ctl.holding{background:linear-gradient(var(--accent-soft),var(--accent-soft)) no-repeat left bottom/100% 0%;animation:holdfill .9s linear forwards}
@keyframes holdfill{to{background-size:100% 100%}}
.sx.icon{display:grid!important;place-items:center;padding:0!important;background:#fff;overflow:hidden}
.icon-g{display:grid;place-items:center;width:100%;height:100%;font:600 30px/1 'Geist',system-ui,sans-serif;color:var(--ink);letter-spacing:.02em}
.icon-g svg{width:min(56%,64px);height:auto;max-height:70%}
/* an icon fits its box however small it is made: no padding to spill out of, the mark scaled to the box (owner,
   2026-10-14: "this is a bug?") */
.bnode.icon{display:grid;place-items:center;padding:0;overflow:hidden;container-type:size}.bnode.icon .icon-g{font-size:min(22px,55cqh,30cqw)}
.bnode.icon .icon-g svg{width:min(56%,64px,70cqh);max-height:70%}
.sx.picked,.bnode.picked{outline:3px solid var(--accent);outline-offset:3px;box-shadow:0 0 0 7px var(--accent-soft)}
/* wiring: the pointer says what a click will do (owner, 2026-10-14: "improve the wiring experience with pointer change") */
.ports-svg .port.out{cursor:crosshair}
.scene.wiring,.scene.wiring .sx,.board.holding,.board.holding .bnode{cursor:crosshair}
.scene.wiring .ports-svg .port.target,.board-ports.holding .port.target{cursor:copy}
.scene.wiring .ports-svg .port.target .mark,.board-ports.holding .port.target .mark{transform-box:fill-box;transform-origin:center;animation:tippulse 1s ease-in-out infinite}
@keyframes tippulse{50%{transform:scale(1.35)}}
.scene.wiring .ports-svg .port:not(.target):not(.on),.board-ports.holding .port:not(.target):not(.on){cursor:not-allowed}
.wires .w-hit:hover+.w,.wires .w-hit:hover{cursor:pointer}
.board .w-hit:hover{stroke:rgba(37,99,235,.18)}.wires .w-hit:hover{stroke:rgba(37,99,235,.12)}
.wire-note{position:absolute;left:16px;bottom:14px;z-index:5;padding:7px 12px;background:var(--ink);color:var(--paper);font-size:13px;
max-width:min(520px,calc(100% - 32px))}
/* the π canvas, floating on top of an open super */
.win{left:88px}
.scene.floating{position:fixed;inset:auto;right:18px;bottom:18px;z-index:30;background:var(--paper);overflow:hidden;
box-shadow:0 22px 50px -18px rgba(20,20,30,.45)}
.scene.floating .frame{border-width:2px}
.scene.floating{cursor:grab;touch-action:none}.scene.floating.moving{cursor:grabbing}.scene.floating.locked{cursor:default}.scene.floating.picked{outline:3px solid var(--accent);outline-offset:3px;box-shadow:0 0 0 7px var(--accent-soft)}.scene.floating .stage{pointer-events:none}.scene.floating .pi-tab{pointer-events:auto}.scene.floating .sx{cursor:default;box-shadow:none}

.scene.floating .sx.lit{outline:6px solid var(--accent);outline-offset:4px;border-color:var(--accent)}
.pi-tab{position:absolute;left:8px;bottom:8px;z-index:4;width:26px;height:26px;display:grid;place-items:center;background:var(--ink);
color:var(--paper);font-size:16px;line-height:1}
.pi-tab:hover{text-decoration:none;background:var(--accent)}
/* a window resized larger than the screen (or kept from a bigger one) still shows its every edge */
.win{max-width:calc(100vw - 100px);max-height:calc(100vh - 24px)}
.focus.peek .win{max-width:calc((100vw - 100px) * .85 - 12px);max-height:calc(85vh - 12px)}
@media (max-width:699px){.scene.floating{top:auto;right:12px;bottom:76px}.win{left:8px;bottom:136px;min-width:0;max-width:calc(100vw - 16px);max-height:calc(100vh - 144px)}}
/* phones (owner, 2026-10-15): the controls on top, and a window fills all the screen between them and the rail */
@media (max-width:699px){
 .ctl-bar{top:8px!important;bottom:auto!important;gap:8px}
 .ctl-bar .pl,.ctl-bar .tip{display:none!important}
 .win,.focus.peek .win{left:0!important;right:0!important;top:62px!important;bottom:64px!important;width:auto!important;height:auto!important;
  min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;border-radius:0!important;border-left:0!important;border-right:0!important;box-shadow:none!important}
 .scene.floating{display:none!important}
 .canvas{padding-top:64px}
 .wire-note,.wire-note.page-note{top:66px!important;bottom:auto!important;left:12px!important;right:12px!important;transform:none!important;max-width:none!important;height:auto!important}
}
/* the polish layer (owner, 2026-10-15: "enhance the ui over all pro"): one focus ring, themed controls, steady
   buttons, cards with a little depth, readable line lengths, and tools as wide as every other page */
.head .eyebrow{display:block;font:600 11.5px/1 "Geist Mono",ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.head h1{letter-spacing:-.02em}
h2,h3{letter-spacing:-.01em}
.win-in .tool,.tool.tool{max-width:none}
.tool>.lede,.tool>p,.lede{max-width:72ch}
input[type=checkbox],input[type=radio],input[type=range],progress{accent-color:var(--accent)}
input[type=checkbox],input[type=radio]{width:16px;height:16px;flex:none;margin:2px 0 0;cursor:pointer}
input[type=range]{cursor:pointer}
:where(a,button,input,select,textarea,summary,label,[tabindex]):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card{box-shadow:0 1px 0 rgba(20,20,30,.03),0 10px 24px -20px rgba(20,20,30,.35)}
.btn{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:border-color .15s,background .15s,transform .1s}
.btn:active:not(:disabled){transform:translateY(1px)}
.btn:hover:not(:disabled){border-color:var(--ink)}
.btn.primary:disabled{background:#c9c7bf;border-color:#c9c7bf;color:#fff;opacity:1}
.hint{line-height:1.55}
.input{transition:border-color .15s,box-shadow .15s}.input:focus{border-color:var(--ink);box-shadow:0 0 0 3px rgba(47,64,232,.12)}
.perf-cards{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.err-box{border-left:3px solid var(--bad,#c92a2a)}
::selection{background:rgba(47,64,232,.18)}
"#;
