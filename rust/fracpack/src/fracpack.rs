// TODO: fix reading structs and tuples which have unknown fields
// TODO: option to allow/disallow unknown fields during verify and unpack
// TODO: replace 'a with 'de; change macro to look for 'de specifically instead of assuming

//! Rust support for the fracpack format.
//!
//! [Psibase](https://psibase.io) uses a new binary format, `fracpack`, which has the following goals:
//!
//! - Quickly pack and unpack data, making it suitable for service-to-service communication, node-to-node communication, blockchain-to-outside communication, and database storage.
//! - Forwards and backwards compatibility; it supports adding new optional fields to the end of structs and tuples, even when they are embedded in variable-length vectors, fixed-length arrays, optional, and other structs and tuples.
//! - Option to read without unpacking (almost zero-copy); helps to efficiently handle large data. TODO: this library doesn't implement this feature yet.
//! - Doesn't require a code generator to support either C++ or Rust; macros and metaprogramming handle it.
//! - Efficient compression when combined with the compression algorithm from Cap 'n' Proto.
//!
//! # Example use
//!
//! ```
//! use fracpack::{Pack, Unpack, Result};
//!
//! #[derive(Pack, Unpack, PartialEq, Debug)]
//! #[fracpack(fracpack_mod = "fracpack")]
//! struct Example {
//!     a_string: String,
//!     a_tuple: (u32, String),
//! }
//!
//! let orig = Example {
//!     a_string: "content".into(),
//!     a_tuple: (1234, "5678".into()),
//! };
//!
//! // Convert to fracpack format
//! let packed: Vec<u8> = orig.packed();
//!
//! // Convert from fracpack format
//! let unpacked = Example::unpacked(&packed)?;
//!
//! assert_eq!(orig, unpacked);
//! # Ok::<(), fracpack::Error>(())
//! ```
//!
//! Note: `#[fracpack(fracpack_mod = "fracpack")]` is only needed when using the `fracpack`
//! library directly instead of through the [psibase crate](https://docs.rs/psibase).
//!
//! # Caution
//!
//! It's easy to accidentally convert from a fixed-size
//! array reference (`&[T;7]`) to a slice (`&[T]`). This matters
//! to fracpack, which has different, and incompatible, encodings
//! for the two types.

use custom_error::custom_error;
pub use psibase_macros::{Pack, ToSchema, Unpack};
use std::{cell::RefCell, hash::Hash, mem, rc::Rc, sync::Arc};

mod schema;
pub use schema::*;

mod nested;
pub use nested::*;

custom_error! {pub Error
    ReadPastEnd         = "Read past end",
    BadOffset           = "Bad offset",
    BadSize             = "Bad size",
    BadUTF8             = "Bad UTF-8 encoding",
    BadEnumIndex        = "Bad enum index",
    ExtraData           = "Extra data in buffer",
    BadScalar           = "Bad scalar value",
    ExtraEmptyOptional  = "Trailing empty optionals must be omitted",
    PtrEmptyList        = "A pointer to an empty list must use zero offset",
    HasUnknown          = "Unknown fields not allowed",
    UnknownType         = "Unknown type",
    ExpectedStringKey   = "Map keys must be strings",
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub struct FracInputStream<'a> {
    pub data: &'a [u8],
    pub pos: u32,
    pub has_unknown: bool,
    pub known_end: bool,
}

impl<'a> FracInputStream<'a> {
    fn new(data: &'a [u8]) -> Self {
        FracInputStream {
            data,
            pos: 0,
            has_unknown: false,
            known_end: true,
        }
    }

    pub fn consume_trailing_optional(
        &mut self,
        fixed_pos: u32,
        heap_pos: u32,
        last_empty: bool,
    ) -> Result<()> {
        let mut fixed_stream = FracInputStream {
            data: &self.data[0..heap_pos as usize],
            pos: fixed_pos,
            has_unknown: false,
            known_end: true,
        };
        consume_trailing_optional(&mut fixed_stream, self, last_empty)
    }

    fn unpack_at<T: Unpack<'a>>(&self, pos: &mut u32) -> Result<T> {
        assert!(!T::VARIABLE_SIZE);
        let mut tmp = FracInputStream {
            data: self.data,
            pos: *pos,
            has_unknown: false,
            known_end: true,
        };
        let result = T::unpack(&mut tmp)?;
        *pos = tmp.pos;
        Ok(result)
    }
    fn verify_at<'b, T: Unpack<'b>>(&self, pos: &mut u32) -> Result<()> {
        assert!(!T::VARIABLE_SIZE);
        let mut tmp = FracInputStream {
            data: self.data,
            pos: *pos,
            has_unknown: false,
            known_end: true,
        };
        T::verify(&mut tmp)?;
        *pos = tmp.pos;
        Ok(())
    }
    pub fn advance(&mut self, len: u32) -> Result<u32> {
        assert!(self.known_end);
        let old_pos = self.pos;
        let Some(pos) = self.pos.checked_add(len) else {
            return Err(Error::ReadPastEnd);
        };
        if pos as usize > self.data.len() {
            return Err(Error::ReadPastEnd);
        }
        self.pos = pos;
        Ok(old_pos)
    }
    pub fn read_fixed(&mut self, len: u32) -> Result<Self> {
        let old_pos = self.advance(len)?;
        let result = FracInputStream {
            data: &self.data[0..self.pos as usize],
            pos: old_pos,
            has_unknown: false,
            known_end: true,
        };
        Ok(result)
    }
    pub(crate) fn set_pos(&mut self, pos: u32) -> Result<()> {
        if self.known_end {
            if self.pos != pos {
                return Err(Error::BadOffset);
            }
        } else {
            if self.pos > pos {
                return Err(Error::BadOffset);
            }
            if pos > self.data.len() as u32 {
                return Err(Error::BadOffset);
            }
            self.pos = pos;
            self.known_end = true;
        }
        Ok(())
    }
    pub(crate) fn remaining(&self) -> u32 {
        self.data.len() as u32 - self.pos
    }
    pub fn finish(&self) -> Result<()> {
        if self.known_end {
            if self.pos != self.data.len() as u32 {
                return Err(Error::ExtraData);
            }
        }
        Ok(())
    }
}

pub(crate) fn consume_trailing_optional(
    fixed_stream: &mut FracInputStream,
    stream: &mut FracInputStream,
    mut last_empty: bool,
) -> Result<()> {
    while fixed_stream.remaining() > 0 {
        let orig_pos = fixed_stream.pos;
        let offset = u32::unpack(fixed_stream)?;
        last_empty = offset == 1;
        if offset > 1 {
            let Some(new_pos) = orig_pos.checked_add(offset) else {
                return Err(Error::ReadPastEnd);
            };
            stream.set_pos(new_pos)?;
            stream.known_end = false;
        }
        stream.has_unknown = true;
    }
    if last_empty {
        return Err(Error::ExtraEmptyOptional);
    }
    Ok(())
}

/// Use this trait on generic functions instead of [Unpack] when
/// the deserialized data may only be owned instead of borrowed from
/// the source.
///
/// ```
/// use fracpack::{UnpackOwned, Error};
///
/// pub fn get_unpacked<T: UnpackOwned>(packed: &[u8]) -> Result<T, Error> {
///     T::unpacked(packed)
/// }
/// ```
pub trait UnpackOwned: for<'a> Unpack<'a> {}
impl<T> UnpackOwned for T where T: for<'a> Unpack<'a> {}

/// Convert to fracpack format
///
/// Use [`#[derive(Pack)]`](psibase_macros::Pack) to implement
/// this trait; manually implementing it is unsupported.
pub trait Pack {
    #[doc(hidden)]
    const FIXED_SIZE: u32;

    #[doc(hidden)]
    const VARIABLE_SIZE: bool;

    #[doc(hidden)]
    const IS_OPTIONAL: bool = false;

    /// Convert to fracpack format
    ///
    /// This packs `self` into the end of `dest`.
    ///
    /// Example:
    ///
    /// ```rust
    /// use fracpack::Pack;
    ///
    /// fn convert(src: &(u32, String)) -> Vec<u8> {
    ///     let mut bytes = Vec::new();
    ///     src.pack(&mut bytes);
    ///     bytes
    /// }
    /// ```
    ///
    /// See [Pack::packed], which is often more convenient.
    fn pack(&self, dest: &mut Vec<u8>);

    /// Convert to fracpack format
    ///
    /// This packs `self` and returns the result.
    ///
    /// Example:
    ///
    /// ```rust
    /// use fracpack::Pack;
    ///
    /// fn packSomething(a: u32, b: &str) -> Vec<u8> {
    ///     (a, b).packed()
    /// }
    /// ```
    fn packed(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        self.pack(&mut bytes);
        bytes
    }

    #[doc(hidden)]
    fn is_empty_container(&self) -> bool {
        false
    }

    #[doc(hidden)]
    fn is_empty_optional(&self) -> bool {
        false
    }

    #[doc(hidden)]
    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        if Self::VARIABLE_SIZE {
            dest.extend_from_slice(&0_u32.to_le_bytes());
        } else {
            Self::pack(self, dest);
        }
    }

    #[doc(hidden)]
    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if Self::VARIABLE_SIZE && !self.is_empty_container() {
            dest[fixed_pos as usize..fixed_pos as usize + 4]
                .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
        }
    }

    #[doc(hidden)]
    fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
        if Self::VARIABLE_SIZE && !self.is_empty_container() {
            self.pack(dest);
        }
    }
}

/// Unpack fracpack data
///
/// Use [`#[derive(Unpack)]`](psibase_macros::Unpack) to implement
/// this trait; manually implementing it is unsupported.
pub trait Unpack<'a>: Sized {
    #[doc(hidden)]
    const FIXED_SIZE: u32;

    #[doc(hidden)]
    const VARIABLE_SIZE: bool;

    #[doc(hidden)]
    const IS_OPTIONAL: bool = false;

    /// Convert from fracpack format. Also verifies the integrity of the data.
    ///
    /// This unpacks `Self` from `src` starting at position `pos`.
    ///
    /// Example:
    ///
    /// ```rust
    /// use fracpack::Unpack;
    ///
    /// fn unpackSomething(src: &[u8]) -> String {
    ///     let mut pos = 0;
    ///     String::unpack(src, &mut pos).unwrap()
    /// }
    /// ```
    ///
    /// See [Pack::unpacked], which is often more convenient.
    fn unpack(src: &mut FracInputStream<'a>) -> Result<Self>;

    /// Convert from fracpack format. Also verifies the integrity of the data.
    ///
    /// This unpacks `Self` from `src`.
    ///
    /// Example:
    ///
    /// ```rust
    /// use fracpack::Unpack;
    ///
    /// fn unpackSomething(src: &[u8]) -> (String, String) {
    ///     <(String, String)>::unpacked(src).unwrap()
    /// }
    /// ```
    fn unpacked(src: &'a [u8]) -> Result<Self> {
        let mut stream = FracInputStream::new(src);
        let result = Self::unpack(&mut stream)?;
        stream.finish()?;
        Ok(result)
    }

    /// Verify the integrity of fracpack data. You don't need to call this if
    /// using [Pack::unpack] since it verifies integrity during unpack.
    fn verify(src: &mut FracInputStream) -> Result<()>;

    /// Verify the integrity of fracpack data, plus make sure there is no
    /// leftover data after it.
    fn verify_no_extra(src: &[u8]) -> Result<()> {
        let mut stream = FracInputStream::new(src);
        Self::verify(&mut stream)?;
        stream.finish()?;
        Ok(())
    }

    #[doc(hidden)]
    fn new_empty_container() -> Result<Self> {
        Err(Error::BadOffset)
    }

    #[doc(hidden)]
    fn new_empty_optional() -> Result<Self> {
        panic!("new_empty_optional must be implemented when IS_OPTIONAL == true");
    }

    #[doc(hidden)]
    fn embedded_variable_unpack(
        src: &mut FracInputStream<'a>,
        fixed_pos: &mut u32,
    ) -> Result<Self> {
        let orig_pos = *fixed_pos;
        let offset = src.unpack_at::<u32>(fixed_pos)?;
        if offset == 0 {
            return Self::new_empty_container();
        }
        let Some(new_pos) = orig_pos.checked_add(offset) else {
            return Err(Error::ReadPastEnd);
        };
        src.set_pos(new_pos)?;
        if Self::new_empty_container().is_ok() {
            if src.unpack_at::<u32>(&mut src.pos.clone())? == 0 {
                return Err(Error::PtrEmptyList);
            }
        }
        Self::unpack(src)
    }

    #[doc(hidden)]
    fn is_empty_optional(src: &FracInputStream, fixed_pos: &mut u32) -> Result<bool> {
        Ok(Self::IS_OPTIONAL && src.unpack_at::<u32>(fixed_pos)? == 1)
    }

    #[doc(hidden)]
    fn embedded_unpack(src: &mut FracInputStream<'a>, fixed_pos: &mut u32) -> Result<Self> {
        if Self::VARIABLE_SIZE {
            Self::embedded_variable_unpack(src, fixed_pos)
        } else {
            src.unpack_at::<Self>(fixed_pos)
        }
    }

    #[doc(hidden)]
    fn embedded_variable_verify(src: &mut FracInputStream, fixed_pos: &mut u32) -> Result<()> {
        let orig_pos = *fixed_pos;
        let offset = src.unpack_at::<u32>(fixed_pos)?;
        if offset == 0 {
            Self::new_empty_container()?;
            return Ok(());
        }
        let Some(new_pos) = orig_pos.checked_add(offset) else {
            return Err(Error::ReadPastEnd);
        };
        src.set_pos(new_pos)?;
        if Self::new_empty_container().is_ok() {
            if src.unpack_at::<u32>(&mut src.pos.clone())? == 0 {
                return Err(Error::PtrEmptyList);
            }
        }
        Self::verify(src)
    }

    #[doc(hidden)]
    fn embedded_verify(src: &mut FracInputStream, fixed_pos: &mut u32) -> Result<()> {
        if Self::VARIABLE_SIZE {
            Self::embedded_variable_verify(src, fixed_pos)
        } else {
            src.verify_at::<Self>(fixed_pos)
        }
    }
}

fn read_u8_arr<const SIZE: usize>(src: &[u8], pos: &mut u32) -> Result<[u8; SIZE]> {
    let mut bytes: [u8; SIZE] = [0; SIZE];
    bytes.copy_from_slice(
        src.get(*pos as usize..*pos as usize + SIZE)
            .ok_or(Error::ReadPastEnd)?,
    );
    *pos += SIZE as u32;
    Ok(bytes)
}

impl<'a, T: Pack> Pack for &'a T {
    const FIXED_SIZE: u32 = T::FIXED_SIZE;
    const VARIABLE_SIZE: bool = T::VARIABLE_SIZE;
    const IS_OPTIONAL: bool = T::IS_OPTIONAL;

    fn pack(&self, dest: &mut Vec<u8>) {
        (*self).pack(dest)
    }

    fn is_empty_container(&self) -> bool {
        (*self).is_empty_container()
    }

    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        (*self).embedded_fixed_pack(dest)
    }

    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        (*self).embedded_fixed_repack(fixed_pos, heap_pos, dest)
    }

    fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
        (*self).embedded_variable_pack(dest)
    }
}

impl Pack for bool {
    const FIXED_SIZE: u32 = mem::size_of::<Self>() as u32;
    const VARIABLE_SIZE: bool = false;
    fn pack(&self, dest: &mut Vec<u8>) {
        dest.push(if *self { 1 } else { 0 });
    }
}

impl<'a> Unpack<'a> for bool {
    const FIXED_SIZE: u32 = mem::size_of::<Self>() as u32;
    const VARIABLE_SIZE: bool = false;
    fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
        match u8::unpack(src)? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(Error::BadScalar),
        }
    }
    fn verify(src: &mut FracInputStream) -> Result<()> {
        Self::unpack(src)?;
        Ok(())
    }
}

macro_rules! scalar_impl {
    ($t:ty) => {
        impl Pack for $t {
            const FIXED_SIZE: u32 = mem::size_of::<Self>() as u32;
            const VARIABLE_SIZE: bool = false;
            fn pack(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&self.to_le_bytes());
            }
        }
        impl<'a> Unpack<'a> for $t {
            const FIXED_SIZE: u32 = mem::size_of::<Self>() as u32;
            const VARIABLE_SIZE: bool = false;
            fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
                Ok(Self::from_le_bytes(
                    read_u8_arr(src.data, &mut src.pos)?.into(),
                ))
            }
            fn verify(src: &mut FracInputStream) -> Result<()> {
                if (src.pos as u64 + <Self as Unpack>::FIXED_SIZE as u64 > src.data.len() as u64) {
                    Err(Error::ReadPastEnd)
                } else {
                    src.pos += <Self as Unpack>::FIXED_SIZE;
                    Ok(())
                }
            }
        }
    };
} // scalar_impl

scalar_impl! {i8}
scalar_impl! {i16}
scalar_impl! {i32}
scalar_impl! {i64}
scalar_impl! {u8}
scalar_impl! {u16}
scalar_impl! {u32}
scalar_impl! {u64}
scalar_impl! {f32}
scalar_impl! {f64}

macro_rules! pack_ptr {
    ($ptr:ident, $to_ref:ident) => {
        impl<T: Pack> Pack for $ptr<T> {
            const FIXED_SIZE: u32 = T::FIXED_SIZE;
            const VARIABLE_SIZE: bool = T::VARIABLE_SIZE;
            const IS_OPTIONAL: bool = T::IS_OPTIONAL;

            fn pack(&self, dest: &mut Vec<u8>) {
                self.$to_ref().pack(dest)
            }

            fn is_empty_container(&self) -> bool {
                self.$to_ref().is_empty_container()
            }

            fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
                self.$to_ref().embedded_fixed_pack(dest)
            }

            fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
                self.$to_ref()
                    .embedded_fixed_repack(fixed_pos, heap_pos, dest)
            }

            fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
                self.$to_ref().embedded_variable_pack(dest)
            }
        }
    };
}

macro_rules! unpack_ptr {
    ($ptr:ident) => {
        impl<'a, T: Unpack<'a>> Unpack<'a> for $ptr<T> {
            const FIXED_SIZE: u32 = T::FIXED_SIZE;
            const VARIABLE_SIZE: bool = T::VARIABLE_SIZE;
            const IS_OPTIONAL: bool = T::IS_OPTIONAL;

            fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
                Ok(Self::new(<T>::unpack(src)?))
            }

            fn verify(src: &mut FracInputStream) -> Result<()> {
                <T>::verify(src)
            }

            fn new_empty_container() -> Result<Self> {
                Ok(Self::new(<T>::new_empty_container()?))
            }

            fn new_empty_optional() -> Result<Self> {
                Ok(Self::new(<T>::new_empty_optional()?))
            }

            fn embedded_variable_unpack(
                src: &mut FracInputStream<'a>,
                fixed_pos: &mut u32,
            ) -> Result<Self> {
                Ok(Self::new(<T>::embedded_variable_unpack(src, fixed_pos)?))
            }

            fn embedded_unpack(src: &mut FracInputStream<'a>, fixed_pos: &mut u32) -> Result<Self> {
                Ok(Self::new(<T>::embedded_unpack(src, fixed_pos)?))
            }

            fn embedded_variable_verify(
                src: &mut FracInputStream,
                fixed_pos: &mut u32,
            ) -> Result<()> {
                <T>::embedded_variable_verify(src, fixed_pos)
            }

            fn embedded_verify(src: &mut FracInputStream, fixed_pos: &mut u32) -> Result<()> {
                <T>::embedded_verify(src, fixed_pos)
            }
        }
    };
}

pack_ptr!(Box, as_ref);
pack_ptr!(Rc, as_ref);
pack_ptr!(Arc, as_ref);
pack_ptr!(RefCell, borrow);

unpack_ptr!(Box);
unpack_ptr!(Rc);
unpack_ptr!(Arc);
unpack_ptr!(RefCell);

impl<T: Pack> Pack for Option<T> {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;
    const IS_OPTIONAL: bool = true;

    fn pack(&self, dest: &mut Vec<u8>) {
        let fixed_pos = dest.len() as u32;
        Self::embedded_fixed_pack(self, dest);
        let heap_pos = dest.len() as u32;
        Self::embedded_fixed_repack(self, fixed_pos, heap_pos, dest);
        Self::embedded_variable_pack(self, dest);
    }

    fn is_empty_optional(&self) -> bool {
        self.is_none()
    }

    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        if T::IS_OPTIONAL || !T::VARIABLE_SIZE {
            dest.extend_from_slice(&1u32.to_le_bytes())
        } else {
            match self {
                Some(x) => x.embedded_fixed_pack(dest),
                None => dest.extend_from_slice(&1u32.to_le_bytes()),
            }
        }
    }

    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if let Some(x) = self {
            if T::IS_OPTIONAL || !T::VARIABLE_SIZE {
                dest[fixed_pos as usize..fixed_pos as usize + 4]
                    .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes())
            } else {
                x.embedded_fixed_repack(fixed_pos, heap_pos, dest)
            }
        }
    }

    fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
        if let Some(x) = self {
            if !x.is_empty_container() {
                x.pack(dest)
            }
        }
    }
}

impl<'a, T: Unpack<'a>> Unpack<'a> for Option<T> {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;
    const IS_OPTIONAL: bool = true;

    fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
        let mut fixed_pos = src.advance(Self::FIXED_SIZE)?;
        Self::embedded_unpack(src, &mut fixed_pos)
    }

    fn verify(src: &mut FracInputStream) -> Result<()> {
        let mut fixed_pos = src.advance(Self::FIXED_SIZE)?;
        Self::embedded_verify(src, &mut fixed_pos)
    }

    fn new_empty_optional() -> Result<Self> {
        Ok(None)
    }

    fn embedded_unpack(src: &mut FracInputStream<'a>, fixed_pos: &mut u32) -> Result<Self> {
        let mut tmp_pos = *fixed_pos;
        if Self::is_empty_optional(src, &mut tmp_pos)? {
            *fixed_pos = tmp_pos;
            return Ok(None);
        }
        Ok(Some(<T>::embedded_variable_unpack(src, fixed_pos)?))
    }

    fn embedded_verify(src: &mut FracInputStream, fixed_pos: &mut u32) -> Result<()> {
        let mut tmp_pos = *fixed_pos;
        if Self::is_empty_optional(src, &mut tmp_pos)? {
            *fixed_pos = tmp_pos;
            return Ok(());
        }
        T::embedded_variable_verify(src, fixed_pos)
    }
}

trait BytesConversion<'a>: Sized {
    fn fracpack_verify_if_str(bytes: &[u8]) -> Result<()>;
    fn fracpack_from_bytes(bytes: &'a [u8]) -> Result<Self>;
    fn fracpack_as_bytes(&'a self) -> &'a [u8];
}

impl<'a> BytesConversion<'a> for String {
    fn fracpack_verify_if_str(bytes: &[u8]) -> Result<()> {
        std::str::from_utf8(bytes).or(Err(Error::BadUTF8))?;
        Ok(())
    }
    fn fracpack_from_bytes(bytes: &'a [u8]) -> Result<Self> {
        Self::from_utf8(bytes.to_vec()).or(Err(Error::BadUTF8))
    }
    fn fracpack_as_bytes(&'a self) -> &'a [u8] {
        self.as_bytes()
    }
}

impl<'a> BytesConversion<'a> for &'a str {
    fn fracpack_verify_if_str(bytes: &[u8]) -> Result<()> {
        std::str::from_utf8(bytes).or(Err(Error::BadUTF8))?;
        Ok(())
    }
    fn fracpack_from_bytes(bytes: &'a [u8]) -> Result<Self> {
        std::str::from_utf8(bytes).or(Err(Error::BadUTF8))
    }
    fn fracpack_as_bytes(&self) -> &'a [u8] {
        self.as_bytes()
    }
}

impl<'a> BytesConversion<'a> for &'a [u8] {
    fn fracpack_verify_if_str(_bytes: &[u8]) -> Result<()> {
        Ok(())
    }
    fn fracpack_from_bytes(bytes: &'a [u8]) -> Result<Self> {
        Ok(bytes)
    }
    fn fracpack_as_bytes(&self) -> &'a [u8] {
        self
    }
}

macro_rules! bytes_impl {
    ($t:ty) => {
        impl<'a> Pack for $t {
            const FIXED_SIZE: u32 = 4;
            const VARIABLE_SIZE: bool = true;

            fn pack(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&(self.len() as u32).to_le_bytes());
                dest.extend_from_slice(self.fracpack_as_bytes());
            }

            fn is_empty_container(&self) -> bool {
                self.is_empty()
            }
        }

        impl<'a> Unpack<'a> for $t {
            const FIXED_SIZE: u32 = 4;
            const VARIABLE_SIZE: bool = true;

            fn unpack(src: &mut FracInputStream<'a>) -> Result<$t> {
                let len = u32::unpack(src)?;
                let bytes = src
                    .data
                    .get(src.pos as usize..(src.pos + len) as usize)
                    .ok_or(Error::ReadPastEnd)?;
                src.pos += len;
                <$t>::fracpack_from_bytes(bytes)
            }

            fn verify(src: &mut FracInputStream) -> Result<()> {
                let len = u32::unpack(src)?;
                let bytes = src
                    .data
                    .get(src.pos as usize..(src.pos + len) as usize)
                    .ok_or(Error::ReadPastEnd)?;
                src.pos += len;
                <$t>::fracpack_verify_if_str(bytes)?;
                Ok(())
            }

            fn new_empty_container() -> Result<Self> {
                Ok(Default::default())
            }
        }
    };
} // bytes_impl

bytes_impl! {String}
bytes_impl! {&'a str}
bytes_impl! {&'a [u8]}

impl<T: Pack> Pack for Vec<T> {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;

    // TODO: optimize scalar
    fn pack(&self, dest: &mut Vec<u8>) {
        let num_bytes = self.len() as u32 * T::FIXED_SIZE;
        dest.extend_from_slice(&num_bytes.to_le_bytes());
        dest.reserve(num_bytes as usize);
        let start = dest.len();
        for x in self {
            T::embedded_fixed_pack(x, dest);
        }
        for (i, x) in self.iter().enumerate() {
            let heap_pos = dest.len() as u32;
            T::embedded_fixed_repack(x, start as u32 + (i as u32) * T::FIXED_SIZE, heap_pos, dest);
            T::embedded_variable_pack(x, dest);
        }
    }

    fn is_empty_container(&self) -> bool {
        self.is_empty()
    }
}

impl<'a, T: Unpack<'a>> Unpack<'a> for Vec<T> {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;

    // TODO: optimize scalar
    fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
        let num_bytes = u32::unpack(src)?;
        if num_bytes % T::FIXED_SIZE != 0 {
            return Err(Error::BadSize);
        }
        let len = (num_bytes / T::FIXED_SIZE) as usize;
        let mut fixed_pos = src.advance(num_bytes)?;
        let mut result = Self::with_capacity(len);
        for _ in 0..len {
            result.push(T::embedded_unpack(src, &mut fixed_pos)?);
        }
        Ok(result)
    }

    // TODO: optimize scalar
    fn verify(src: &mut FracInputStream) -> Result<()> {
        let num_bytes = u32::unpack(src)?;
        if num_bytes % T::FIXED_SIZE != 0 {
            return Err(Error::BadSize);
        }
        let mut fixed_pos = src.advance(num_bytes)?;
        for _ in 0..num_bytes / T::FIXED_SIZE {
            T::embedded_verify(src, &mut fixed_pos)?;
        }
        Ok(())
    }

    fn new_empty_container() -> Result<Self> {
        Ok(Default::default())
    }
}

impl<T: Pack, const N: usize> Pack for [T; N] {
    const VARIABLE_SIZE: bool = T::VARIABLE_SIZE;
    const FIXED_SIZE: u32 = if T::VARIABLE_SIZE {
        4
    } else {
        T::FIXED_SIZE * N as u32
    };

    fn pack(&self, dest: &mut Vec<u8>) {
        let start = dest.len();
        for item in self {
            item.embedded_fixed_pack(dest);
        }
        for (i, item) in self.iter().enumerate() {
            let heap_pos = dest.len() as u32;
            item.embedded_fixed_repack(start as u32 + (i as u32) * T::FIXED_SIZE, heap_pos, dest);
            item.embedded_variable_pack(dest);
        }
    }
}

impl<'a, T: Unpack<'a>, const N: usize> Unpack<'a> for [T; N] {
    const VARIABLE_SIZE: bool = T::VARIABLE_SIZE;
    const FIXED_SIZE: u32 = if T::VARIABLE_SIZE {
        4
    } else {
        T::FIXED_SIZE * N as u32
    };

    fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
        let total_size: u32 = T::FIXED_SIZE * N as u32;
        let mut fixed_pos = src.advance(total_size)?;

        let mut items: Vec<T> = Vec::with_capacity(N);
        for _ in 0..N {
            items.push(T::embedded_unpack(src, &mut fixed_pos)?);
        }

        let result: [T; N] = items.try_into().unwrap_or_else(|v: Vec<T>| {
            panic!(
                "Expected a fixed array of length {} but it was {}",
                N,
                v.len()
            )
        });
        Ok(result)
    }

    fn verify(src: &mut FracInputStream) -> Result<()> {
        let total_size: u32 = T::FIXED_SIZE * N as u32;
        let mut fixed_pos = src.advance(total_size)?;
        for _ in 0..N {
            T::embedded_verify(src, &mut fixed_pos)?;
        }
        Ok(())
    }
}

macro_rules! container_impl {
    (impl<$($n:ident),+> Pack+Unpack for $t:ty $(where $($w:tt)*)?) =>
    {
        impl <$($n:Pack),+> Pack for $t $(where $($w)*)?
{
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;

    fn pack(&self, dest: &mut Vec<u8>) {
        let num_bytes = self.len() as u32 * <&$t as IntoIterator>::Item::FIXED_SIZE;
        dest.extend_from_slice(&num_bytes.to_le_bytes());
        dest.reserve(num_bytes as usize);
        let start = dest.len();
        for x in self {
            <&$t as IntoIterator>::Item::embedded_fixed_pack(&x, dest);
        }
        for (i, x) in self.into_iter().enumerate() {
            let heap_pos = dest.len() as u32;
            <&$t as IntoIterator>::Item::embedded_fixed_repack(&x, start as u32 + (i as u32) * <&$t as IntoIterator>::Item::FIXED_SIZE, heap_pos, dest);
            <&$t as IntoIterator>::Item::embedded_variable_pack(&x, dest);
        }
    }

    fn is_empty_container(&self) -> bool {
        self.into_iter().next().is_none()
    }
}

impl<'a, $($n: Unpack<'a>),+> Unpack<'a> for $t $(where $($w)*)? {
    const FIXED_SIZE: u32 = 4;
    const VARIABLE_SIZE: bool = true;

    fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
        let num_bytes = u32::unpack(src)?;
        if num_bytes % <$t as IntoIterator>::Item::FIXED_SIZE != 0 {
            return Err(Error::BadSize);
        }
        let len = (num_bytes / <$t as IntoIterator>::Item::FIXED_SIZE) as usize;
        let mut fixed_pos = src.advance(num_bytes)?;
        (0..len).map(|_| {
            <$t as IntoIterator>::Item::embedded_unpack(src, &mut fixed_pos)
        }).collect()
    }

    fn verify(src: &mut FracInputStream) -> Result<()> {
        let num_bytes = u32::unpack(src)?;
        if num_bytes % <$t as IntoIterator>::Item::FIXED_SIZE != 0 {
            return Err(Error::BadSize);
        }
        let mut fixed_pos = src.advance(num_bytes)?;
        for _ in 0..num_bytes / <$t as IntoIterator>::Item::FIXED_SIZE {
            <$t as IntoIterator>::Item::embedded_verify(src, &mut fixed_pos)?;
        }
        Ok(())
    }

    fn new_empty_container() -> Result<Self> {
        Ok(Default::default())
    }
}
    }
}

container_impl!(impl<K, V> Pack+Unpack for indexmap::IndexMap<K, V> where K: Hash, K: Eq);

macro_rules! tuple_impls {
    ($($len:expr => ($($n:tt $name:ident)*))+) => {
        $(
            impl<$($name: Pack),*> Pack for ($($name,)*)
            {
                const VARIABLE_SIZE: bool = true;
                const FIXED_SIZE: u32 = 4;

                #[allow(non_snake_case)]
                fn pack(&self, dest: &mut Vec<u8>) {
                    let _trailing_empty_index = [
                        $({!<$name as Pack>::is_empty_optional(&self.$n)}),*
                    ].iter().rposition(|is_non_empty: &bool| *is_non_empty).map_or(0, |idx| idx + 1);

                    let mut _heap: u32 = 0;
                    $({
                        if $n < _trailing_empty_index {
                            _heap += <$name as Pack>::FIXED_SIZE;
                        }
                    })*
                    assert!(_heap as u16 as u32 == _heap); // TODO: return error
                    (_heap as u16).pack(dest);



                    $(
                        let $name = dest.len() as u32;
                        if $n < _trailing_empty_index {
                            self.$n.embedded_fixed_pack(dest);
                        }
                    )*
                    $(
                        if $n < _trailing_empty_index {
                            let heap_pos = dest.len() as u32;
                            self.$n.embedded_fixed_repack($name, heap_pos, dest);
                            self.$n.embedded_variable_pack(dest);
                        }
                    )*
                }
            }

            impl<'a, $($name: Unpack<'a>),*> Unpack<'a> for ($($name,)*)
            {
                const VARIABLE_SIZE: bool = true;
                const FIXED_SIZE: u32 = 4;

                #[allow(non_snake_case,unused_mut)]
                fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
                    let fixed_size = u16::unpack(src)?;
                    let mut fixed_pos = src.advance(fixed_size as u32)?;
                    let heap_pos = src.pos;
                    let mut last_empty = false;
                    let _trailing_optional_index = [$(<$name as Unpack>::IS_OPTIONAL,)*].iter().rposition(|is_optional: &bool| !is_optional).map_or(0, |idx| idx + 1);
                    $(
                        let $name = if $n < _trailing_optional_index || fixed_pos < heap_pos {
                            last_empty = <$name as Unpack>::is_empty_optional(src, &mut fixed_pos.clone())?;
                            $name::embedded_unpack(src, &mut fixed_pos)?
                        } else {
                            $name::new_empty_optional()?
                        };
                    )*
                    src.consume_trailing_optional(fixed_pos, heap_pos, last_empty)?;
                    Ok(($($name,)*))
                }

                #[allow(unused_mut)]
                fn verify(src: &mut FracInputStream) -> Result<()> {
                    let fixed_size = u16::unpack(src)?;
                    let mut fixed_pos = src.advance(fixed_size as u32)?;
                    let heap_pos = src.pos;
                    let mut last_empty = false;
                    let _trailing_optional_index = [$(<$name as Unpack>::IS_OPTIONAL,)*].iter().rposition(|is_optional: &bool| !is_optional).map_or(0, |idx| idx + 1);
                    $(
                        if $n < _trailing_optional_index || fixed_pos < heap_pos {
                            last_empty = <$name as Unpack>::is_empty_optional(src, &mut fixed_pos.clone())?;
                            $name::embedded_verify(src, &mut fixed_pos)?;
                        }
                    )*
                    src.consume_trailing_optional(fixed_pos, heap_pos, last_empty)?;
                    Ok(())
                }
            }
        )+
    }
}

tuple_impls! {
    0 => ()
    1 => (0 T0)
    2 => (0 T0 1 T1)
    3 => (0 T0 1 T1 2 T2)
    4 => (0 T0 1 T1 2 T2 3 T3)
    5 => (0 T0 1 T1 2 T2 3 T3 4 T4)
    6 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5)
    7 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6)
    8 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7)
    9 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8)
    10 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9)
    11 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10)
    12 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11)
    13 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11 12 T12)
    14 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11 12 T12 13 T13)
    15 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11 12 T12 13 T13 14 T14)
    16 => (0 T0 1 T1 2 T2 3 T3 4 T4 5 T5 6 T6 7 T7 8 T8 9 T9 10 T10 11 T11 12 T12 13 T13 14 T14 15 T15)
}
