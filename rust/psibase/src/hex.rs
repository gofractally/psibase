use crate::ToKey;
use async_graphql::{InputValueError, InputValueResult, Scalar, ScalarType};
use fracpack::{AnyType, SchemaBuilder, ToSchema};
use std::convert::AsRef;
use std::fmt::{Debug, Display};
use std::marker::PhantomData;
use std::ops::Deref;
use std::str::FromStr;

trait ToHex: Sized + Debug + Clone + PartialEq + Eq + PartialOrd + Ord + ToKey {
    fn to_hex(&self) -> String;
}

pub type HexBytes = Hex<Vec<u8>>;

trait FromHex: ToHex {
    fn from_hex(s: &str) -> Option<Self>;
}

/// Represent inner type as hex in JSON.
///
/// `Hex<Vec<u8>>`, `Hex<&[u8]>`, and `Hex<[u8; SIZE]>` store binary
/// data. This wrapper does not support other inner types.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Hex<T>(pub T);

impl<T> Default for Hex<T>
where
    T: Default + ToHex,
{
    fn default() -> Self {
        Self(Default::default())
    }
}

impl<T> Deref for Hex<T>
where
    T: ToHex,
{
    type Target = T;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<T> From<T> for Hex<T>
where
    T: ToHex,
{
    fn from(inner: T) -> Self {
        Self(inner)
    }
}

impl<T: ToSchema + 'static> ToSchema for Hex<T> {
    fn schema(builder: &mut SchemaBuilder) -> AnyType {
        AnyType::Custom {
            type_: builder.insert::<T>().into(),
            id: "hex".to_string(),
        }
    }
}

impl<T> Display for Hex<T>
where
    T: ToHex,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

impl<T> FromStr for Hex<T>
where
    T: FromHex,
{
    type Err = &'static str;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if let Some(v) = T::from_hex(s) {
            Ok(Self(v))
        } else {
            Err("Hex conversion failed")
        }
    }
}

impl<'a, const SIZE: usize> From<&'a [u8; SIZE]> for Hex<&'a [u8]> {
    fn from(inner: &'a [u8; SIZE]) -> Self {
        Self(inner)
    }
}

impl From<String> for Hex<Vec<u8>> {
    fn from(s: String) -> Self {
        Hex(s.into())
    }
}

impl AsRef<[u8]> for Hex<Vec<u8>>
where
    <Hex<Vec<u8>> as Deref>::Target: AsRef<[u8]>,
{
    fn as_ref(&self) -> &[u8] {
        self.deref().as_ref()
    }
}

impl<T> ToKey for Hex<T>
where
    T: ToHex + crate::fracpack::Pack,
{
    fn append_key(&self, key: &mut Vec<u8>) {
        self.0.append_key(key)
    }
}

// TODO: Fracpack macro support for <T>
impl<T> crate::fracpack::Pack for Hex<T>
where
    T: ToHex + crate::fracpack::Pack,
{
    const FIXED_SIZE: u32 = <T as crate::fracpack::Pack>::FIXED_SIZE;
    const VARIABLE_SIZE: bool = <T as crate::fracpack::Pack>::VARIABLE_SIZE;
    const IS_OPTIONAL: bool = <T as crate::fracpack::Pack>::IS_OPTIONAL;
    fn pack(&self, dest: &mut Vec<u8>) {
        let value = &self.0;
        <&T as crate::fracpack::Pack>::pack(&value, dest)
    }
    fn is_empty_container(&self) -> bool {
        self.0.is_empty_container()
    }
    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        let value = &self.0;
        <&T as crate::fracpack::Pack>::embedded_fixed_pack(&value, dest)
    }
    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        let value = &self.0;
        <&T as crate::fracpack::Pack>::embedded_fixed_repack(&value, fixed_pos, heap_pos, dest)
    }
    fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
        let value = &self.0;
        <&T as crate::fracpack::Pack>::embedded_variable_pack(&value, dest)
    }
}

// TODO: Fracpack macro support for <T>
impl<'a, T> crate::fracpack::Unpack<'a> for Hex<T>
where
    T: ToHex + crate::fracpack::Unpack<'a>,
{
    const FIXED_SIZE: u32 = <T as crate::fracpack::Unpack>::FIXED_SIZE;
    const VARIABLE_SIZE: bool = <T as crate::fracpack::Unpack>::VARIABLE_SIZE;
    const IS_OPTIONAL: bool = <T as crate::fracpack::Unpack>::IS_OPTIONAL;
    fn unpack(src: &'a [u8], pos: &mut u32) -> crate::fracpack::Result<Self> {
        let value = <T as crate::fracpack::Unpack>::unpack(src, pos)?;
        Ok(Self(value))
    }
    fn verify(src: &'a [u8], pos: &mut u32) -> crate::fracpack::Result<()> {
        <T as crate::fracpack::Unpack>::verify(src, pos)
    }
    fn new_empty_container() -> crate::fracpack::Result<Self> {
        Ok(Self(<T as crate::fracpack::Unpack>::new_empty_container()?))
    }
    fn embedded_variable_unpack(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> crate::fracpack::Result<Self> {
        let value =
            <T as crate::fracpack::Unpack>::embedded_variable_unpack(src, fixed_pos, heap_pos)?;
        Ok(Self(value))
    }
    fn embedded_unpack(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> crate::fracpack::Result<Self> {
        let value = <T as crate::fracpack::Unpack>::embedded_unpack(src, fixed_pos, heap_pos)?;
        Ok(Self(value))
    }
    fn embedded_variable_verify(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> crate::fracpack::Result<()> {
        <T as crate::fracpack::Unpack>::embedded_variable_verify(src, fixed_pos, heap_pos)
    }
    fn embedded_verify(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> crate::fracpack::Result<()> {
        <T as crate::fracpack::Unpack>::embedded_verify(src, fixed_pos, heap_pos)
    }
}

impl<T> serde::Serialize for Hex<T>
where
    T: ToHex,
{
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.to_hex())
    }
}

impl<'de, T> serde::Deserialize<'de> for Hex<T>
where
    T: FromHex,
{
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor<T>(PhantomData<T>);
        impl<'de, T> serde::de::Visitor<'de> for Visitor<T>
        where
            T: FromHex,
        {
            type Value = Hex<T>;
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("hex string")
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(Hex(
                    T::from_hex(v).ok_or_else(|| E::custom("Expected hex string"))?
                ))
            }
        }
        deserializer.deserialize_str(Visitor::<T>(PhantomData))
    }
}

#[Scalar]
impl<T> ScalarType for Hex<T>
where
    T: FromHex + Send + Sync,
{
    fn parse(value: async_graphql::Value) -> InputValueResult<Self> {
        if let async_graphql::Value::String(value) = &value {
            Ok(value.parse()?)
        } else {
            Err(InputValueError::expected_type(value))
        }
    }

    fn to_value(&self) -> async_graphql::Value {
        async_graphql::Value::String(self.to_string())
    }
}

const HEX_DIGITS: &[u8; 16] = b"0123456789ABCDEF";

fn from_hex(digit: u8) -> Option<u8> {
    if (b'0'..=b'9').contains(&digit) {
        Some(digit - b'0')
    } else if (b'a'..=b'f').contains(&digit) {
        Some(digit - b'a' + 10)
    } else if (b'A'..=b'F').contains(&digit) {
        Some(digit - b'A' + 10)
    } else {
        None
    }
}

impl ToHex for Vec<u8> {
    fn to_hex(&self) -> String {
        let mut res = String::with_capacity(self.len() * 2);
        for b in self {
            res.push(HEX_DIGITS[(b >> 4) as usize] as char);
            res.push(HEX_DIGITS[(b & 0x0f) as usize] as char);
        }
        res
    }
}

impl FromHex for Vec<u8> {
    fn from_hex(s: &str) -> Option<Self> {
        let s = s.as_bytes();
        if s.len() % 2 != 0 {
            return None;
        }
        let mut res = Vec::with_capacity(s.len() / 2);
        for i in (0..s.len()).step_by(2) {
            res.push((from_hex(s[i])? << 4) | from_hex(s[i + 1])?);
        }
        Some(res)
    }
}

impl<'a> ToHex for &'a [u8] {
    fn to_hex(&self) -> String {
        let mut res = String::with_capacity(self.len() * 2);
        for b in *self {
            res.push(HEX_DIGITS[(b >> 4) as usize] as char);
            res.push(HEX_DIGITS[(b & 0x0f) as usize] as char);
        }
        res
    }
}

impl<const SIZE: usize> ToHex for [u8; SIZE] {
    fn to_hex(&self) -> String {
        let mut res = String::with_capacity(SIZE * 2);
        for b in self {
            res.push(HEX_DIGITS[(b >> 4) as usize] as char);
            res.push(HEX_DIGITS[(b & 0x0f) as usize] as char);
        }
        res
    }
}

impl<const SIZE: usize> FromHex for [u8; SIZE] {
    fn from_hex(s: &str) -> Option<Self> {
        let s = s.as_bytes();
        if s.len() != SIZE * 2 {
            return None;
        }
        let mut res = [0; SIZE];
        for i in (0..s.len()).step_by(2) {
            res[i / 2] = (from_hex(s[i])? << 4) | from_hex(s[i + 1])?;
        }
        Some(res)
    }
}
