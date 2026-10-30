//! Minimal git loose-object handling: inflate, hash, parse.

use sha1::{Digest, Sha1};

/// Maximum inflated size of a single object (header + content).
pub const MAX_OBJECT_SIZE: usize = 1024 * 1024;

pub const ZERO_OID: &str = "0000000000000000000000000000000000000000";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Blob,
    Tree,
    Commit,
    Tag,
}

pub struct Object {
    pub kind: Kind,
    pub content: Vec<u8>,
}

pub fn to_hex(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(H[(b >> 4) as usize] as char);
        s.push(H[(b & 15) as usize] as char);
    }
    s
}

pub fn is_oid(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
}

/// Inflate a zlib loose object, enforcing the size cap on the inflated bytes.
pub fn inflate(data: &[u8]) -> Result<Vec<u8>, String> {
    miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(data, MAX_OBJECT_SIZE + 64)
        .map_err(|e| format!("bad zlib stream or object exceeds 1 MiB: {:?}", e.status))
}

/// Parse `type SP size NUL content`, check the cap, return (oid, object).
pub fn decode(data: &[u8]) -> Result<(String, Object), String> {
    let raw = inflate(data)?;
    let nul = raw
        .iter()
        .position(|&b| b == 0)
        .ok_or("bad object header")?;
    let header = std::str::from_utf8(&raw[..nul]).map_err(|_| "bad object header")?;
    let (ty, size) = header.split_once(' ').ok_or("bad object header")?;
    let size: usize = size.parse().map_err(|_| "bad object size")?;
    let content = &raw[nul + 1..];
    if size != content.len() {
        return Err("object size mismatch".into());
    }
    if size > MAX_OBJECT_SIZE {
        return Err(format!(
            "object is {} bytes; limit is 1 MiB per object",
            size
        ));
    }
    let kind = match ty {
        "blob" => Kind::Blob,
        "tree" => Kind::Tree,
        "commit" => Kind::Commit,
        "tag" => Kind::Tag,
        _ => return Err(format!("unsupported object type {}", ty)),
    };
    let oid = to_hex(&Sha1::digest(&raw));
    Ok((
        oid,
        Object {
            kind,
            content: content.to_vec(),
        },
    ))
}

fn header_lines(content: &[u8]) -> impl Iterator<Item = &[u8]> {
    content.split(|&b| b == b'\n').take_while(|l| !l.is_empty())
}

fn header_values<'a>(content: &'a [u8], key: &'a str) -> impl Iterator<Item = String> + 'a {
    header_lines(content).filter_map(move |l| {
        let l = std::str::from_utf8(l).ok()?;
        let v = l.strip_prefix(key)?.strip_prefix(' ')?;
        Some(v.to_string())
    })
}

pub fn commit_tree(content: &[u8]) -> Option<String> {
    header_values(content, "tree").next()
}

pub fn commit_parents(content: &[u8]) -> Vec<String> {
    header_values(content, "parent").collect()
}

pub fn tag_target(content: &[u8]) -> Option<String> {
    header_values(content, "object").next()
}

/// Tree entries that refer to objects in this repo (gitlinks excluded).
pub fn tree_entries(content: &[u8]) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < content.len() {
        let sp = content[i..]
            .iter()
            .position(|&b| b == b' ')
            .ok_or("bad tree")?
            + i;
        let mode = &content[i..sp];
        let nul = content[sp..]
            .iter()
            .position(|&b| b == 0)
            .ok_or("bad tree")?
            + sp;
        if nul + 21 > content.len() {
            return Err("bad tree".into());
        }
        let oid = to_hex(&content[nul + 1..nul + 21]);
        if mode != b"160000" {
            out.push(oid);
        }
        i = nul + 21;
    }
    Ok(out)
}
