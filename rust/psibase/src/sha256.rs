use sha2::{Digest, Sha256};

use crate::Checksum256;
pub fn sha256(data: &[u8]) -> Checksum256 {
    Checksum256::from(<[u8; 32]>::from(Sha256::digest(data)))
}
