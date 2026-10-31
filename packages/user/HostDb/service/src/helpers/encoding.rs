use psibase::*;
use std::str::FromStr;

pub(crate) fn decode_fixed_hex<const N: usize>(input: &str) -> Option<Vec<u8>> {
    Hex::<[u8; N]>::from_str(input)
        .ok()
        .map(|hex| hex.0.to_vec())
}

/// Cookie values are lowercase hex.
pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    Hex(bytes).to_string().to_ascii_lowercase()
}
