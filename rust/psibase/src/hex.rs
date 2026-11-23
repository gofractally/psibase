//! Bytes as hex text, for the places that show or take bytes outside JSON
//! (a URL, a GraphQL cursor, a printed key). In JSON a `Vec<u8>` or
//! `[u8; N]` member is hex by PSIO's rule and needs nothing from here.
//! The spelling is PSIO's: upper case written, either case read.

const HEX_DIGITS: &[u8; 16] = b"0123456789ABCDEF";

/// `bytes` as upper-case hex.
pub fn to_hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        text.push(HEX_DIGITS[(b >> 4) as usize] as char);
        text.push(HEX_DIGITS[(b & 0x0f) as usize] as char);
    }
    text
}

/// The bytes `text` spells in hex (either case); `None` when it is not hex.
pub fn from_hex(text: &str) -> Option<Vec<u8>> {
    fn digit(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    }
    let text = text.as_bytes();
    if text.len() % 2 != 0 {
        return None;
    }
    text.chunks(2)
        .map(|pair| Some((digit(pair[0])? << 4) | digit(pair[1])?))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_text_is_psio_s() {
        let bytes = vec![0x00, 0x1f, 0xab, 0xff];
        assert_eq!(to_hex(&bytes), "001FABFF");
        assert_eq!(format!("\"{}\"", to_hex(&bytes)), psio::to_ijson(&bytes));
        assert_eq!(from_hex("001fABff"), Some(bytes));
        assert_eq!(from_hex("0"), None);
        assert_eq!(from_hex("0g"), None);
        assert_eq!(from_hex(""), Some(vec![]));
    }
}
