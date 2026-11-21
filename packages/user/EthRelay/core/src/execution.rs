//! Bounded canonical RLP and Merkle-Patricia membership proofs.
use super::*;
#[derive(Clone, Copy)]
struct Item<'a> {
    raw: &'a [u8],
    data: &'a [u8],
    list: bool,
}
fn length(b: &[u8]) -> Result<usize> {
    ensure(
        !b.is_empty() && b.len() <= 8 && b[0] != 0,
        "Noncanonical RLP length",
    )?;
    b.iter().try_fold(0usize, |n, b| {
        n.checked_mul(256)
            .and_then(|n| n.checked_add(*b as usize))
            .ok_or_else(|| "RLP length overflow".into())
    })
}
fn item(b: &[u8]) -> Result<Item<'_>> {
    ensure(!b.is_empty(), "Truncated RLP")?;
    let tag = b[0];
    let (offset, size, list) = match tag {
        0..=0x7f => (0, 1, false),
        0x80..=0xb7 => (1, (tag - 0x80) as usize, false),
        0xb8..=0xbf => {
            let n = (tag - 0xb7) as usize;
            ensure(b.len() > n, "Truncated RLP length")?;
            let size = length(&b[1..=n])?;
            ensure(size >= 56, "Noncanonical long RLP")?;
            (n + 1, size, false)
        }
        0xc0..=0xf7 => (1, (tag - 0xc0) as usize, true),
        _ => {
            let n = (tag - 0xf7) as usize;
            ensure(b.len() > n, "Truncated RLP length")?;
            let size = length(&b[1..=n])?;
            ensure(size >= 56, "Noncanonical long RLP list")?;
            (n + 1, size, true)
        }
    };
    let end = offset.checked_add(size).ok_or("RLP overflow")?;
    ensure(end <= b.len(), "Truncated RLP payload")?;
    ensure(
        !(offset == 1 && !list && size == 1 && b[offset] < 0x80),
        "Noncanonical RLP byte",
    )?;
    Ok(Item {
        raw: &b[..end],
        data: &b[offset..end],
        list,
    })
}
fn exact(b: &[u8]) -> Result<Item<'_>> {
    let v = item(b)?;
    ensure(v.raw.len() == b.len(), "Trailing RLP bytes")?;
    Ok(v)
}
fn list<'a>(v: Item<'a>, max: usize) -> Result<Vec<Item<'a>>> {
    ensure(v.list, "Expected RLP list")?;
    let mut data = v.data;
    let mut result = vec![];
    while !data.is_empty() {
        ensure(result.len() < max, "RLP list limit")?;
        let c = item(data)?;
        data = &data[c.raw.len()..];
        result.push(c);
    }
    Ok(result)
}
fn raw(v: Item<'_>) -> Result<&[u8]> {
    ensure(!v.list, "Expected RLP bytes")?;
    Ok(v.data)
}
fn number(v: Item<'_>) -> Result<u64> {
    let b = raw(v)?;
    ensure(
        b.len() <= 8 && (b.is_empty() || b[0] != 0),
        "RLP integer overflow or leading zero",
    )?;
    Ok(b.iter().fold(0, |n, b| (n << 8) | u64::from(*b)))
}
fn fixed<const N: usize>(v: Item<'_>) -> Result<[u8; N]> {
    raw(v)?
        .try_into()
        .map_err(|_| format!("RLP field must be {N} bytes"))
}
fn nibble(b: &[u8]) -> Vec<u8> {
    b.iter().flat_map(|b| [b >> 4, b & 15]).collect()
}
fn key_rlp(n: u64) -> Vec<u8> {
    if n == 0 {
        return vec![0x80];
    }
    if n < 128 {
        return vec![n as u8];
    }
    let b = n.to_be_bytes();
    let b = &b[b.iter().position(|b| *b != 0).unwrap()..];
    let mut r = vec![0x80 + b.len() as u8];
    r.extend_from_slice(b);
    r
}
pub fn trie_value(root: Hash, key: &[u8], proof: &[String]) -> Result<Vec<u8>> {
    ensure(
        !proof.is_empty() && proof.len() <= 64,
        "Trie proof node limit",
    )?;
    let nodes = proof
        .iter()
        .map(|p| {
            ensure(p.len() <= 65536, "Trie node size limit")?;
            hex::decode(p.strip_prefix("0x").unwrap_or(p)).map_err(|e| e.to_string())
        })
        .collect::<Result<Vec<_>>>()?;
    ensure(
        nodes.iter().map(Vec::len).sum::<usize>() <= 131072,
        "Trie proof byte limit",
    )?;
    let path = nibble(key);
    let mut position = 0;
    let mut index = 0;
    let mut expected = root.to_vec();
    for _ in 0..128 {
        let data = if expected.len() == 32 {
            let n = nodes.get(index).ok_or("Missing trie node")?;
            index += 1;
            ensure(keccak(n).as_slice() == expected, "Trie node hash mismatch")?;
            n.clone()
        } else {
            ensure(
                !expected.is_empty() && expected.len() < 32,
                "Invalid trie child reference",
            )?;
            expected.clone()
        };
        let fields = list(exact(&data)?, 17)?;
        let next = if fields.len() == 17 {
            if position == path.len() {
                ensure(index == nodes.len(), "Unused trie proof nodes")?;
                let v = raw(fields[16])?;
                ensure(!v.is_empty(), "Trie value absent")?;
                return Ok(v.to_vec());
            }
            let child = fields[path[position] as usize];
            position += 1;
            child
        } else {
            ensure(fields.len() == 2, "Invalid trie node arity")?;
            let encoded = raw(fields[0])?;
            ensure(!encoded.is_empty(), "Empty compact trie path")?;
            let p = nibble(encoded);
            let flags = p[0];
            ensure(
                flags <= 3 && (flags & 1 == 1 || p[1] == 0),
                "Invalid compact trie path",
            )?;
            let suffix = &p[if flags & 1 == 1 { 1 } else { 2 }..];
            ensure(
                position + suffix.len() <= path.len()
                    && path[position..position + suffix.len()] == *suffix,
                "Trie path mismatch",
            )?;
            position += suffix.len();
            if flags & 2 != 0 {
                ensure(
                    position == path.len() && index == nodes.len(),
                    "Trie leaf does not consume key/proof",
                )?;
                return Ok(raw(fields[1])?.to_vec());
            }
            ensure(!suffix.is_empty(), "Empty trie extension")?;
            fields[1]
        };
        expected = if next.list {
            ensure(next.raw.len() < 32, "Oversized embedded trie node")?;
            next.raw.to_vec()
        } else {
            let r = raw(next)?;
            ensure(r.len() == 32, "Missing or noncanonical hashed trie child")?;
            r.to_vec()
        };
    }
    Err("Trie traversal limit".into())
}
pub fn execution_header(encoded: &str) -> Result<ExecutionFact> {
    ensure(encoded.len() <= 4096, "Execution header size limit")?;
    let data =
        hex::decode(encoded.strip_prefix("0x").unwrap_or(encoded)).map_err(|e| e.to_string())?;
    let f = list(exact(&data)?, 32)?;
    ensure(
        matches!(f.len(), 15 | 16 | 17 | 20 | 21),
        "Unsupported execution header layout",
    )?;
    Ok(ExecutionFact {
        block_hash: hex(keccak(&data)),
        parent_hash: hex(fixed::<32>(f[0])?),
        state_root: hex(fixed::<32>(f[3])?),
        receipts_root: hex(fixed::<32>(f[5])?),
        block_number: number(f[8])?,
    })
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptProof {
    pub receipts_root: String,
    pub transaction_index: u64,
    pub log_index: u32,
    pub nodes: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReceiptFact {
    pub receipts_root: String,
    pub transaction_index: u64,
    pub log_index: u32,
    pub address: String,
    pub topics: Vec<String>,
    pub data: String,
}
impl ReceiptProof {
    pub fn check(&self) -> Result<ReceiptFact> {
        ensure(
            self.transaction_index <= 1_000_000 && self.log_index < 1024,
            "Receipt position limit",
        )?;
        let receipt = trie_value(
            bytes(&self.receipts_root)?,
            &key_rlp(self.transaction_index),
            &self.nodes,
        )?;
        ensure(!receipt.is_empty(), "Empty receipt")?;
        let payload = if receipt[0] < 0x80 {
            ensure((1..=4).contains(&receipt[0]), "Unsupported typed receipt")?;
            &receipt[1..]
        } else {
            receipt.as_slice()
        };
        let f = list(exact(payload)?, 4)?;
        ensure(
            f.len() == 4 && number(f[0])? == 1,
            "Failed or malformed receipt",
        )?;
        let _ = number(f[1])?;
        let _ = fixed::<256>(f[2])?;
        let logs = list(f[3], 1024)?;
        let log = list(
            *logs
                .get(self.log_index as usize)
                .ok_or("Missing receipt log")?,
            3,
        )?;
        ensure(log.len() == 3, "Invalid receipt log")?;
        let address = fixed::<20>(log[0])?;
        let topics = list(log[1], 4)?
            .into_iter()
            .map(|t| Ok(hex(fixed::<32>(t)?)))
            .collect::<Result<Vec<_>>>()?;
        let data = raw(log[2])?;
        ensure(data.len() <= 8192, "Receipt log data limit")?;
        Ok(ReceiptFact {
            receipts_root: hex(bytes::<32>(&self.receipts_root)?),
            transaction_index: self.transaction_index,
            log_index: self.log_index,
            address: hex(address),
            topics,
            data: hex(data),
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountProof {
    pub state_root: String,
    pub address: String,
    pub nodes: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AccountFact {
    pub state_root: String,
    pub address: String,
    pub nonce: u64,
    pub balance: String,
    pub storage_root: String,
    pub code_hash: String,
}
impl AccountProof {
    pub fn check(&self) -> Result<AccountFact> {
        let address = bytes::<20>(&self.address)?;
        let data = trie_value(bytes(&self.state_root)?, &keccak(&address), &self.nodes)?;
        let f = list(exact(&data)?, 4)?;
        ensure(f.len() == 4, "Invalid account RLP")?;
        let balance = raw(f[1])?;
        ensure(
            balance.len() <= 32 && (balance.is_empty() || balance[0] != 0),
            "Invalid account balance",
        )?;
        let mut padded = [0; 32];
        padded[32 - balance.len()..].copy_from_slice(balance);
        Ok(AccountFact {
            state_root: hex(bytes::<32>(&self.state_root)?),
            address: hex(address),
            nonce: number(f[0])?,
            balance: hex(padded),
            storage_root: hex(fixed::<32>(f[2])?),
            code_hash: hex(fixed::<32>(f[3])?),
        })
    }
}
