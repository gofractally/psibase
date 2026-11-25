//! The text of IP addresses and socket endpoints, as C++ writes and reads
//! it (`psibase/SocketInfo.hpp`, `common/src/SocketInfo.cpp`: `to_string`,
//! `parseIPAddress`, `parseSocketEndpoint`). C++ is the authority; this is
//! the same printer and the same parser, so that both languages accept and
//! refuse the same texts — with one exception, marked in `read_ipv6`: this
//! reader accepts every text the printer writes, where the C++ parser at
//! the time of writing refuses an IPv6 address that ends in `::` or in a
//! dotted IPv4 part unless a `]` or `%` follows.
//!
//! * An IPv4 address is `127.0.0.1`.
//! * An IPv6 address is its eight groups in lower-case hex without leading
//!   zeros, the first longest run of two or more zero groups written `::`;
//!   an IPv4-mapped address is `::ffff:1.2.3.4`; a zone other than 0
//!   follows as `%<number>`.
//! * An endpoint is `127.0.0.1:8080` or `[::1]:8080`. Any other text is the
//!   path of a local socket; a path without a `/` is written `./path`, so
//!   that it cannot be read as an IP endpoint.

use crate::{
    IPAddress, IPV4Address, IPV4Endpoint, IPV6Address, IPV6Endpoint, LocalEndpoint, SocketEndpoint,
};

// ── Writing ─────────────────────────────────────────────────────────────────

pub(crate) fn write_ipv4(address: &IPV4Address, out: &mut String) {
    let b = &address.bytes;
    out.push_str(&format!("{}.{}.{}.{}", b[0], b[1], b[2], b[3]));
}

pub(crate) fn write_ipv6(address: &IPV6Address, out: &mut String) {
    let b = &address.bytes;
    const MAPPED_IPV4_PREFIX: [u8; 12] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];
    if b[..12] == MAPPED_IPV4_PREFIX {
        out.push_str(&format!("::ffff:{}.{}.{}.{}", b[12], b[13], b[14], b[15]));
    } else {
        // The first longest run of zero groups.
        let (mut best_run, mut best_len) = (0, 0);
        let mut i = 0;
        while i < 16 {
            if b[i] == 0 && b[i + 1] == 0 {
                let run_start = i;
                while i < 16 && b[i] == 0 && b[i + 1] == 0 {
                    i += 2;
                }
                if i - run_start > best_len {
                    best_run = run_start;
                    best_len = i - run_start;
                }
            } else {
                i += 2;
            }
        }
        // Eight groups of up to four hex digits.
        let mut first = true;
        let mut i = 0;
        while i < 16 {
            if best_len > 2 && i == best_run {
                out.push_str("::");
                i += best_len;
                first = true;
            } else {
                if first {
                    first = false;
                } else {
                    out.push(':');
                }
                let group = (b[i] as u16) << 8 | b[i + 1] as u16;
                out.push_str(&format!("{group:x}"));
                i += 2;
            }
        }
    }
    if address.zone != 0 {
        out.push('%');
        out.push_str(&address.zone.to_string());
    }
}

pub(crate) fn write_address(address: &IPAddress, out: &mut String) {
    match address {
        IPAddress::IPV4Address(address) => write_ipv4(address, out),
        IPAddress::IPV6Address(address) => write_ipv6(address, out),
    }
}

pub(crate) fn write_endpoint(endpoint: &SocketEndpoint, out: &mut String) {
    match endpoint {
        SocketEndpoint::IPV4Endpoint(endpoint) => {
            write_ipv4(&endpoint.address, out);
            out.push(':');
            out.push_str(&endpoint.port.to_string());
        }
        SocketEndpoint::IPV6Endpoint(endpoint) => {
            out.push('[');
            write_ipv6(&endpoint.address, out);
            out.push_str("]:");
            out.push_str(&endpoint.port.to_string());
        }
        SocketEndpoint::LocalEndpoint(endpoint) => {
            let path = endpoint.path.to_string_lossy();
            if !path.is_empty() && !path.contains('/') {
                // Make sure that the path cannot be read as an IP address.
                out.push_str("./");
            }
            out.push_str(&path);
        }
    }
}

// ── Reading ─────────────────────────────────────────────────────────────────

/// The text being read and the position in it.
struct Cursor<'a> {
    text: &'a [u8],
    pos: usize,
}

impl Cursor<'_> {
    fn at_end(&self) -> bool {
        self.pos == self.text.len()
    }
    fn peek(&self) -> Option<u8> {
        self.text.get(self.pos).copied()
    }
    /// Consumes the next byte when it is `byte`.
    fn eat(&mut self, byte: u8) -> bool {
        if self.peek() == Some(byte) {
            self.pos += 1;
            true
        } else {
            false
        }
    }
    /// A number as `std::from_chars` reads one: the longest run of digits
    /// of `radix` (no sign, no prefix; leading zeros are digits), which
    /// must not be empty and must not exceed `max`.
    fn number(&mut self, radix: u32, max: u32) -> Option<u32> {
        let start = self.pos;
        let mut value: u64 = 0;
        while let Some(digit) = self.peek().and_then(|c| (c as char).to_digit(radix)) {
            value = (value * radix as u64 + digit as u64).min(u64::from(u32::MAX) + 1);
            self.pos += 1;
        }
        (self.pos != start && value <= max as u64).then_some(value as u32)
    }
}

fn read_ipv4(cursor: &mut Cursor<'_>) -> Option<[u8; 4]> {
    let mut bytes = [0u8; 4];
    for (i, byte) in bytes.iter_mut().enumerate() {
        if i != 0 && !cursor.eat(b'.') {
            return None;
        }
        *byte = cursor.number(10, 0xff)? as u8;
    }
    Some(bytes)
}

/// Stops at the end of the text, at `]` or at the end of the zone.
fn read_ipv6(cursor: &mut Cursor<'_>) -> Option<IPV6Address> {
    let mut bytes = [0u8; 16];
    let mut elided_pos = 16;
    let mut i = 0;
    while !cursor.at_end() {
        if i != 0 {
            if matches!(cursor.peek(), Some(b']' | b'%')) {
                break;
            } else if !cursor.eat(b':') {
                return None;
            }
        }
        // "::". Anywhere but at the beginning one ':' is consumed already.
        if cursor.peek() == Some(b':') {
            if elided_pos < 16 {
                return None;
            }
            elided_pos = i;
            cursor.pos += 1;
            if i == 0 && !cursor.eat(b':') {
                return None;
            }
            // The end of the text ends the address here too: C++
            // `parseIPV6AddressImpl` goes on to read a group and so does
            // not read the `::` and `1::` its own `to_string` writes
            // (reported to the C++ side, like the case below).
            if matches!(cursor.peek(), None | Some(b']' | b'%')) {
                break;
            }
        }
        if i >= 16 {
            return None;
        }
        let group_start = cursor.pos;
        let group = cursor.number(16, 0xffff)?;
        // An IPv4 address in the last four bytes: the group just read was
        // its first decimal number.
        if cursor.peek() == Some(b'.') {
            if i > 12 || (i < 12 && elided_pos >= 16) {
                return None;
            }
            cursor.pos = group_start;
            bytes[i..i + 4].copy_from_slice(&read_ipv4(cursor)?);
            i += 4;
            // C++ returns no address when the text ends here, so it does
            // not read the `::ffff:1.2.3.4` its own `to_string` writes;
            // this reader accepts the end of the text.
            if !matches!(cursor.peek(), None | Some(b']' | b'%')) {
                return None;
            }
            break;
        }
        bytes[i] = (group >> 8) as u8;
        bytes[i + 1] = (group & 0xff) as u8;
        i += 2;
    }
    // The whole address is filled, or a "::" stands for the rest.
    if elided_pos > i {
        return None;
    }
    // The groups after "::" move to the end.
    let tail = i - elided_pos;
    bytes.copy_within(elided_pos..i, 16 - tail);
    bytes[elided_pos..16 - tail].fill(0);

    let mut zone = 0;
    if cursor.eat(b'%') {
        zone = cursor.number(10, u32::MAX)?;
    }
    Some(IPV6Address { bytes, zone })
}

pub(crate) fn parse_address(text: &str) -> Option<IPAddress> {
    let mut cursor = Cursor { text: text.as_bytes(), pos: 0 };
    if let Some(bytes) = read_ipv4(&mut cursor).filter(|_| cursor.at_end()) {
        return Some(IPAddress::IPV4Address(IPV4Address { bytes }));
    }
    let mut cursor = Cursor { text: text.as_bytes(), pos: 0 };
    let address = read_ipv6(&mut cursor)?;
    cursor.at_end().then_some(IPAddress::IPV6Address(address))
}

fn parse_ipv4_endpoint(text: &str) -> Option<IPV4Endpoint> {
    let mut cursor = Cursor { text: text.as_bytes(), pos: 0 };
    let bytes = read_ipv4(&mut cursor)?;
    if !cursor.eat(b':') {
        return None;
    }
    let port = cursor.number(10, 0xffff)? as u16;
    cursor.at_end().then_some(IPV4Endpoint { address: IPV4Address { bytes }, port })
}

fn parse_ipv6_endpoint(text: &str) -> Option<IPV6Endpoint> {
    let mut cursor = Cursor { text: text.as_bytes(), pos: 0 };
    if !cursor.eat(b'[') {
        return None;
    }
    let address = read_ipv6(&mut cursor)?;
    if !cursor.eat(b']') || !cursor.eat(b':') {
        return None;
    }
    let port = cursor.number(10, 0xffff)? as u16;
    cursor.at_end().then_some(IPV6Endpoint { address, port })
}

/// No text is refused: what is not an IP endpoint is a local socket's path.
pub(crate) fn parse_endpoint(text: &str) -> SocketEndpoint {
    if let Some(endpoint) = parse_ipv4_endpoint(text) {
        SocketEndpoint::IPV4Endpoint(endpoint)
    } else if let Some(endpoint) = parse_ipv6_endpoint(text) {
        SocketEndpoint::IPV6Endpoint(endpoint)
    } else {
        SocketEndpoint::LocalEndpoint(LocalEndpoint { path: text.into() })
    }
}
