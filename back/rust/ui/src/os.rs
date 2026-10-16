// piii OS onto a flash drive, from the site (owner, 2026-10-17: "make a tool on piii.app web app to write the os to
// the flash to boot instead of balena etcher"). Included into app.rs.
//
// A browser may not write a disk image to a USB drive (Chrome keeps web pages away from USB storage), but it may write
// files into a folder the person chooses. piii OS needs no image: a FAT32 drive with EFI/BOOT/BOOTX64.EFI on it
// starts any UEFI computer (a Mac with Option held). So: the person picks the drive; host.js (op "osflash") fetches
// /os/BOOTX64.EFI from this site, writes it there and reads it back to check. Browsers without folder access get the
// file to copy by hand, and the image for balenaEtcher.

#[derive(Default)]
pub struct OsFlash {
    busy: bool,
    step: String,
    err: String,
    /// written: (bytes, the drive's name, an older boot file kept, written into the drive (true) or its EFI folder)
    done: Option<(usize, String, bool, bool)>,
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
        ));
    }
}

fn os_update(a: u16, v: String) {
    let o = &mut st().osf;
    match a {
        1 => {
            o.err.clear();
            o.done = None;
            if host::call("osflash", OS_FILE).is_none() {
                o.err = "This browser cannot write to a drive. Use Chrome or Edge on a computer, or the download below.".into();
            } else {
                o.busy = true;
                o.step = "Choose your flash drive in the window that opened…".into();
            }
        }
        2 => o.how = v.parse().unwrap_or(0),
        3 => {
            o.done = None;
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
    } else if let Some((bytes, name, kept, drive)) = &o.done {
        el("div")
            .kid(el("p").cls("osf-ok").text(format!(
                "piii OS is on {}: EFI/BOOT/BOOTX64.EFI, {} KB, checked after writing.",
                if name.is_empty() { "the drive".to_string() } else { format!("“{}”", name) },
                bytes / 1024
            )))
            .kid_if(*kept, || el("p").cls("hint").text("A boot file that was already there is kept beside it as BOOTX64-before-piii.EFI.").into())
            .kid_if(!*drive, || el("p").cls("hint").text("It went into the EFI folder you chose. That folder must be at the top of the drive.").into())
            .kid(el("p").cls("hint").text("Eject the drive before you unplug it (Mac: ⏏ in Finder; Windows: Safely Remove), so everything is really on it."))
            .kid(el("button").attr("type", "button").cls("btn small").on("click", Msg::T(Tool::OsFlash, 3, String::new())).text("Write another drive"))
            .into()
    } else {
        el("div")
            .kid(el("p").text("Plug in the flash drive, press the button, and choose the drive itself in the window that opens. piii OS is written onto it as one file; nothing else on the drive is touched."))
            .kid(el("button").attr("type", "button").cls("btn primary osf-go").attr_if(o.busy, "disabled", "").on("click", Msg::T(Tool::OsFlash, 1, String::new()))
                .text(if o.busy { "Writing…" } else { "Write piii OS to a flash drive" }))
            .kid_if(!o.step.is_empty(), || el("p").cls("hint").attr("role", "status").text(o.step.clone()).into())
            .kid_if(!o.err.is_empty(), || el("p").cls("osf-warn").attr("role", "alert").text(format!("It did not work: {}", o.err)).into())
            .kid(el("p").cls("hint").text("If the browser will not open the drive itself, make a folder named EFI at the top of the drive and choose that folder instead."))
            .into()
    };

    let step3 = el("div")
        .kid(el("ul").cls("osf-list")
            .kid(el("li").kid(el("b").text("Mac (Intel): ")).kid(el("span").text("plug the drive in, switch the Mac on while holding Option (⌥), and choose EFI Boot.")))
            .kid(el("li").kid(el("b").text("PC: ")).kid(el("span").text("press the boot-menu key as it starts (F12, F11, F9 or Esc) and choose the flash drive. If it refuses, turn off Secure Boot in its settings."))))
        .kid(el("p").cls("hint").text("Nothing on the computer's own disk changes: take the drive out and it starts as before. No mouse in piii OS? The arrow keys move the pointer, Enter clicks, Tab jumps to the next super."));

    el("div")
        .cls("tool osf")
        .kid(el("p").cls("lede").text("piii OS is the π canvas as a whole operating system: it starts straight from a computer's firmware, with nothing underneath, and runs the Program language, the exact constants and more. Put it on a flash drive from here and start a computer from it."))
        .kid(os_step("1", "A flash drive formatted FAT32", step1.into()))
        .kid(os_step("2", "Write piii OS to it", step2))
        .kid(os_step("3", "Start a computer from it", step3.into()))
        .kid(el("p").cls("hint").kid(el("span").text("piii OS 0.1 · 250 KB · ")).kid(ext_link("https://github.com/ex-tern/pi/tree/main/back/rust/os", "how it is made")).kid(el("span").text(" · ")).kid(ext_link(OS_RELEASE, "the release")))
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
@media (max-width:600px){.osf-step{grid-template-columns:1fr}}\
";
