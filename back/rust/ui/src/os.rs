// piii-OS onto a flash drive, from the site (owner, 2026-10-17: "make a tool on piii.app web app to write the os to
// the flash to boot instead of balena etcher"). Included into app.rs.
//
// A browser may not write a disk image to a USB drive (Chrome keeps web pages away from USB storage), but it may write
// files into a folder the person chooses. piii-OS needs no image: a FAT32 drive with EFI/BOOT/BOOTX64.EFI on it
// starts any UEFI computer (a Mac with Option held). So: the person picks the drive; host.js (op "osflash") fetches
// /os/BOOTX64.EFI from this site, writes it there and reads it back to check. Browsers without folder access get the
// file to copy by hand, and the image for balenaEtcher.

#[derive(Default)]
pub struct OsFlash {
    busy: bool,
    step: String,
    err: String,
    /// the drive chosen: its name, how many things are at its top, and the first of their names
    picked: Option<(String, usize, Vec<String>)>,
    /// erase it first (owner, 2026-10-17: "make this so when you write it formats the flash drive first"), confirmed by
    /// typing ERASE
    erase: bool,
    typed: String,
    /// written: (bytes, the drive's name, an older boot file kept, into the drive (true) or its EFI folder, things
    /// erased, things that would not go)
    done: Option<(usize, String, bool, bool, usize, usize)>,
    how: u8,
}

const OS_TOKEN: u32 = 7_000_000;
const OS_FILE: &str = "/os/BOOTX64.EFI";
const OS_RELEASE: &str = "https://github.com/ex-tern/pi/releases/tag/piii-os";

fn os_flash_got(data: Vec<u8>) {
    let s = String::from_utf8(data).unwrap_or_default();
    let o = &mut st().osf;
    if let Some(m) = s.strip_prefix("step ") {
        o.step = m.to_string();
        return;
    }
    if let Some(m) = s.strip_prefix("picked ") {
        let p: Vec<&str> = m.split('\t').collect();
        o.busy = false;
        o.step.clear();
        o.err.clear();
        o.typed.clear();
        o.picked = Some((
            p.first().unwrap_or(&"").to_string(),
            p.get(1).and_then(|x| x.parse().ok()).unwrap_or(0),
            p.iter().skip(2).map(|x| x.to_string()).collect(),
        ));
        // an empty drive needs no erasing
        if o.picked.as_ref().map(|x| x.1 == 0).unwrap_or(false) {
            o.erase = false;
        }
        return;
    }
    o.busy = false;
    o.step.clear();
    if let Some(m) = s.strip_prefix("error ") {
        o.err = if m == "cancelled" { String::new() } else { m.to_string() };
        return;
    }
    if let Some(m) = s.strip_prefix("done ") {
        let p: Vec<&str> = m.split('\t').collect();
        o.err.clear();
        o.done = Some((
            p.first().and_then(|x| x.parse().ok()).unwrap_or(0),
            p.get(1).unwrap_or(&"").to_string(),
            p.get(2) == Some(&"1"),
            p.get(3) != Some(&"efi"),
            p.get(4).and_then(|x| x.parse().ok()).unwrap_or(0),
            p.get(5).and_then(|x| x.parse().ok()).unwrap_or(0),
        ));
        o.picked = None;
        o.erase = false;
        o.typed.clear();
    }
}

fn os_update(a: u16, v: String) {
    let o = &mut st().osf;
    match a {
        // choose the drive
        1 => {
            o.err.clear();
            o.done = None;
            o.picked = None;
            if host::call("ospick", "").is_none() {
                o.err = "This browser cannot write to a drive. Use Chrome or Edge on a computer, or the download below.".into();
            } else {
                o.busy = true;
                o.step = "Choose your flash drive in the window that opened…".into();
            }
        }
        4 => {
            o.erase = v == "1";
            o.typed.clear();
        }
        5 => o.typed = v,
        // write (erasing first if asked and confirmed)
        6 => {
            if o.erase && o.typed.trim() != "ERASE" {
                o.err = "Type ERASE to confirm that everything on the drive may be deleted, or untick Erase.".into();
                return;
            }
            o.err.clear();
            let arg = format!("{}\t{}", OS_FILE, if o.erase { "1" } else { "0" });
            if host::call("oswrite", &arg).is_none() {
                o.err = "Choose the drive again.".into();
                o.picked = None;
            } else {
                o.busy = true;
                o.step = "Starting…".into();
            }
        }
        2 => o.how = v.parse().unwrap_or(0),
        3 => {
            o.done = None;
            o.picked = None;
            o.err.clear();
        }
        _ => {}
    }
}

fn os_step(n: &str, title: &str, body: N) -> N {
    el("div").cls("osf-step").kid(el("span").cls("osf-n").text(n.to_string())).kid(el("div").kid(el("h3").text(title.to_string())).kid(body)).into()
}

fn os_view(s: &State) -> N {
    let o = &s.osf;
    let can = host::call("canpick", "").as_deref() == Some("1");
    let formats: [(&str, &[&str]); 3] = [
        ("Mac", &["Open Disk Utility, choose the flash drive (the drive, not a volume under it).", "Erase: Format MS-DOS (FAT), Scheme Master Boot Record."]),
        ("Windows", &["File Explorer → right-click the drive → Format.", "File system FAT32 → Start. (Over 32 GB, Windows offers only exFAT: use a smaller drive, or Rufus.)"]),
        ("Linux", &["Disks → the flash drive → ⋮ Format Disk (MBR), then + a partition of type FAT."]),
    ];
    let fmt = formats[(o.how as usize).min(2)];
    let step1 = el("div")
        .kid(el("p").text("Most flash drives come this way already. If yours is new from the shop, go on to 2. Otherwise, or if it does not start in 3, format it (this erases it):"))
        .kid(el("div").cls("osf-tabs").kids(formats.iter().enumerate().map(|(i, (name, _))| -> N {
            el("button").attr("type", "button").cls("btn small").cls_if(o.how as usize == i, "primary").on("click", Msg::T(Tool::OsFlash, 2, format!("{}", i))).text(name.to_string()).into()
        })))
        .kid(el("ol").cls("osf-list").kids(fmt.1.iter().map(|l| -> N { el("li").text(l.to_string()).into() })));

    let step2: N = if !can {
        el("div")
            .kid(el("p").cls("osf-warn").text("This browser cannot write to a drive (Chrome and Edge on a computer can). Instead:"))
            .kid(el("ol").cls("osf-list")
                .kid(el("li").kid(el("a").cls("btn small primary").attr("href", OS_FILE).attr("download", "BOOTX64.EFI").text("Download BOOTX64.EFI")))
                .kid(el("li").text("On the flash drive, make a folder EFI, and in it a folder BOOT."))
                .kid(el("li").text("Copy BOOTX64.EFI into EFI/BOOT.")))
            .kid(el("p").cls("hint").kid(el("span").text("Or write the whole image with balenaEtcher: ")).kid(ext_link(OS_RELEASE, "piii-os.img.gz")))
            .into()
    } else if let Some((bytes, name, kept, drive, erased, left)) = &o.done {
        el("div")
            .kid(el("p").cls("osf-ok").text(format!(
                "piii-OS is on {}: EFI/BOOT/BOOTX64.EFI, {} KB, checked after writing.",
                if name.is_empty() { "the drive".to_string() } else { format!("“{}”", name) },
                bytes / 1024
            )))
            .kid_if(*erased > 0, || el("p").cls("hint").text(format!("The drive was erased first: {} thing{} deleted{}.", erased, if *erased == 1 { "" } else { "s" }, if *left > 0 { format!("; {} of the system's own would not go (harmless)", left) } else { String::new() })).into())
            .kid_if(*kept, || el("p").cls("hint").text("A boot file that was already there is kept beside it as BOOTX64-before-piii.EFI.").into())
            .kid_if(!*drive, || el("p").cls("hint").text("It went into the EFI folder you chose. That folder must be at the top of the drive.").into())
            .kid(el("p").cls("hint").text("Eject the drive before you unplug it (Mac: ⏏ in Finder; Windows: Safely Remove), so everything is really on it."))
            .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::OsFlash, 3, String::new())).text("Write another drive"))
            .into()
    } else if let Some((name, count, names)) = &o.picked {
        let shown = if names.is_empty() { String::new() } else { format!(": {}{}", names.join(", "), if *count > names.len() { ", …" } else { "" }) };
        let ready = !o.erase || o.typed.trim() == "ERASE";
        el("div")
            .kid(el("p").kid(el("b").text(format!("“{}”", if name.is_empty() { "the drive" } else { name.as_str() }))).kid(el("span").text(if *count == 0 {
                " is empty.".to_string()
            } else {
                format!(" has {} thing{} at its top{}", count, if *count == 1 { "" } else { "s" }, shown)
            })))
            .kid_if(*count > 0, || {
                el("label")
                    .cls("osf-erase")
                    .kid(el("input").attr("type", "checkbox").prop("checked", if o.erase { "1" } else { "0" }).on_val("change", |v| Msg::T(Tool::OsFlash, 4, v)))
                    .kid(el("span").text("Erase everything on it first (as formatting does). This deletes those files for good."))
                    .into()
            })
            .kid_if(o.erase, || {
                el("label")
                    .cls("osf-confirm")
                    .kid(el("span").text("Is this really the flash drive? Type ERASE to confirm:"))
                    .kid(el("input").attr("type", "text").attr("autocomplete", "off").attr("spellcheck", "false").prop("value", o.typed.clone()).on("input", Msg::TV(Tool::OsFlash, 5)))
                    .into()
            })
            .kid(el("div").cls("row")
                .kid(el("button").attr("type", "button").cls("btn primary osf-go").attr_if(o.busy || !ready, "disabled", "").on("click", Msg::T(Tool::OsFlash, 6, String::new()))
                    .text(if o.busy { "Working…" } else if o.erase { "Erase and write piii-OS" } else { "Write piii-OS" }))
                .kid(el("button").attr("type", "button").cls("btn small").attr_if(o.busy, "disabled", "").on("click", Msg::T(Tool::OsFlash, 1, String::new())).text("Choose another")))
            .kid_if(!o.step.is_empty(), || el("p").cls("hint").attr("role", "status").text(o.step.clone()).into())
            .kid_if(!o.err.is_empty(), || el("p").cls("osf-warn").attr("role", "alert").text(format!("It did not work: {}", o.err)).into())
            .into()
    } else {
        el("div")
            .kid(el("p").text("Plug in the flash drive, press the button, and choose the drive itself in the window that opens. You will see what is on it, and can erase it before piii-OS is written."))
            .kid(el("button").attr("type", "button").cls("btn primary osf-go").attr_if(o.busy, "disabled", "").on("click", Msg::T(Tool::OsFlash, 1, String::new()))
                .text(if o.busy { "Choosing…" } else { "Choose the flash drive" }))
            .kid_if(!o.step.is_empty(), || el("p").cls("hint").attr("role", "status").text(o.step.clone()).into())
            .kid_if(!o.err.is_empty(), || el("p").cls("osf-warn").attr("role", "alert").text(format!("It did not work: {}", o.err)).into())
            .kid(el("p").cls("hint").text("If the browser will not open the drive itself, make a folder named EFI at the top of the drive and choose that folder instead."))
            .into()
    };

    let step3 = el("div")
        .kid(el("ul").cls("osf-list")
            .kid(el("li").kid(el("b").text("Mac (Intel): ")).kid(el("span").text("plug the drive in, switch the Mac on while holding Option (⌥), and choose EFI Boot.")))
            .kid(el("li").kid(el("b").text("PC: ")).kid(el("span").text("press the boot-menu key as it starts (F12, F11, F9 or Esc) and choose the flash drive. If it refuses, turn off Secure Boot in its settings."))))
        .kid(el("p").cls("hint").text("Nothing on the computer's own disk changes: take the drive out and it starts as before. No mouse in piii-OS? The arrow keys move the pointer, Enter clicks, Tab jumps to the next super."));

    el("div")
        .cls("tool osf")
        .kid(el("p").cls("lede").text("piii-OS is the π canvas as a whole operating system: it starts straight from a computer's firmware, with nothing underneath, and runs the Program language, the exact constants and more. Put it on a flash drive from here and start a computer from it."))
        .kid(os_step("1", "A flash drive formatted FAT32", step1.into()))
        .kid(os_step("2", "Write piii-OS to it", step2))
        .kid(os_step("3", "Start a computer from it", step3.into()))
        .kid(el("p").cls("hint").kid(el("span").text("piii-OS 0.1 · 250 KB · ")).kid(ext_link("https://github.com/ex-tern/pi/tree/main/back/rust/os", "how it is made")).kid(el("span").text(" · ")).kid(ext_link(OS_RELEASE, "the release")))
        .into()
}

const OS_CSS: &str = "\
.osf{max-width:820px}\
.osf-step{display:grid;grid-template-columns:40px 1fr;gap:14px;padding:18px 0;border-top:1px solid var(--line)}\
.osf-n{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:var(--ink);color:var(--card);font-weight:600}\
.osf-step h3{margin:4px 0 8px;font-size:16px}\
.osf-step p{margin:6px 0}\
.osf-tabs{display:flex;gap:6px;margin:10px 0 4px;flex-wrap:wrap}\
.osf-list{padding-left:20px;line-height:1.6;font-size:14px;margin:8px 0}\
.osf-list li{margin:4px 0}\
.osf .btn.osf-go{font-size:15px;padding:12px 20px;margin:8px 0}\
.osf-ok{border-left:3px solid #1f8a4c;padding:8px 12px;background:var(--card);font-weight:500}\
.osf-warn{border-left:3px solid #b4561b;padding:8px 12px;background:var(--card)}\
.osf-erase{display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-size:14px;cursor:pointer}\
.osf-erase input{margin-top:3px}\
.osf-confirm{display:grid;gap:6px;margin:8px 0 12px;font-size:14px;max-width:360px}\
.osf-confirm input{font:inherit;padding:8px 10px;border:1px solid var(--line2);background:var(--card);color:var(--ink);letter-spacing:.08em}\
@media (max-width:600px){.osf-step{grid-template-columns:1fr}}\
";
