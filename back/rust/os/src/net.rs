//! piii OS on the network (owner, 2026-10-17: "add a simple browser to reach piii.app on piii os"): its own small
//! internet stack over the firmware's Simple Network Protocol, which gives a network card's frames in and out (a
//! 2008 Mac's Ethernet has it, for NetBoot; its Wi-Fi does not). Everything else is here: ARP (whose card has
//! which address), IPv4, UDP, DHCP (an address from the router), DNS (names to addresses) and TCP (a connection,
//! in order, with resending), and HTTP over it (web.rs makes and reads the messages).
//!
//! It works one request at a time and waits for it: the browser shows "Loading…" first.

use crate::uefi::{self, *};
use crate::web::{self, Response, Url};
use alloc::format;
use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;
use core::ffi::c_void;

type Ip = [u8; 4];
type Mac = [u8; 6];

const BROADCAST: Mac = [0xff; 6];
const ETH_IP: u16 = 0x0800;
const ETH_ARP: u16 = 0x0806;

pub struct Net {
    snp: *mut Snp,
    pub mac: Mac,
    pub ip: Ip,
    mask: Ip,
    gw: Ip,
    dns: Ip,
    arp: Vec<(Ip, Mac)>,
    udp_in: Vec<(u16, Ip, u16, Vec<u8>)>,
    tcp: Option<Tcp>,
    ip_id: u16,
    port: u16,
    rx: Vec<u8>,
    tx: Vec<u8>,
    /// how it is connected, in words (shown by the browser)
    pub how: String,
}

struct Tcp {
    ip: Ip,
    port: u16,
    local: u16,
    /// the next sequence number to send, and the oldest not yet acknowledged
    nxt: u32,
    una: u32,
    /// the next byte expected from the other side
    rcv: u32,
    connected: bool,
    fin: bool,
    reset: bool,
    data: Vec<u8>,
    /// what was sent and not yet acknowledged, to send again
    unacked: Vec<u8>,
    una_start: u32,
}

fn ms() -> u64 {
    uefi::now_ms()
}

fn sum16(data: &[u8], mut acc: u32) -> u32 {
    let mut i = 0;
    while i + 1 < data.len() {
        acc += u16::from_be_bytes([data[i], data[i + 1]]) as u32;
        i += 2;
    }
    if i < data.len() {
        acc += (data[i] as u32) << 8;
    }
    acc
}

fn fold(mut acc: u32) -> u16 {
    while acc > 0xffff {
        acc = (acc & 0xffff) + (acc >> 16);
    }
    !(acc as u16)
}

fn ip_text(ip: Ip) -> String {
    format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3])
}

fn parse_ip(s: &str) -> Option<Ip> {
    let p: Vec<&str> = s.split('.').collect();
    if p.len() != 4 {
        return None;
    }
    let mut ip = [0u8; 4];
    for i in 0..4 {
        ip[i] = p[i].parse().ok()?;
    }
    Some(ip)
}

impl Net {
    /// Finds a network card the firmware can drive, starts it, and asks the network for an address (DHCP).
    pub fn start() -> Result<Net, String> {
        // the firmware's drivers for every device, started (a Mac starting fast leaves its Ethernet's driver off)
        if uefi::handles(&SNP).is_empty() {
            for h in uefi::all_handles() {
                uefi::connect(h);
            }
        }
        let cards = uefi::handles(&SNP);
        if cards.is_empty() {
            return Err("No network card the firmware can drive. On a Mac: plug in an Ethernet cable (its Wi-Fi has no driver at start-up).".into());
        }
        let mut last = String::from("The network card did not start.");
        for h in cards {
            // the firmware's own network stack lets go of the card, or it would take the frames
            let freed = uefi::release_drivers(h, &SNP);
            let Some(snp) = uefi::handle_protocol::<Snp>(h, &SNP) else { continue };
            unsafe {
                let mode = (*snp).mode;
                if (*mode).state == 0 {
                    ((*snp).start)(snp);
                }
                if (*mode).state == 1 {
                    ((*snp).initialize)(snp, 0, 0);
                }
                if (*mode).state != 2 {
                    last = "The network card would not start.".into();
                    continue;
                }
                if (*mode).hw_address_size != 6 || (*mode).if_type != 1 {
                    continue;
                }
                // our own address and everyone's (broadcast); and the card's multicast as it was
                ((*snp).receive_filters)(snp, 0x01 | 0x04, 0, 0, 0, core::ptr::null());
                let mut mac = [0u8; 6];
                let cur = core::ptr::addr_of!((*mode).current_address).read();
                mac.copy_from_slice(&cur.0[..6]);
                if (*mode).media_present_supported != 0 && (*mode).media_present == 0 {
                    last = "The network cable is not plugged in (or the other end is off).".into();
                    continue;
                }
                uefi::log(&format!("piii OS: network card {:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x} ({} firmware drivers let go)", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], freed));
                let mut n = Net {
                    snp,
                    mac,
                    ip: [0; 4],
                    mask: [255, 255, 255, 0],
                    gw: [0; 4],
                    dns: [0; 4],
                    arp: Vec::new(),
                    udp_in: Vec::new(),
                    tcp: None,
                    ip_id: (uefi::tsc() & 0xffff) as u16,
                    port: 40000 + (uefi::tsc() % 20000) as u16,
                    rx: vec![0u8; 2048],
                    tx: vec![0u8; 2048],
                    how: String::new(),
                };
                match n.dhcp() {
                    Ok(()) => {
                        n.how = format!("Ethernet, address {} (gateway {}, names from {})", ip_text(n.ip), ip_text(n.gw), ip_text(n.dns));
                        uefi::log(&format!("piii OS: network: {}", n.how));
                        return Ok(n);
                    }
                    Err(e) => last = e,
                }
            }
        }
        Err(last)
    }

    // -------------------------------------------------------------------------------------------- frames

    fn send_frame(&mut self, dst: Mac, kind: u16, payload: &[u8]) {
        let len = (14 + payload.len()).max(60);
        if len > self.tx.len() {
            return;
        }
        for b in self.tx[..len].iter_mut() {
            *b = 0;
        }
        self.tx[0..6].copy_from_slice(&dst);
        self.tx[6..12].copy_from_slice(&self.mac);
        self.tx[12..14].copy_from_slice(&kind.to_be_bytes());
        self.tx[14..14 + payload.len()].copy_from_slice(payload);
        let snp = self.snp;
        for _ in 0..100 {
            let r = unsafe { ((*snp).transmit)(snp, 0, len, self.tx.as_mut_ptr() as *mut c_void, core::ptr::null(), core::ptr::null(), core::ptr::null()) };
            if r == NOT_READY {
                self.recycle();
                uefi::stall(50);
                continue;
            }
            break;
        }
        // the card hands the frame's buffer back when sent (some cards need asking before they take another)
        for _ in 0..2000 {
            if self.recycle() {
                break;
            }
            uefi::stall(5);
        }
    }

    /// whether the card gave back a sent buffer
    fn recycle(&mut self) -> bool {
        let snp = self.snp;
        let mut irq = 0u32;
        let mut buf: *mut c_void = core::ptr::null_mut();
        unsafe { ((*snp).get_status)(snp, &mut irq, &mut buf) };
        !buf.is_null()
    }

    /// Everything that arrived, handled (ARP answered, UDP kept, TCP given to the connection).
    fn poll(&mut self) {
        let snp = self.snp;
        for _ in 0..64 {
            let mut len = self.rx.len();
            let r = unsafe {
                ((*snp).receive)(snp, core::ptr::null_mut(), &mut len, self.rx.as_mut_ptr() as *mut c_void, core::ptr::null_mut(), core::ptr::null_mut(), core::ptr::null_mut())
            };
            if r != SUCCESS || len < 14 {
                return;
            }
            let frame = self.rx[..len].to_vec();
            self.frame(&frame);
        }
    }

    fn frame(&mut self, f: &[u8]) {
        let kind = u16::from_be_bytes([f[12], f[13]]);
        let p = &f[14..];
        if kind == ETH_ARP && p.len() >= 28 {
            let op = u16::from_be_bytes([p[6], p[7]]);
            let mut smac = [0u8; 6];
            smac.copy_from_slice(&p[8..14]);
            let sip: Ip = [p[14], p[15], p[16], p[17]];
            let tip: Ip = [p[24], p[25], p[26], p[27]];
            if sip != [0; 4] {
                self.learn(sip, smac);
            }
            if op == 1 && tip == self.ip && self.ip != [0; 4] {
                let mut a = [0u8; 28];
                a[..8].copy_from_slice(&[0, 1, 8, 0, 6, 4, 0, 2]);
                a[8..14].copy_from_slice(&self.mac);
                a[14..18].copy_from_slice(&self.ip);
                a[18..24].copy_from_slice(&smac);
                a[24..28].copy_from_slice(&sip);
                self.send_frame(smac, ETH_ARP, &a);
            }
            return;
        }
        if kind != ETH_IP || p.len() < 20 || p[0] >> 4 != 4 {
            return;
        }
        let ihl = ((p[0] & 0xf) as usize) * 4;
        let total = (u16::from_be_bytes([p[2], p[3]]) as usize).min(p.len());
        if total < ihl {
            return;
        }
        let proto = p[9];
        let src: Ip = [p[12], p[13], p[14], p[15]];
        let dst: Ip = [p[16], p[17], p[18], p[19]];
        if dst != self.ip && dst != [255; 4] && self.ip != [0; 4] {
            return;
        }
        let body = &p[ihl..total];
        if proto == 17 && body.len() >= 8 {
            let sport = u16::from_be_bytes([body[0], body[1]]);
            let dport = u16::from_be_bytes([body[2], body[3]]);
            if self.udp_in.len() < 32 {
                self.udp_in.push((dport, src, sport, body[8..].to_vec()));
            }
        } else if proto == 6 && body.len() >= 20 {
            self.tcp_in(src, body);
        }
    }

    fn learn(&mut self, ip: Ip, mac: Mac) {
        if let Some(e) = self.arp.iter_mut().find(|e| e.0 == ip) {
            e.1 = mac;
        } else {
            self.arp.push((ip, mac));
        }
    }

    /// The card that has an address on this network (asked with ARP), or the gateway for one elsewhere.
    fn mac_for(&mut self, ip: Ip) -> Result<Mac, String> {
        if ip == [255; 4] {
            return Ok(BROADCAST);
        }
        let same = (0..4).all(|i| ip[i] & self.mask[i] == self.ip[i] & self.mask[i]);
        let hop = if same || self.gw == [0; 4] { ip } else { self.gw };
        for _try in 0..4 {
            if let Some(e) = self.arp.iter().find(|e| e.0 == hop) {
                return Ok(e.1);
            }
            let mut a = [0u8; 28];
            a[..8].copy_from_slice(&[0, 1, 8, 0, 6, 4, 0, 1]);
            a[8..14].copy_from_slice(&self.mac);
            a[14..18].copy_from_slice(&self.ip);
            a[24..28].copy_from_slice(&hop);
            self.send_frame(BROADCAST, ETH_ARP, &a);
            let until = ms() + 700;
            while ms() < until {
                self.poll();
                if let Some(e) = self.arp.iter().find(|e| e.0 == hop) {
                    return Ok(e.1);
                }
            }
        }
        Err(format!("Nothing on the network answers for {}.", ip_text(hop)))
    }

    fn send_ip(&mut self, dst: Ip, proto: u8, payload: &[u8]) -> Result<(), String> {
        let mac = self.mac_for(dst)?;
        let mut h = vec![0u8; 20 + payload.len()];
        h[0] = 0x45;
        h[2..4].copy_from_slice(&((20 + payload.len()) as u16).to_be_bytes());
        self.ip_id = self.ip_id.wrapping_add(1);
        h[4..6].copy_from_slice(&self.ip_id.to_be_bytes());
        h[6] = 0x40; // don't fragment
        h[8] = 64;
        h[9] = proto;
        h[12..16].copy_from_slice(&self.ip);
        h[16..20].copy_from_slice(&dst);
        let c = fold(sum16(&h[..20], 0));
        h[10..12].copy_from_slice(&c.to_be_bytes());
        h[20..].copy_from_slice(payload);
        self.send_frame(mac, ETH_IP, &h);
        Ok(())
    }

    fn send_udp(&mut self, dst: Ip, sport: u16, dport: u16, data: &[u8]) -> Result<(), String> {
        let mut u = vec![0u8; 8 + data.len()];
        u[0..2].copy_from_slice(&sport.to_be_bytes());
        u[2..4].copy_from_slice(&dport.to_be_bytes());
        u[4..6].copy_from_slice(&((8 + data.len()) as u16).to_be_bytes());
        u[8..].copy_from_slice(data);
        // checksum 0: none (allowed for UDP over IPv4)
        self.send_ip(dst, 17, &u)
    }

    fn take_udp(&mut self, port: u16) -> Option<(Ip, Vec<u8>)> {
        let i = self.udp_in.iter().position(|u| u.0 == port)?;
        let (_, ip, _, d) = self.udp_in.remove(i);
        Some((ip, d))
    }

    // -------------------------------------------------------------------------------------------- DHCP

    fn dhcp_msg(&self, xid: u32, kind: u8, extra: &[u8]) -> Vec<u8> {
        let mut m = vec![0u8; 240];
        m[0] = 1;
        m[1] = 1;
        m[2] = 6;
        m[4..8].copy_from_slice(&xid.to_be_bytes());
        m[10] = 0x80; // answer to everyone (we have no address yet)
        m[28..34].copy_from_slice(&self.mac);
        m[236..240].copy_from_slice(&[99, 130, 83, 99]);
        m.extend_from_slice(&[53, 1, kind]);
        m.extend_from_slice(extra);
        m.extend_from_slice(&[55, 3, 1, 3, 6, 12, 5, b'p', b'i', b'i', b'i', b'o', 255]);
        m
    }

    fn dhcp_wait(&mut self, xid: u32, want: u8, until: u64) -> Option<(Ip, Vec<(u8, Vec<u8>)>)> {
        while ms() < until {
            self.poll();
            while let Some((_, d)) = self.take_udp(68) {
                if d.len() < 240 || d[0] != 2 || u32::from_be_bytes([d[4], d[5], d[6], d[7]]) != xid || d[236..240] != [99, 130, 83, 99] {
                    continue;
                }
                let yi: Ip = [d[16], d[17], d[18], d[19]];
                let mut opts = Vec::new();
                let mut i = 240;
                while i + 1 < d.len() && d[i] != 255 {
                    if d[i] == 0 {
                        i += 1;
                        continue;
                    }
                    let (c, l) = (d[i], d[i + 1] as usize);
                    if i + 2 + l > d.len() {
                        break;
                    }
                    opts.push((c, d[i + 2..i + 2 + l].to_vec()));
                    i += 2 + l;
                }
                if opts.iter().any(|(c, v)| *c == 53 && v.first() == Some(&want)) {
                    return Some((yi, opts));
                }
            }
        }
        None
    }

    fn dhcp(&mut self) -> Result<(), String> {
        let ip4 = |v: &Vec<u8>| -> Ip { [v[0], v[1], v[2], v[3]] };
        for _try in 0..4 {
            let xid = (uefi::tsc() as u32) ^ 0x5049_4949;
            let m = self.dhcp_msg(xid, 1, &[]);
            self.send_udp([255; 4], 68, 67, &m)?;
            let Some((offer, opts)) = self.dhcp_wait(xid, 2, ms() + 3000) else { continue };
            let server = opts.iter().find(|(c, v)| *c == 54 && v.len() == 4).map(|(_, v)| ip4(v)).unwrap_or([0; 4]);
            let mut extra = vec![50, 4];
            extra.extend_from_slice(&offer);
            extra.extend_from_slice(&[54, 4]);
            extra.extend_from_slice(&server);
            let m = self.dhcp_msg(xid, 3, &extra);
            self.send_udp([255; 4], 68, 67, &m)?;
            let Some((ip, opts)) = self.dhcp_wait(xid, 5, ms() + 3000) else { continue };
            self.ip = ip;
            for (c, v) in &opts {
                match (*c, v.len() >= 4) {
                    (1, true) => self.mask = ip4(v),
                    (3, true) => self.gw = ip4(v),
                    (6, true) => self.dns = ip4(v),
                    _ => {}
                }
            }
            if self.dns == [0; 4] {
                self.dns = [1, 1, 1, 1];
            }
            return Ok(());
        }
        Err("The network gave no address (no answer to DHCP). Is the cable in a router?".into())
    }

    // -------------------------------------------------------------------------------------------- DNS

    fn resolve(&mut self, host: &str) -> Result<Ip, String> {
        if let Some(ip) = parse_ip(host) {
            return Ok(ip);
        }
        let servers = [self.dns, [1, 1, 1, 1]];
        for server in servers {
            for _try in 0..2 {
                let id = (uefi::tsc() & 0xffff) as u16;
                let mut q = Vec::new();
                q.extend_from_slice(&id.to_be_bytes());
                q.extend_from_slice(&[0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
                for part in host.split('.') {
                    q.push(part.len() as u8);
                    q.extend_from_slice(part.as_bytes());
                }
                q.extend_from_slice(&[0, 0, 1, 0, 1]);
                let port = self.next_port();
                self.send_udp(server, port, 53, &q)?;
                let until = ms() + 2500;
                while ms() < until {
                    self.poll();
                    if let Some((_, d)) = self.take_udp(port) {
                        if d.len() < 12 || u16::from_be_bytes([d[0], d[1]]) != id {
                            continue;
                        }
                        let rcode = d[3] & 0xf;
                        if rcode == 3 {
                            return Err(format!("There is no such name: {}", host));
                        }
                        if let Some(ip) = dns_answer(&d) {
                            return Ok(ip);
                        }
                    }
                }
            }
        }
        Err(format!("Could not look up {} (no answer from the name servers).", host))
    }

    fn next_port(&mut self) -> u16 {
        self.port = if self.port >= 60000 { 40000 } else { self.port + 1 };
        self.port
    }

    // -------------------------------------------------------------------------------------------- TCP

    fn tcp_send(&mut self, flags: u8, data: &[u8], seq: u32) -> Result<(), String> {
        let Some(t) = &self.tcp else { return Ok(()) };
        let (ip, port, local, rcv) = (t.ip, t.port, t.local, t.rcv);
        let syn = flags & 0x02 != 0;
        let hl = if syn { 24 } else { 20 };
        let mut s = vec![0u8; hl + data.len()];
        s[0..2].copy_from_slice(&local.to_be_bytes());
        s[2..4].copy_from_slice(&port.to_be_bytes());
        s[4..8].copy_from_slice(&seq.to_be_bytes());
        s[8..12].copy_from_slice(&(if flags & 0x10 != 0 { rcv } else { 0 }).to_be_bytes());
        s[12] = ((hl / 4) as u8) << 4;
        s[13] = flags;
        s[14..16].copy_from_slice(&65535u16.to_be_bytes());
        if syn {
            // the largest piece we take: 1460 bytes
            s[20..24].copy_from_slice(&[2, 4, 0x05, 0xb4]);
        }
        s[hl..].copy_from_slice(data);
        let mut pseudo = [0u8; 12];
        pseudo[0..4].copy_from_slice(&self.ip);
        pseudo[4..8].copy_from_slice(&ip);
        pseudo[9] = 6;
        pseudo[10..12].copy_from_slice(&(s.len() as u16).to_be_bytes());
        let c = fold(sum16(&s, sum16(&pseudo, 0)));
        s[16..18].copy_from_slice(&c.to_be_bytes());
        self.send_ip(ip, 6, &s)
    }

    fn tcp_in(&mut self, src: Ip, b: &[u8]) {
        let Some(t) = self.tcp.as_mut() else { return };
        let sport = u16::from_be_bytes([b[0], b[1]]);
        let dport = u16::from_be_bytes([b[2], b[3]]);
        if src != t.ip || sport != t.port || dport != t.local {
            return;
        }
        let seq = u32::from_be_bytes([b[4], b[5], b[6], b[7]]);
        let ack = u32::from_be_bytes([b[8], b[9], b[10], b[11]]);
        let off = ((b[12] >> 4) as usize) * 4;
        let flags = b[13];
        if off > b.len() {
            return;
        }
        let data = &b[off..];
        if flags & 0x04 != 0 {
            t.reset = true;
            return;
        }
        let mut must_ack = false;
        if !t.connected {
            // the answer to our SYN: SYN and ACK
            if flags & 0x12 == 0x12 && ack == t.nxt {
                t.rcv = seq.wrapping_add(1);
                t.una = ack;
                t.una_start = ack;
                t.connected = true;
                must_ack = true;
            }
        } else {
            if flags & 0x10 != 0 {
                // acknowledged: drop what the other side has
                let done = ack.wrapping_sub(t.una_start) as usize;
                if ack.wrapping_sub(t.una) as i32 > 0 && done <= t.unacked.len() {
                    t.unacked.drain(..done);
                    t.una_start = ack;
                    t.una = ack;
                }
            }
            if !data.is_empty() || flags & 0x01 != 0 {
                must_ack = true;
                if seq == t.rcv {
                    t.data.extend_from_slice(data);
                    t.rcv = t.rcv.wrapping_add(data.len() as u32);
                    if flags & 0x01 != 0 {
                        t.rcv = t.rcv.wrapping_add(1);
                        t.fin = true;
                    }
                }
                // anything out of order: dropped, and our ACK says where we are (it is sent again)
            }
        }
        if must_ack {
            let nxt = t.nxt;
            let _ = self.tcp_send(0x10, &[], nxt);
        }
    }

    /// One HTTP exchange over a new TCP connection: the request out, everything back until the server closes.
    fn exchange(&mut self, ip: Ip, port: u16, request: &[u8]) -> Result<Vec<u8>, String> {
        let local = self.next_port();
        let iss = (uefi::tsc() as u32) & 0x7fff_ffff;
        self.tcp = Some(Tcp {
            ip,
            port,
            local,
            nxt: iss.wrapping_add(1),
            una: iss,
            rcv: 0,
            connected: false,
            fin: false,
            reset: false,
            data: Vec::new(),
            unacked: Vec::new(),
            una_start: iss.wrapping_add(1),
        });
        // connect: SYN, sent again until answered
        let mut connected = false;
        for _try in 0..5 {
            self.tcp_send(0x02, &[], iss)?;
            let until = ms() + 1500;
            while ms() < until {
                self.poll();
                let t = self.tcp.as_ref().unwrap();
                if t.reset {
                    self.tcp = None;
                    return Err(format!("{} refused the connection (nothing listens on port {}).", ip_text(ip), port));
                }
                if t.connected {
                    connected = true;
                    break;
                }
            }
            if connected {
                break;
            }
        }
        if !connected {
            self.tcp = None;
            return Err(format!("{} did not answer on port {}.", ip_text(ip), port));
        }
        // the request, in pieces of 1400 bytes
        {
            let t = self.tcp.as_mut().unwrap();
            t.unacked = request.to_vec();
            t.una_start = t.nxt;
        }
        let start = self.tcp.as_ref().unwrap().nxt;
        for (i, piece) in request.chunks(1400).enumerate() {
            let seq = start.wrapping_add((i * 1400) as u32);
            self.tcp_send(0x18, piece, seq)?;
        }
        self.tcp.as_mut().unwrap().nxt = start.wrapping_add(request.len() as u32);
        // the answer, until the server closes; what it does not acknowledge in time is sent again
        let mut last_progress = ms();
        let mut last_len = 0usize;
        let mut resend_at = ms() + 1000;
        loop {
            self.poll();
            let t = self.tcp.as_ref().unwrap();
            if t.reset {
                let d = t.data.clone();
                self.tcp = None;
                if d.is_empty() {
                    return Err("The connection was cut.".into());
                }
                return Ok(d);
            }
            if t.fin {
                break;
            }
            if t.data.len() != last_len {
                last_len = t.data.len();
                last_progress = ms();
            }
            if ms() > resend_at {
                resend_at = ms() + 1000;
                let t = self.tcp.as_ref().unwrap();
                if !t.unacked.is_empty() {
                    let (pending, from) = (t.unacked.clone(), t.una_start);
                    for (i, piece) in pending.chunks(1400).enumerate() {
                        self.tcp_send(0x18, piece, from.wrapping_add((i * 1400) as u32))?;
                    }
                } else {
                    // our last ACK may have been lost: say again where we are
                    let nxt = t.nxt;
                    self.tcp_send(0x10, &[], nxt)?;
                }
            }
            if ms() - last_progress > 15_000 {
                let d = self.tcp.as_ref().unwrap().data.clone();
                self.tcp = None;
                if d.is_empty() {
                    return Err("The server took too long to answer.".into());
                }
                return Ok(d);
            }
        }
        // the server closed: we close too
        let nxt = self.tcp.as_ref().unwrap().nxt;
        self.tcp_send(0x11, &[], nxt)?;
        let until = ms() + 300;
        while ms() < until {
            self.poll();
        }
        let d = self.tcp.take().unwrap().data;
        Ok(d)
    }

    /// An HTTP request to an address: the answer, following plain-http redirects.
    pub fn fetch(&mut self, method: &str, url: &str, body: &str, ctype: &str) -> Result<(Url, Response), String> {
        let mut u = Url::parse(url)?;
        let mut method = String::from(method);
        let mut body = String::from(body);
        for _hop in 0..5 {
            let ip = self.resolve(&u.host)?;
            let raw = self.exchange(ip, u.port, &web::request(&method, &u, &body, ctype))?;
            let r = Response::parse(&raw)?;
            if matches!(r.status, 301 | 302 | 303 | 307 | 308) {
                if let Some(loc) = r.header("location") {
                    let next = u.join(loc).unwrap_or_else(|| loc.into());
                    if next.to_ascii_lowercase().starts_with("https://") {
                        return Err(format!(
                            "{} sends piii OS on to {}: an https:// address, which piii OS cannot open yet (no encryption). For piii.app: in Cloudflare, SSL/TLS → Edge Certificates → turn \"Always Use HTTPS\" off.",
                            u.host, next
                        ));
                    }
                    u = Url::parse(&next)?;
                    if r.status == 303 || ((r.status == 301 || r.status == 302) && method == "POST") {
                        method = "GET".into();
                        body.clear();
                    }
                    continue;
                }
            }
            return Ok((u, r));
        }
        Err("Too many redirects.".into())
    }
}

/// The first IPv4 address in a DNS answer.
fn dns_answer(d: &[u8]) -> Option<Ip> {
    let qd = u16::from_be_bytes([d[4], d[5]]) as usize;
    let an = u16::from_be_bytes([d[6], d[7]]) as usize;
    let mut i = 12;
    let skip_name = |i: &mut usize| -> Option<()> {
        loop {
            let l = *d.get(*i)? as usize;
            if l == 0 {
                *i += 1;
                return Some(());
            }
            if l & 0xc0 == 0xc0 {
                *i += 2;
                return Some(());
            }
            *i += 1 + l;
        }
    };
    for _ in 0..qd {
        skip_name(&mut i)?;
        i += 4;
    }
    for _ in 0..an {
        skip_name(&mut i)?;
        let kind = u16::from_be_bytes([*d.get(i)?, *d.get(i + 1)?]);
        let len = u16::from_be_bytes([*d.get(i + 8)?, *d.get(i + 9)?]) as usize;
        i += 10;
        if kind == 1 && len == 4 {
            return Some([*d.get(i)?, d[i + 1], d[i + 2], d[i + 3]]);
        }
        i += len;
    }
    None
}
