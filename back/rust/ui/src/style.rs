//! The style sheet: ink on flat paper, one cobalt accent, Geist type, sentence case.

pub const CSS: &str = r#"
@font-face{font-family:Geist;src:url(/fonts/Geist-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Geist Mono";src:url(/fonts/GeistMono-Variable.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--paper:#f7f5ef;--card:#fffefb;--ink:#16181d;--muted:#5f6472;--faint:#8b8f99;--line:#e2ded2;--line2:#cfcabb;
--accent:#2348d8;--accent-soft:#e8edfc;--good:#1d7a4a;--good-soft:#e3f3ea;--warn:#9a5b00;--warn-soft:#fbf0dc;
--bad:#b3261e;--bad-soft:#fbe7e5;--r:14px;--r2:10px;color-scheme:light}
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
.consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:20;max-width:560px;margin:0 auto;background:var(--card);
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
"#;
