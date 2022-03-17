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

pub trait Packable<'a>: Sized {
    const FIXED_SIZE: u32;

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

    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>);
    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>);
    fn embedded_variable_pack(&self, dest: &mut Vec<u8>);
    fn embedded_unpack(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<Self>;
    fn embedded_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()>;

    fn option_fixed_pack(opt: &Option<Self>, dest: &mut Vec<u8>);
    fn option_fixed_repack(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>);
    fn option_variable_pack(opt: &Option<Self>, dest: &mut Vec<u8>);
    fn option_unpack(
        src: &'a [u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<Option<Self>>;
    fn option_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()>;
} // Packable

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
            fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
                self.pack(dest)
            }
            fn embedded_fixed_repack(&self, _fixed_pos: u32, _heap_pos: u32, _dest: &mut Vec<u8>) {}
            fn embedded_variable_pack(&self, _dest: &mut Vec<u8>) {}
            fn embedded_unpack(
                src: &'a [u8],
                fixed_pos: &mut u32,
                _heap_pos: &mut u32,
            ) -> Result<Self> {
                Self::unpack(src, fixed_pos)
            }
            fn embedded_verify(
                src: &'a [u8],
                fixed_pos: &mut u32,
                _heap_pos: &mut u32,
            ) -> Result<()> {
                Self::verify(src, fixed_pos)
            }
            fn option_fixed_pack(_opt: &Option<Self>, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&1u32.to_le_bytes())
            }
            fn option_fixed_repack(
                opt: &Option<Self>,
                fixed_pos: u32,
                heap_pos: u32,
                dest: &mut Vec<u8>,
            ) {
                if let Some(_) = opt {
                    dest[fixed_pos as usize..fixed_pos as usize + 4]
                        .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes())
                }
            }
            fn option_variable_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
                if let Some(x) = opt {
                    x.pack(dest)
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
} // scalar_impl_fracpack

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

    fn pack(&self, dest: &mut Vec<u8>) {
        let fixed_pos = dest.len() as u32;
        self.embedded_fixed_pack(dest);
        let heap_pos = dest.len() as u32;
        self.embedded_fixed_repack(fixed_pos, heap_pos, dest);
        self.embedded_variable_pack(dest);
    }

    fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self> {
        let mut fixed_pos = *pos;
        *pos += 4;
        T::option_unpack(src, &mut fixed_pos, pos)
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
        let mut fixed_pos = *pos;
        *pos += 4;
        T::option_verify(src, &mut fixed_pos, pos)
    }

    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        T::option_fixed_pack(self, dest)
    }

    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        T::option_fixed_repack(self, fixed_pos, heap_pos, dest)
    }

    fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
        T::option_variable_pack(self, dest)
    }

    fn embedded_unpack(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<Self> {
        T::option_unpack(src, fixed_pos, heap_pos)
    }

    fn embedded_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
        T::option_verify(src, fixed_pos, heap_pos)
    }

    fn option_fixed_pack(_opt: &Option<Self>, dest: &mut Vec<u8>) {
        dest.extend_from_slice(&1u32.to_le_bytes())
    }

    fn option_fixed_repack(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if let Some(_) = opt {
            dest[fixed_pos as usize..fixed_pos as usize + 4]
                .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes())
        }
    }

    fn option_variable_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
        if let Some(x) = opt {
            x.pack(dest)
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
        Ok(Some(<Self as Packable<'a>>::unpack(src, heap_pos)?))
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

impl<'a> Packable<'a> for String {
    const FIXED_SIZE: u32 = 4;

    fn pack(&self, dest: &mut Vec<u8>) {
        dest.extend_from_slice(&(self.len() as u32).to_le_bytes());
        dest.extend_from_slice(self.as_bytes());
    }

    fn unpack(src: &'a [u8], pos: &mut u32) -> Result<Self> {
        let len = u32::unpack(src, pos)?;
        let bytes = src
            .get(*pos as usize..(*pos + len) as usize)
            .ok_or(Error::ReadPastEnd)?;
        *pos += len;
        Self::from_utf8(bytes.to_vec()).or(Err(Error::BadUTF8))
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> Result<()> {
        let len = u32::unpack(src, pos)?;
        let bytes = src
            .get(*pos as usize..(*pos + len) as usize)
            .ok_or(Error::ReadPastEnd)?;
        *pos += len;
        std::str::from_utf8(bytes).or(Err(Error::BadUTF8))?;
        Ok(())
    }

    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        dest.extend_from_slice(&0_u32.to_le_bytes());
    }

    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if self.is_empty() {
            return;
        }
        dest[fixed_pos as usize..fixed_pos as usize + 4]
            .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
    }

    fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
        if self.is_empty() {
            return;
        }
        self.pack(dest)
    }

    fn embedded_unpack(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<Self> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 0 {
            return Ok(Self::new());
        }
        if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
            return Err(Error::BadOffset);
        }
        let len = u32::unpack(src, heap_pos)?;
        if len == 0 {
            return Err(Error::BadEmptyEncoding);
        }
        let bytes = src
            .get(*heap_pos as usize..(*heap_pos + len) as usize)
            .ok_or(Error::ReadPastEnd)?;
        *heap_pos += len;
        Self::from_utf8(bytes.to_vec()).or(Err(Error::BadUTF8))
    }

    fn embedded_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 0 {
            return Ok(());
        }
        if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
            return Err(Error::BadOffset);
        }
        let len = u32::unpack(src, heap_pos)?;
        if len == 0 {
            return Err(Error::BadEmptyEncoding);
        }
        let bytes = src
            .get(*heap_pos as usize..(*heap_pos + len) as usize)
            .ok_or(Error::ReadPastEnd)?;
        std::str::from_utf8(bytes).or(Err(Error::BadUTF8))?;
        *heap_pos += len;
        Ok(())
    }

    fn option_fixed_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
        match opt {
            Some(x) => x.embedded_fixed_pack(dest),
            None => dest.extend_from_slice(&1u32.to_le_bytes()),
        }
    }

    fn option_fixed_repack(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        match opt {
            Some(x) => x.embedded_fixed_repack(fixed_pos, heap_pos, dest),
            None => (),
        }
    }

    fn option_variable_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
        match opt {
            Some(x) => x.embedded_variable_pack(dest),
            None => (),
        }
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
} // impl Packable for String

impl<'a, T: Packable<'a>> Packable<'a> for Vec<T> {
    const FIXED_SIZE: u32 = 4;

    // TODO: optimize scalar
    fn pack(&self, dest: &mut Vec<u8>) {
        let num_bytes = self.len() as u32 * T::FIXED_SIZE;
        dest.extend_from_slice(&num_bytes.to_le_bytes());
        dest.reserve(num_bytes as usize);
        let start = dest.len();
        for x in self {
            x.embedded_fixed_pack(dest);
        }
        for (i, x) in self.iter().enumerate() {
            let heap_pos = dest.len() as u32;
            x.embedded_fixed_repack(start as u32 + (i as u32) * T::FIXED_SIZE, heap_pos, dest);
            x.embedded_variable_pack(dest);
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
            <T>::embedded_verify(src, pos, &mut heap_pos)?;
        }
        *pos = heap_pos;
        Ok(())
    }

    fn embedded_fixed_pack(&self, dest: &mut Vec<u8>) {
        dest.extend_from_slice(&0_u32.to_le_bytes());
    }

    fn embedded_fixed_repack(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if !self.is_empty() {
            dest[fixed_pos as usize..fixed_pos as usize + 4]
                .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
        }
    }

    fn embedded_variable_pack(&self, dest: &mut Vec<u8>) {
        if self.is_empty() {
            return;
        }
        self.pack(dest)
    }

    // TODO: optimize scalar
    fn embedded_unpack(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<Self> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 0 {
            return Ok(Self::new());
        }
        if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
            return Err(Error::BadOffset);
        }
        let num_bytes = u32::unpack(src, heap_pos)?;
        if num_bytes == 0 {
            return Err(Error::BadEmptyEncoding);
        }
        if num_bytes % T::FIXED_SIZE != 0 {
            return Err(Error::BadSize);
        }
        let mut inner_fixed_pos = *heap_pos;
        let hp = *heap_pos as u64 + num_bytes as u64;
        *heap_pos = hp as u32;
        if *heap_pos as u64 != hp {
            return Err(Error::ReadPastEnd);
        }
        let len = (num_bytes / T::FIXED_SIZE) as usize;
        let mut result = Self::with_capacity(len);
        for _ in 0..len {
            result.push(T::embedded_unpack(src, &mut inner_fixed_pos, heap_pos)?);
        }
        Ok(result)
    }

    // TODO: optimize scalar
    fn embedded_verify(src: &'a [u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 0 {
            return Ok(());
        }
        if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
            return Err(Error::BadOffset);
        }
        let num_bytes = u32::unpack(src, heap_pos)?;
        if num_bytes == 0 {
            return Err(Error::BadEmptyEncoding);
        }
        if num_bytes % T::FIXED_SIZE != 0 {
            return Err(Error::BadSize);
        }
        let mut inner_fixed_pos = *heap_pos;
        let hp = *heap_pos as u64 + num_bytes as u64;
        *heap_pos = hp as u32;
        if *heap_pos as u64 != hp {
            return Err(Error::ReadPastEnd);
        }
        for _ in 0..num_bytes / T::FIXED_SIZE {
            <T>::embedded_verify(src, &mut inner_fixed_pos, heap_pos)?;
        }
        Ok(())
    }

    fn option_fixed_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
        match opt {
            Some(x) => x.embedded_fixed_pack(dest),
            None => dest.extend_from_slice(&1u32.to_le_bytes()),
        }
    }

    fn option_fixed_repack(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        match opt {
            Some(x) => x.embedded_fixed_repack(fixed_pos, heap_pos, dest),
            None => (),
        }
    }

    fn option_variable_pack(opt: &Option<Self>, dest: &mut Vec<u8>) {
        match opt {
            Some(x) => x.embedded_variable_pack(dest),
            None => (),
        }
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
