; HAL-OS shell: a small 16-bit real-mode command prompt.
;
; Boots from sector 0 like the HAL-OS network image, loads the rest of itself
; from the following sectors with the BIOS, and offers a HAL-OS> prompt:
;   help clear echo time date uptime mem color calc note notes pi ver
;   reboot halt hal
; `hal` writes a marker to the serial port (COM1); the Lab's web portal
; (frontend/hal/hal.js) sees it and boots the ternary network image.
;
; Build:  nasm -f bin shell.asm -o shell.img     (scripts/build_hal_shell.py)
; Uses only the BIOS (int 10h video, 16h keyboard, 1Ah clock, 12h/15h memory,
; 13h disk), so it runs on v86, QEMU, VirtualBox or real hardware.

bits 16
org 0x7C00

; ---------------------------------------------------------------- sector 0
boot:
        cli
        xor  ax, ax
        mov  ds, ax
        mov  es, ax
        mov  ss, ax
        mov  sp, 0x7C00
        sti
        cld
        mov  [boot_drive], dl
        mov  ah, 0x02                    ; read sectors (CHS)
        mov  al, STAGE2_SECTORS
        mov  ch, 0
        mov  cl, 2
        mov  dh, 0
        mov  dl, [boot_drive]
        mov  bx, stage2                  ; 0x7E00: right after this sector
        int  0x13
        jc   .fail
        jmp  stage2
.fail:
        mov  si, msg_diskerr
.p:     lodsb
        or   al, al
        jz   .h
        mov  ah, 0x0E
        int  0x10
        jmp  .p
.h:     hlt
        jmp  .h

msg_diskerr db "HAL-OS: disk read error", 0
boot_drive  db 0
        times 510 - ($ - $$) db 0
        dw 0xAA55

; ---------------------------------------------------------------- stage 2
stage2:
        mov  byte [attr], 0x07
        mov  byte [notes_buf], 0          ; notes start empty
        mov  ah, 0x00                    ; ticks at boot, for `uptime`
        int  0x1A
        mov  [boot_lo], dx
        mov  [boot_hi], cx
        call cmd_clear
        mov  si, msg_banner
        call puts

main_loop:
        mov  si, msg_prompt
        call puts
        call readline
        call newline
        mov  si, linebuf
        call skip_spaces
        cmp  byte [si], 0
        je   main_loop
        mov  bx, commands
.find:
        mov  di, [bx]
        or   di, di
        jz   .unknown
        push si
        call word_eq
        pop  si
        jc   .found
        add  bx, 4
        jmp  .find
.found:
        call skip_word                   ; si -> after the command word
        call skip_spaces                 ; si -> its arguments
        call [bx + 2]
        jmp  main_loop
.unknown:
        push si
        mov  si, msg_unknown1
        call puts
        pop  si
.u:     lodsb
        or   al, al
        jz   .u2
        cmp  al, ' '
        je   .u2
        call putc
        jmp  .u
.u2:    mov  si, msg_unknown2
        call puts
        jmp  main_loop

commands:
        dw s_help,   cmd_help
        dw s_clear,  cmd_clear
        dw s_cls,    cmd_clear
        dw s_echo,   cmd_echo
        dw s_time,   cmd_time
        dw s_date,   cmd_date
        dw s_uptime, cmd_uptime
        dw s_mem,    cmd_mem
        dw s_color,  cmd_color
        dw s_calc,   cmd_calc
        dw s_note,   cmd_note
        dw s_notes,  cmd_notes
        dw s_pi,     cmd_pi
        dw s_ver,    cmd_ver
        dw s_about,  cmd_ver
        dw s_reboot, cmd_reboot
        dw s_halt,   cmd_halt
        dw s_hal,    cmd_hal
        dw 0, 0

s_help   db "help", 0
s_clear  db "clear", 0
s_cls    db "cls", 0
s_echo   db "echo", 0
s_time   db "time", 0
s_date   db "date", 0
s_uptime db "uptime", 0
s_mem    db "mem", 0
s_color  db "color", 0
s_calc   db "calc", 0
s_note   db "note", 0
s_notes  db "notes", 0
s_pi     db "pi", 0
s_ver    db "ver", 0
s_about  db "about", 0
s_reboot db "reboot", 0
s_halt   db "halt", 0
s_hal    db "hal", 0

; ---------------------------------------------------------------- commands
cmd_help:
        mov  si, msg_help
        jmp  puts

cmd_clear:
        mov  ax, 0x0600                  ; scroll whole window = clear
        mov  bh, [attr]
        xor  cx, cx
        mov  dx, 0x184F
        int  0x10
        mov  ah, 0x02                    ; cursor to 0,0
        xor  bh, bh
        xor  dx, dx
        int  0x10
        ret

cmd_echo:
        call puts
        jmp  newline

cmd_time:
        mov  ah, 0x02
        int  0x1A
        jc   rtc_fail
        mov  al, ch
        call put_bcd
        mov  al, ':'
        call putc
        mov  al, cl
        call put_bcd
        mov  al, ':'
        call putc
        mov  al, dh
        call put_bcd
        mov  si, msg_utc
        call puts
        jmp  newline

cmd_date:
        mov  ah, 0x04
        int  0x1A
        jc   rtc_fail
        mov  al, ch
        call put_bcd
        mov  al, cl
        call put_bcd
        mov  al, '-'
        call putc
        mov  al, dh
        call put_bcd
        mov  al, '-'
        call putc
        mov  al, dl
        call put_bcd
        jmp  newline
rtc_fail:
        mov  si, msg_rtc
        jmp  puts

cmd_uptime:
        mov  ah, 0x00
        int  0x1A                         ; cx:dx ticks since midnight (18.2/s)
        mov  ax, dx
        mov  dx, cx
        sub  ax, [boot_lo]
        sbb  dx, [boot_hi]
        jnc  .ok
        add  ax, 0x00B0                   ; passed midnight: add a day (0x1800B0 ticks)
        adc  dx, 0x0018
.ok:    cmp  dx, 18                       ; keep the quotient in 16 bits (~18 h)
        jb   .div
        mov  si, msg_long
        jmp  puts
.div:   mov  cx, 18
        div  cx                           ; ax = seconds (18 ticks ~ 1 s)
        xor  dx, dx
        mov  cx, 60
        div  cx                           ; ax = minutes, dx = seconds
        push dx
        call put_udec
        mov  si, msg_min
        call puts
        pop  ax
        call put_udec
        mov  si, msg_sec
        call puts
        jmp  newline

cmd_mem:
        int  0x12                         ; KB of conventional memory
        call put_udec
        mov  si, msg_conv
        call puts
        mov  ah, 0x88                     ; KB of extended memory
        int  0x15
        jc   .no
        call put_udec
        mov  si, msg_ext
        jmp  puts
.no:    ret

cmd_color:
        call parse_hex2
        jc   .usage
        mov  [attr], al
        jmp  cmd_clear
.usage: mov  si, msg_color
        jmp  puts

cmd_calc:
        call parse_int
        jc   .usage
        mov  [calc_a], ax
        call skip_spaces
        lodsb
        mov  [calc_op], al
        call skip_spaces
        call parse_int
        jc   .usage
        mov  bx, ax
        mov  ax, [calc_a]
        mov  cl, [calc_op]
        cmp  cl, '+'
        je   .add
        cmp  cl, '-'
        je   .sub
        cmp  cl, '*'
        je   .mul
        cmp  cl, 'x'
        je   .mul
        cmp  cl, '/'
        je   .div
        cmp  cl, '%'
        je   .mod
        jmp  .usage
.add:   add  ax, bx
        jmp  .out
.sub:   sub  ax, bx
        jmp  .out
.mul:   imul bx
        jmp  .out
.div:   or   bx, bx
        jz   .zero
        cwd
        idiv bx
        jmp  .out
.mod:   or   bx, bx
        jz   .zero
        cwd
        idiv bx
        mov  ax, dx
.out:   call put_sdec
        jmp  newline
.zero:  mov  si, msg_zero
        jmp  puts
.usage: mov  si, msg_calc
        jmp  puts

cmd_note:
        cmp  byte [si], 0
        je   cmd_notes
        mov  di, [notes_end]
.copy:  lodsb
        or   al, al
        jz   .done
        cmp  di, notes_buf + NOTES_MAX - 2
        jae  .full
        stosb
        jmp  .copy
.done:  mov  al, 10
        stosb
        mov  byte [di], 0
        mov  [notes_end], di
        mov  si, msg_noted
        jmp  puts
.full:  mov  byte [di], 0
        mov  [notes_end], di
        mov  si, msg_full
        jmp  puts

cmd_notes:
        mov  si, notes_buf
        cmp  byte [si], 0
        jne  .list
        mov  si, msg_nonotes
        jmp  puts
.list:  lodsb
        or   al, al
        jz   .end
        cmp  al, 10
        jne  .c
        call newline
        jmp  .list
.c:     call putc
        jmp  .list
.end:   ret

cmd_pi:
        mov  si, msg_pi
        jmp  puts

cmd_ver:
        mov  si, msg_ver
        jmp  puts

cmd_reboot:
        mov  si, msg_reboot
        call puts
        jmp  0xFFFF:0x0000

cmd_halt:
        mov  si, msg_halt
        call puts
        cli
.h:     hlt
        jmp  .h

cmd_hal:
        mov  si, msg_hal
        call puts
        mov  si, hal_marker               ; tell the portal to boot the network
.s:     lodsb
        or   al, al
        jz   .wait
        call serial_out
        jmp  .s
.wait:  sti
.w:     hlt
        jmp  .w

; ---------------------------------------------------------------- helpers
putc:                                     ; al
        push ax
        push bx
        mov  ah, 0x0E
        xor  bh, bh
        int  0x10
        pop  bx
        pop  ax
        ret

puts:                                     ; si -> zero-terminated, \n = newline
        push ax
.l:     lodsb
        or   al, al
        jz   .e
        cmp  al, 10
        jne  .c
        call newline
        jmp  .l
.c:     call putc
        jmp  .l
.e:     pop  ax
        ret

newline:
        push ax
        mov  al, 13
        call putc
        mov  al, 10
        call putc
        pop  ax
        ret

serial_out:                               ; al -> COM1
        push dx
        push ax
        mov  dx, 0x3FD
.w:     in   al, dx
        test al, 0x20
        jz   .w
        pop  ax
        mov  dx, 0x3F8
        out  dx, al
        pop  dx
        ret

put_bcd:                                  ; al = two BCD digits
        push ax
        shr  al, 4
        add  al, '0'
        call putc
        pop  ax
        and  al, 0x0F
        add  al, '0'
        jmp  putc

put_udec:                                 ; ax unsigned
        push ax
        push bx
        push cx
        push dx
        mov  bx, 10
        xor  cx, cx
.d:     xor  dx, dx
        div  bx
        push dx
        inc  cx
        or   ax, ax
        jnz  .d
.p:     pop  ax
        add  al, '0'
        call putc
        loop .p
        pop  dx
        pop  cx
        pop  bx
        pop  ax
        ret

put_sdec:                                 ; ax signed
        test ax, ax
        jns  put_udec
        push ax
        mov  al, '-'
        call putc
        pop  ax
        neg  ax
        jmp  put_udec

readline:                                 ; into linebuf, lowercase command typed as is
        mov  di, linebuf
        xor  cx, cx
.k:     xor  ah, ah
        int  0x16
        cmp  al, 13
        je   .done
        cmp  al, 8
        je   .bs
        cmp  al, 32
        jb   .k
        cmp  cx, LINE_MAX
        jae  .k
        stosb
        inc  cx
        call putc
        jmp  .k
.bs:    or   cx, cx
        jz   .k
        dec  di
        dec  cx
        mov  al, 8
        call putc
        mov  al, ' '
        call putc
        mov  al, 8
        call putc
        jmp  .k
.done:  mov  byte [di], 0
        ret

skip_spaces:
.l:     cmp  byte [si], ' '
        jne  .e
        inc  si
        jmp  .l
.e:     ret

skip_word:
.l:     mov  al, [si]
        or   al, al
        jz   .e
        cmp  al, ' '
        je   .e
        inc  si
        jmp  .l
.e:     ret

word_eq:                                  ; CF=1 if the word at si equals [di] (case-insensitive)
.l:     mov  al, [si]
        cmp  al, 'A'
        jb   .n
        cmp  al, 'Z'
        ja   .n
        add  al, 32
.n:     mov  ah, [di]
        or   ah, ah
        jz   .end
        cmp  al, ah
        jne  .no
        inc  si
        inc  di
        jmp  .l
.end:   or   al, al                       ; name ended: the word must end too
        jz   .yes
        cmp  al, ' '
        je   .yes
.no:    clc
        ret
.yes:   stc
        ret

parse_int:                                ; si -> ax, CF=1 if no digits
        xor  bx, bx
        xor  dx, dx                       ; dl = negative
        cmp  byte [si], '-'
        jne  .d0
        mov  dl, 1
        inc  si
.d0:    mov  al, [si]
        sub  al, '0'
        cmp  al, 9
        ja   .none
.d:     mov  al, [si]
        sub  al, '0'
        cmp  al, 9
        ja   .end
        xor  ah, ah
        push ax
        mov  ax, bx
        mov  cx, 10
        push dx
        mul  cx
        pop  dx
        pop  cx
        add  ax, cx
        mov  bx, ax
        inc  si
        jmp  .d
.end:   mov  ax, bx
        or   dl, dl
        jz   .ok
        neg  ax
.ok:    clc
        ret
.none:  stc
        ret

hexval:                                   ; al char -> al 0..15, CF=1 if not hex
        cmp  al, '0'
        jb   .bad
        cmp  al, '9'
        jbe  .dig
        or   al, 0x20
        cmp  al, 'a'
        jb   .bad
        cmp  al, 'f'
        ja   .bad
        sub  al, 'a' - 10
        clc
        ret
.dig:   sub  al, '0'
        clc
        ret
.bad:   stc
        ret

parse_hex2:                               ; si -> al (two hex digits), CF on error
        mov  al, [si]
        call hexval
        jc   .e
        mov  ah, al
        mov  al, [si + 1]
        call hexval
        jc   .e
        shl  ah, 4
        or   al, ah
        clc
.e:     ret

; ---------------------------------------------------------------- text
msg_banner  db "HAL-OS 0.2", 10
            db "A tiny 16-bit operating system. Type help for commands,", 10
            db "or hal to start the ternary network.", 10, 10, 0
msg_prompt  db "HAL-OS> ", 0
msg_unknown1 db "Unknown command: ", 0
msg_unknown2 db ". Type help.", 10, 0
msg_help    db "  help            this list", 10
            db "  clear           clear the screen", 10
            db "  echo TEXT       print TEXT", 10
            db "  time, date      the clock (UTC)", 10
            db "  uptime          time since boot", 10
            db "  mem             memory", 10
            db "  color XY        colours: X background, Y text (hex), e.g. color 1f", 10
            db "  calc A op B     integer maths: + - * / %", 10
            db "  note TEXT       keep a note; notes lists them (lost on reboot)", 10
            db "  pi              100 digits of pi", 10
            db "  ver             about HAL-OS", 10
            db "  reboot, halt    restart or stop the machine", 10
            db "  hal             start the ternary network", 10, 0
msg_utc     db " UTC", 0
msg_rtc     db "The clock is not available.", 10, 0
msg_long    db "Up for more than 18 hours.", 10, 0
msg_min     db " min ", 0
msg_sec     db " s", 0
msg_conv    db " KB conventional memory", 10, 0
msg_ext     db " KB extended memory", 10, 0
msg_color   db "Usage: color XY, two hex digits, e.g. color 1f (white on blue), color 07 (default)", 10, 0
msg_calc    db "Usage: calc A op B, e.g. calc 12 * 7 (whole numbers from -32768 to 32767)", 10, 0
msg_zero    db "Cannot divide by zero.", 10, 0
msg_noted   db "Noted.", 10, 0
msg_full    db "Notes are full.", 10, 0
msg_nonotes db "No notes yet. Write one with: note TEXT", 10, 0
msg_pi      db "3.1415926535 8979323846 2643383279 5028841971 6939937510", 10
            db "  5820974944 5923078164 0628620899 8628034825 3421170679", 10, 0
msg_ver     db "HAL-OS 0.2: a 16-bit real-mode shell on the BIOS, plus a bare-metal", 10
            db "ternary network (32,000 neurons painting VGA mode 13h). Type hal to start it.", 10
            db "Source: github.com/ex-tern/pi and github.com/neurophilic/HAL-OS", 10, 0
msg_reboot  db "Rebooting...", 10, 0
msg_halt    db "System halted. It is now safe to close this window.", 10, 0
msg_hal     db "Starting the ternary network...", 10, 0
hal_marker  db 27, "HAL-OS:BOOT-NETWORK", 10, 0

; ---------------------------------------------------------------- data
LINE_MAX    equ 76
NOTES_MAX   equ 2048
attr        db 0x07
calc_a      dw 0
calc_op     db 0
boot_lo     dw 0
boot_hi     dw 0
notes_end   dw notes_buf

        align 512, db 0
stage2_end:
STAGE2_SECTORS equ (stage2_end - stage2) / 512

; uninitialised buffers live past the image
linebuf     equ 0x9000
notes_buf   equ 0x9100
