use crate::Hex;
use async_graphql::connection::CursorType;

/// A serialized key
///
/// The serialized data has the same sort order as the non-serialized form.
/// As a `psio` key it is written as it stands, so it composes with other
/// keys (`psio::to_key(&(prefix, raw))`).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RawKey {
    pub data: Vec<u8>,
}

impl RawKey {
    pub fn new(data: Vec<u8>) -> Self {
        RawKey { data }
    }
}

impl psio::key::KeyPack for RawKey {
    fn key_size(&self) -> usize {
        self.data.len()
    }
    fn key_pack(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.data);
    }
}

impl CursorType for RawKey {
    type Error = &'static str;
    fn decode_cursor(s: &str) -> Result<Self, Self::Error> {
        Ok(Self::new(s.parse::<Hex<Vec<u8>>>()?.0))
    }
    fn encode_cursor(&self) -> String {
        Hex(self.data.as_slice()).to_string()
    }
}

/// A serialized key (not owning)
///
/// The serialized data has the same sort order as the non-serialized form
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct KeyView<'a> {
    pub data: &'a [u8],
}

impl<'a> KeyView<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        KeyView { data }
    }
}

impl<'a> psio::key::KeyPack for KeyView<'a> {
    fn key_size(&self) -> usize {
        self.data.len()
    }
    fn key_pack(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(self.data);
    }
}
