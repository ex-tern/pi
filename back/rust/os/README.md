# piii OS

The π canvas as a whole operating system. It starts straight from the computer's firmware, with nothing
underneath: no Linux, no macOS, no Windows. It draws every super, wire and letter itself and reads the keyboard and
mouse on its own. It is written in Rust with no standard library and no dependencies but the lab's own `numbers`.

- **The canvas**: supers (superellipses, n = π) with their four terminals, flow and control wires. Drag a super to
  move it, click it to open it, and press π or Esc to come back.
- **Program**: piii.app's dataflow language (registers, gates, lists; Turing complete) with its five examples:
  count to 10, factorial, Fibonacci, Euclid's gcd and a busy-beaver Turing machine.
- **Numbers**: π, e, φ and γ worked out exactly, up to 20 000 digits.
- **Devices**: the processor, firmware, screen, keyboard and pointers it found; restart and switch off.
- **Tools, Explore, Library, Lab, Connect** need the lab's servers. piii OS has no network yet, so they list what
  they hold.

No mouse? The arrow keys move the pointer, Enter or Space clicks, and Tab jumps to the next thing to click.

## Put it on a USB stick and start a computer from it

1. Download **piii-os.img.gz** from the [piii-os release](https://github.com/ex-tern/pi/releases/tag/piii-os).
2. Open **balenaEtcher**: *Flash from file* → piii-os.img.gz, *Select target* → your USB stick (everything on it is
   erased), then *Flash*.
3. Plug the stick into the computer and start it from the stick:
   - **A Mac** (Intel, 2008 or later): hold **Option (⌥)** from the moment you switch it on, then choose **EFI Boot**.
   - **A PC**: press the boot-menu key at start-up (often F12, F11, F9 or Esc) and choose the USB stick. Turn off
     Secure Boot in the firmware settings if it refuses.

Nothing on the computer's own disk is changed: take the stick out and it starts as before.

**A Bluetooth mouse on a Mac.** Macs hand a paired Bluetooth mouse to the firmware as an ordinary mouse (Apple's
"HID proxy"), so piii OS can use it without a Bluetooth driver of its own. The mouse must have been paired in macOS
on that Mac. Devices lists the pointers piii OS found.

## Build it

```bash
python3 back/scripts/tools.py build-os                  # needs: rustup component add rust-src (SSE2 target: x86_64-piii-uefi.json)
python3 back/scripts/tools.py build-os --library DIR    # or from the standard library's source, as build-ui
```

The result is `back/rust/os/esp/EFI/BOOT/BOOTX64.EFI` (copy the `EFI` folder onto a FAT32 stick to boot it).

On this computer, the same app draws its screens as pictures, driven by scripted clicks:

```bash
cd back/rust/os && cargo test --release && cargo run --release -- shots /tmp/shots
```

The **piii OS** workflow (`.github/workflows/piii-os.yml`) builds it, boots it in QEMU on UEFI firmware (OVMF), drives
it with the keyboard and a USB mouse, keeps the screenshots, and publishes `piii-os.img.gz` and `BOOTX64.EFI`.

## How it is made

| | |
|---|---|
| `src/boot.rs` | `efi_main`: the screen (GOP, or UGA on older Macs, switched to graphics), the keyboard, the pointers, the loop |
| `src/uefi.rs` | the firmware's tables and protocols, declared by hand, kept to what EFI 1.10 also has |
| `src/app.rs` | the canvas and every super's page; knows nothing of the firmware |
| `src/lang.rs` | the Program language |
| `src/gfx.rs` | superellipses, wires, shapes, text |
| `src/font.rs` | the Spleen bitmap font (BSD 2-clause, `fonts/SPLEEN-LICENSE`), made by `tools/font.py` |
| `src/shots.rs` | the pictures, on an ordinary computer |

piii OS stays on the firmware's boot services, so the firmware keeps driving USB. Next: its own network (to reach
piii.app), and its own USB and Bluetooth drivers for computers whose firmware has no mouse.
