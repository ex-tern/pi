# HAL-OS images for the Lab

The Lab's HAL-OS window (back/rust/ui/src/hal.rs) boots these two disks on its own x86 machine:

- `shell.bin` is the HAL-OS shell. Build it with `nasm -f bin shell.asm -o shell.img`, then strip the trailing zeros.
- `bitllm.bin` is the ternary network, built by `bitllm_kernel.py` in the HAL-OS repository
  (github.com/neurophilic/HAL-OS). Strip its 8 MiB of trailing zeros: only the MBR and stage 2 hold anything.
  If the kernel's geometry, palette or wire constants change, change the constants at the top of hal.rs to match.
