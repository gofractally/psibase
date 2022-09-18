// TODO: fix reading structs and tuples which have unknown fields
// TODO: option to allow/disallow unknown fields during verify and unpack
// TODO: rename misnamed "heap_size"
// TODO: support packing references; replace TupleOfRefPackable

use custom_error::custom_error;
use std::mem;

custom_error! {pub Error
    ReadPastEnd         = "Read past end",
    BadOffset           = "Bad offset",
    BadSize             = "Bad size",
    BadEmptyEncoding    = "Bad empty encoding",
    BadUTF8             = "Bad UTF-8 encoding",
    BadEnumIndex        = "Bad enum index",
    ExtraData           = "Extra data in buffer",
}
pub type Result<T> = std::result::Result<T, Error>;

pub trait PackableOwned: for<'a> Packable<'a> {}
impl<T> PackableOwned for T where T: for<'a> Packable<'a> {}

pub trait Packable<'a>: Sized {
    const FIXED_SIZE: u32;
    const USE_HEAP: bool;
    const IS_OPTIONAL: bool = false;

    fn pack(&self, dest: &mut Vec<u8>);
    fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self>;
    fn verify(src: &'a [u8], pos: &mut u32) -> Result<()>;

    fn verify_no_extra(src: &'a [u8]) -> Result<()> {
        let mut pos = 0;
        Self::verify(src, &mut pos)?;
        if pos as usize != src.len() {
            return Err(Error::ExtraData);
        }
        Ok(())
    }

    fn is_empty_container(&self) -> bool {
        false
    }

    fn new_empty_container() -> Result<Self> {
        Err(Error::BadOffset)
    }

    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        if Self::USE_HEAP {
            dest.extend_from_slice(&0_u32.to_le_bytes());
        } else {
            Self::pack(self, dest);
        }
    }

    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if Self::USE_HEAP && !self.is_empty_container() {
            dest[fixed_pos as usize..fixed_pos as usize + 4]
                .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
        }
    }

    fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
        if Self::USE_HEAP && !self.is_empty_container() {
            self.pack(dest);
        }
    }

    fn embedded_unpack(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<Self> {
        if Self::USE_HEAP {
            let orig_pos = *fixed_pos;
            let offset = u32::unpack(src, fixed_pos)?;
            if offset == 0 {
                return Self::new_empty_container();
            }
            if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                return Err(Error::BadOffset);
            }
            Self::unpack(src, heap_pos)
        } else {
            Self::unpack(src, fixed_pos)
        }
    }

    fn embedded_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
        if Self::USE_HEAP {
            let orig_pos = *fixed_pos;
            let offset = u32::unpack(src, fixed_pos)?;
            if offset == 0 {
                let _ = Self::new_empty_container();
                return Ok(());
            }
            if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                return Err(Error::BadOffset);
            }
            Self::verify(src, heap_pos)
        } else {
            Self::verify(src, fixed_pos)
        }
    }

    fn option_unpack(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<Option<Self>>;
    fn option_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()>;

    /// Helper method to create a new vector of "fracpacked" bytes, since it's a common operation
    fn packed_bytes(&self) -> Vec<u8> {
        let mut bytes = vec![];
        self.pack(&mut bytes);
        bytes
    }
} // Packable

pub trait TupleOfRefPackable<'a>: Sized {
    fn pack_tuple_of_ref(&self, dest: &mut Vec<u8>);
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

// TODO: violates single-valid-serialization rule
trait MissingBoolConversions {
    fn from_le_bytes(bytes: [u8; 1]) -> bool;
    fn to_le_bytes(self) -> [u8; 1];
}

impl MissingBoolConversions for bool {
    fn from_le_bytes(bytes: [u8; 1]) -> bool {
        bytes[0] != 0
    }
    fn to_le_bytes(self) -> [u8; 1] {
        match self {
            true => [1],
            false => [0],
        }
    }
}

macro_rules! scalar_impl {
    ($t:ty) => {
        impl<'a> Packable<'a> for $t {
            const FIXED_SIZE: u32 = mem::size_of::<Self>() as u32;
            const USE_HEAP: bool = false;
            fn pack(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&self.to_le_bytes());
            }
            fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self> {
                Ok(Self::from_le_bytes(read_u8_arr(src, pos)?.into()))
            }
            fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
                if (*pos as u64 + Self::FIXED_SIZE as u64 > src.len() as u64) {
                    Err(Error::ReadPastEnd)
                } else {
                    *pos += Self::FIXED_SIZE;
                    Ok(())
                }
            }
            fn option_unpack(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> Result<Option<Self>> {
                let orig_pos = *fixed_pos;
                let offset = u32::unpack(src, fixed_pos)?;
                if offset == 1 {
                    return Ok(None);
                }
                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(Error::BadOffset);
                }
                Ok(Some(Self::unpack(src, heap_pos)?))
            }
            fn option_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
                let orig_pos = *fixed_pos;
                let offset = u32::unpack(src, fixed_pos)?;
                if offset == 1 {
                    return Ok(());
                }
                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(Error::BadOffset);
                }
                Self::verify(src, heap_pos)
            }
        }
    };
} // scalar_impl

scalar_impl! {bool}
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

impl<'a, T: Packable<'a>> Packable<'a> for Option<T> {
    const FIXED_SIZE: u32 = 4;
    const USE_HEAP: bool = true;
    const IS_OPTIONAL: bool = true;

    fn pack(&self, dest: &mut Vec<u8>) {
        let fixed_pos = dest.len() as u32;
        Self::embedded_fixed_pack(self, dest);
        let heap_pos = dest.len() as u32;
        Self::embedded_fixed_repack(self, fixed_pos, heap_pos, dest);
        Self::embedded_variable_pack(self, dest);
    }

    fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self> {
        let mut fixed_pos = *pos;
        *pos += 4;
        Self::embedded_unpack(src, &mut fixed_pos, pos)
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
        let mut fixed_pos = *pos;
        *pos += 4;
        T::option_verify(src, &mut fixed_pos, pos)
    }

    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        if T::IS_OPTIONAL || !T::USE_HEAP {
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
            if T::IS_OPTIONAL || !T::USE_HEAP {
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

    fn embedded_unpack(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<Self> {
        T::option_unpack(src, fixed_pos, heap_pos)
    }

    fn embedded_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
        T::option_verify(src, fixed_pos, heap_pos)
    }

    fn option_unpack(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<Option<Self>> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 1 {
            return Ok(None);
        }
        if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
            return Err(Error::BadOffset);
        }
        Ok(Some(Self::unpack(src, heap_pos)?))
    }

    fn option_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 1 {
            return Ok(());
        }
        if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
            return Err(Error::BadOffset);
        }
        Self::verify(src, heap_pos)
    }
} // impl<T> Packable for Option<T>

trait BytesConversion<'a>: Sized {
    fn fracpack_verify_if_str(bytes: &'a [u8]) -> Result<()>;
    fn fracpack_from_bytes(bytes: &'a [u8]) -> Result<Self>;
    fn fracpack_as_bytes(&'a self) -> &'a [u8];
}

impl<'a> BytesConversion<'a> for String {
    fn fracpack_verify_if_str(bytes: &'a [u8]) -> Result<()> {
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
    fn fracpack_verify_if_str(bytes: &'a [u8]) -> Result<()> {
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
    fn fracpack_verify_if_str(_bytes: &'a [u8]) -> Result<()> {
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
        impl<'a> Packable<'a> for $t {
            const FIXED_SIZE: u32 = 4;
            const USE_HEAP: bool = true;

            fn pack(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&(self.len() as u32).to_le_bytes());
                dest.extend_from_slice(self.fracpack_as_bytes());
            }

            fn unpack(src: &'a [u8], pos: &mut u32) -> Result<$t> {
                let len = u32::unpack(src, pos)?;
                let bytes = src
                    .get(*pos as usize..(*pos + len) as usize)
                    .ok_or(Error::ReadPastEnd)?;
                *pos += len;
                <$t>::fracpack_from_bytes(bytes)
            }

            fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
                let len = u32::unpack(src, pos)?;
                let bytes = src
                    .get(*pos as usize..(*pos + len) as usize)
                    .ok_or(Error::ReadPastEnd)?;
                *pos += len;
                <$t>::fracpack_verify_if_str(bytes)?;
                Ok(())
            }

            fn is_empty_container(&self) -> bool {
                self.is_empty()
            }

            fn new_empty_container() -> Result<Self> {
                Ok(Default::default())
            }

            fn option_unpack(
                src: &'a [u8],
                fixed_pos: &mut u32,
                heap_pos: &mut u32,
            ) -> Result<Option<Self>> {
                let offset = u32::unpack(src, fixed_pos)?;
                if offset == 1 {
                    return Ok(None);
                }
                *fixed_pos -= 4;
                Ok(Some(Self::embedded_unpack(src, fixed_pos, heap_pos)?))
            }

            fn option_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
                let offset = u32::unpack(src, fixed_pos)?;
                if offset == 1 {
                    return Ok(());
                }
                *fixed_pos -= 4;
                Self::embedded_verify(src, fixed_pos, heap_pos)
            }
        } // impl Packable for $t
    };
} // bytes_impl

bytes_impl! {String}
bytes_impl! {&'a str}
bytes_impl! {&'a [u8]}

impl<'a, T: Packable<'a>> Packable<'a> for Vec<T> {
    const FIXED_SIZE: u32 = 4;
    const USE_HEAP: bool = true;

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

    // TODO: optimize scalar
    fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self> {
        let num_bytes = u32::unpack(src, pos)?;
        if num_bytes % T::FIXED_SIZE != 0 {
            return Err(Error::BadSize);
        }
        let hp = *pos as u64 + num_bytes as u64;
        let mut heap_pos = hp as u32;
        if heap_pos as u64 != hp {
            return Err(Error::ReadPastEnd);
        }
        let len = (num_bytes / T::FIXED_SIZE) as usize;
        let mut result = Self::with_capacity(len);
        for _ in 0..len {
            result.push(T::embedded_unpack(src, pos, &mut heap_pos)?);
        }
        *pos = heap_pos;
        Ok(result)
    }

    // TODO: optimize scalar
    fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
        let num_bytes = u32::unpack(src, pos)?;
        if num_bytes % T::FIXED_SIZE != 0 {
            return Err(Error::BadSize);
        }
        let hp = *pos as u64 + num_bytes as u64;
        let mut heap_pos = hp as u32;
        if heap_pos as u64 != hp {
            return Err(Error::ReadPastEnd);
        }
        for _ in 0..num_bytes / T::FIXED_SIZE {
            T::embedded_verify(src, pos, &mut heap_pos)?;
        }
        *pos = heap_pos;
        Ok(())
    }

    fn is_empty_container(&self) -> bool {
        self.is_empty()
    }

    fn new_empty_container() -> Result<Self> {
        Ok(Default::default())
    }

    fn option_unpack(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<Option<Self>> {
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 1 {
            return Ok(None);
        }
        *fixed_pos -= 4;
        Ok(Some(Self::embedded_unpack(src, fixed_pos, heap_pos)?))
    }

    fn option_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 1 {
            return Ok(());
        }
        *fixed_pos -= 4;
        Self::embedded_verify(src, fixed_pos, heap_pos)
    }
} // impl<T> Packable for Vec<T>

impl<'a, T: Packable<'a>, const N: usize> Packable<'a> for [T; N] {
    const USE_HEAP: bool = T::USE_HEAP;
    const FIXED_SIZE: u32 = if T::USE_HEAP {
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

    fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self> {
        let hp = *pos as u64 + T::FIXED_SIZE as u64 * N as u64;
        let mut heap_pos = hp as u32;
        if heap_pos as u64 != hp {
            return Err(Error::ReadPastEnd);
        }

        let mut items: Vec<T> = Vec::with_capacity(N);
        for _ in 0..N {
            items.push(T::embedded_unpack(src, pos, &mut heap_pos)?);
        }

        let result: [T; N] = items.try_into().unwrap_or_else(|v: Vec<T>| {
            panic!(
                "Expected a fixed array of length {} but it was {}",
                N,
                v.len()
            )
        });
        *pos = heap_pos;
        Ok(result)
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
        let hp = *pos as u64 + T::FIXED_SIZE as u64 * N as u64;
        let mut heap_pos = hp as u32;
        if heap_pos as u64 != hp {
            return Err(Error::ReadPastEnd);
        }
        for _ in 0..N {
            T::embedded_verify(src, pos, &mut heap_pos)?;
        }
        *pos = heap_pos;
        Ok(())
    }

    fn option_unpack(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<Option<Self>> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 1 {
            return Ok(None);
        }

        if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
            return Err(Error::BadOffset);
        }
        Ok(Some(Self::unpack(src, heap_pos)?))
    }
    fn option_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 1 {
            return Ok(());
        }

        if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
            return Err(Error::BadOffset);
        }
        Self::verify(src, heap_pos)
    }
}

macro_rules! tuple_impls {
    ($($len:expr => ($($n:tt $name:ident)+))+) => {
        $(
            impl<'a, $($name: Packable<'a>),+> Packable<'a> for ($($name,)+)
            {
                const USE_HEAP: bool = true;
                const FIXED_SIZE: u32 = 4;

                #[allow(non_snake_case)]
                fn pack(&self, dest: &mut Vec<u8>) {
                    let heap: u32 = $($name::FIXED_SIZE +)+ 0;
                    assert!(heap as u16 as u32 == heap); // TODO: return error
                    (heap as u16).pack(dest);
                    $(
                        let $name = dest.len() as u32;
                        self.$n.embedded_fixed_pack(dest);
                    )+
                    $(
                        let heap_pos = dest.len() as u32;
                        self.$n.embedded_fixed_repack($name, heap_pos, dest);
                        self.$n.embedded_variable_pack(dest);
                    )+
                }

                #[allow(non_snake_case)]
                fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self> {
                    let heap_size = u16::unpack(src, pos)?;
                    let mut heap_pos = *pos + heap_size as u32;
                    if heap_pos < *pos {
                        return Err(Error::BadOffset);
                    }
                    $(
                        let $name = $name::embedded_unpack(src, pos, &mut heap_pos)?;
                    )+
                    *pos = heap_pos;
                    Ok(($($name,)+))
                }

                fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
                    let heap_size = u16::unpack(src, pos)?;
                    let mut heap_pos = *pos + heap_size as u32;
                    if heap_pos < *pos {
                        return Err(Error::BadOffset);
                    }
                    $(
                        $name::embedded_unpack(src, pos, &mut heap_pos)?;
                    )+
                    *pos = heap_pos;
                    Ok(())
                }

                fn option_unpack(
                    src: &'a [u8],
                    fixed_pos: &mut u32,
                    heap_pos: &mut u32,
                ) -> Result<Option<Self>> {
                    let orig_pos = *fixed_pos;
                    let offset = u32::unpack(src, fixed_pos)?;
                    if offset == 1 {
                        return Ok(None);
                    }

                    if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                        return Err(Error::BadOffset);
                    }
                    Ok(Some(Self::unpack(src, heap_pos)?))
                }
                fn option_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
                    let orig_pos = *fixed_pos;
                    let offset = u32::unpack(src, fixed_pos)?;
                    if offset == 1 {
                        return Ok(());
                    }

                    if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                        return Err(Error::BadOffset);
                    }
                    Self::verify(src, heap_pos)
                }
            }

            impl<'a, $($name: Packable<'a>),+> TupleOfRefPackable<'a> for ($(&$name,)+)
            {
                #[allow(non_snake_case)]
                fn pack_tuple_of_ref(&self, dest: &mut Vec<u8>) {
                    let heap: u32 = $($name::FIXED_SIZE +)+ 0;
                    assert!(heap as u16 as u32 == heap); // TODO: return error
                    (heap as u16).pack(dest);
                    $(
                        let $name = dest.len() as u32;
                        self.$n.embedded_fixed_pack(dest);
                    )+
                    $(
                        let heap_pos = dest.len() as u32;
                        self.$n.embedded_fixed_repack($name, heap_pos, dest);
                        self.$n.embedded_variable_pack(dest);
                    )+
                }
            }
        )+
    }
}

tuple_impls! {
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
