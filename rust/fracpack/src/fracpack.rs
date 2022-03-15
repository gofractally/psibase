use custom_error::custom_error;
use std::mem;

custom_error! {pub Error
    ReadPastEnd         = "Read past end",
    BadOffset           = "Bad offset",
    BadEmptyEncoding    = "Bad empty encoding",
}
pub type Result<T> = std::result::Result<T, Error>;

fn read_u8_arr<const SIZE: usize>(src: &[u8], pos: &mut u32) -> Result<[u8; SIZE]> {
    let mut bytes: [u8; SIZE] = [0; SIZE];
    bytes.copy_from_slice(
        src.get(*pos as usize..*pos as usize + SIZE)
            .ok_or(Error::ReadPastEnd)?,
    );
    *pos += SIZE as u32;
    Ok(bytes)
}

pub trait Packable {
    const FIXED_SIZE: u32;
    fn pack_fixed(&self, dest: &mut Vec<u8>);
    fn repack_fixed(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>);
    fn pack_variable(&self, dest: &mut Vec<u8>);
    fn pack(&self, dest: &mut Vec<u8>);
    fn unpack_inplace(&mut self, src: &[u8], fixed_pos: &mut u32, heap_pos: &mut u32)
        -> Result<()>;
    fn unpack_maybe_heap(&mut self, src: &[u8], pos: &mut u32) -> Result<()>;

    fn unpack(src: &[u8], pos: &mut u32) -> Result<Self>
    where
        Self: Default;

    fn option_pack_fixed(opt: &Option<Self>, dest: &mut Vec<u8>)
    where
        Self: Sized,
    {
        self::option_pack_fixed(opt, dest)
    }

    fn option_repack_fixed(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>)
    where
        Self: Sized,
    {
        self::option_repack_fixed(opt, fixed_pos, heap_pos, dest)
    }

    fn option_pack_variable(opt: &Option<Self>, dest: &mut Vec<u8>)
    where
        Self: Sized,
    {
        self::option_pack_variable(opt, dest)
    }

    fn option_unpack_inplace(
        opt: &mut Option<Self>,
        src: &[u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<()>
    where
        Self: Sized + Default,
    {
        self::option_unpack_inplace(opt, src, fixed_pos, heap_pos)
    }
} // Packable

fn option_pack_fixed<T: Packable>(_opt: &Option<T>, dest: &mut Vec<u8>) {
    dest.extend_from_slice(&1u32.to_le_bytes())
}

fn option_repack_fixed<T: Packable>(
    opt: &Option<T>,
    fixed_pos: u32,
    heap_pos: u32,
    dest: &mut Vec<u8>,
) {
    if opt.is_some() {
        dest[fixed_pos as usize..fixed_pos as usize + 4]
            .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes())
    }
}

fn option_pack_variable<T: Packable>(opt: &Option<T>, dest: &mut Vec<u8>) {
    if let Some(x) = opt {
        x.pack(dest)
    }
}

// TODO: check if past fixed area
fn option_unpack_inplace<T: Packable + Default>(
    opt: &mut Option<T>,
    src: &[u8],
    fixed_pos: &mut u32,
    heap_pos: &mut u32,
) -> Result<()> {
    let orig_pos = *fixed_pos;
    let offset = u32::unpack(src, fixed_pos)?;
    if offset == 1 {
        *opt = None;
        return Ok(());
    }
    if *heap_pos != orig_pos + offset {
        return Err(Error::BadOffset);
    }
    *opt = Some(Default::default());
    if let Some(ref mut x) = *opt {
        x.unpack_maybe_heap(src, heap_pos)?;
    }
    Ok(())
}

macro_rules! scalar_impl_fracpack {
    ($t:ty) => {
        impl Packable for $t {
            const FIXED_SIZE: u32 = mem::size_of::<$t>() as u32;
            fn pack_fixed(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&self.to_le_bytes());
            }
            fn repack_fixed(&self, _fixed_pos: u32, _heap_pos: u32, _dest: &mut Vec<u8>) {}
            fn pack_variable(&self, _dest: &mut Vec<u8>) {}
            fn pack(&self, dest: &mut Vec<u8>) {
                self.pack_fixed(dest)
            }
            fn unpack_inplace(
                &mut self,
                src: &[u8],
                fixed_pos: &mut u32,
                _heap_pos: &mut u32,
            ) -> Result<()> {
                self.unpack_maybe_heap(src, fixed_pos)
            }
            fn unpack_maybe_heap(&mut self, src: &[u8], pos: &mut u32) -> Result<()> {
                *self = <$t>::from_le_bytes(read_u8_arr(src, pos)?.into());
                Ok(())
            }
            fn unpack(src: &[u8], pos: &mut u32) -> Result<Self> {
                let mut val: $t = Default::default();
                val.unpack_maybe_heap(src, pos)?;
                Ok(val)
            }
        }
    };
}

scalar_impl_fracpack! {i8}
scalar_impl_fracpack! {i16}
scalar_impl_fracpack! {i32}
scalar_impl_fracpack! {i64}
scalar_impl_fracpack! {u8}
scalar_impl_fracpack! {u16}
scalar_impl_fracpack! {u32}
scalar_impl_fracpack! {u64}
scalar_impl_fracpack! {f32}
scalar_impl_fracpack! {f64}

impl<T: Packable + Sized + Default> Packable for Option<T> {
    const FIXED_SIZE: u32 = 4;

    fn pack_fixed(&self, dest: &mut Vec<u8>) {
        T::option_pack_fixed(self, dest);
    }

    fn repack_fixed(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        T::option_repack_fixed(self, fixed_pos, heap_pos, dest)
    }

    fn pack_variable(&self, dest: &mut Vec<u8>) {
        T::option_pack_variable(self, dest)
    }

    fn pack(&self, _dest: &mut Vec<u8>) {
        todo!("Can option<T> be at the top level?")
    }

    fn unpack_inplace(
        &mut self,
        src: &[u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<()> {
        T::option_unpack_inplace(self, src, fixed_pos, heap_pos)
    }

    fn unpack_maybe_heap(&mut self, _src: &[u8], _pos: &mut u32) -> Result<()> {
        todo!("Does the spec support Option<Option<T>> or top-level Option<T>?")
    }

    fn unpack(_src: &[u8], _pos: &mut u32) -> Result<Self> {
        todo!("Can option<T> be at the top level?")
    }

    fn option_pack_fixed(_opt: &Option<Self>, _dest: &mut Vec<u8>) {
        todo!("Does the spec support Option<Option<T>>?")
    }

    fn option_repack_fixed(
        _opt: &Option<Self>,
        _fixed_pos: u32,
        _heap_pos: u32,
        _dest: &mut Vec<u8>,
    ) {
        todo!("Does the spec support Option<Option<T>>?")
    }

    fn option_pack_variable(_opt: &Option<Self>, _dest: &mut Vec<u8>) {
        todo!("Does the spec support Option<Option<T>>?")
    }

    fn option_unpack_inplace(
        _opt: &mut Option<Self>,
        _src: &[u8],
        _fixed_pos: &mut u32,
        _heap_pos: &mut u32,
    ) -> Result<()> {
        todo!("Does the spec support Option<Option<T>>?")
    }
} // impl Packable for Option<T>

impl Packable for String {
    const FIXED_SIZE: u32 = 4;

    fn pack_fixed(&self, dest: &mut Vec<u8>) {
        dest.extend_from_slice(&0_u32.to_le_bytes());
    }

    fn repack_fixed(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if self.is_empty() {
            return;
        }
        dest[fixed_pos as usize..fixed_pos as usize + 4]
            .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
    }

    fn pack_variable(&self, dest: &mut Vec<u8>) {
        if self.is_empty() {
            return;
        }
        dest.extend_from_slice(&(self.len() as u32).to_le_bytes());
        dest.extend_from_slice(self.as_bytes());
    }

    fn pack(&self, _dest: &mut Vec<u8>) {
        todo!("Does the spec support top-level string?");
    }

    fn unpack_inplace(
        &mut self,
        src: &[u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<()> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 0 {
            self.clear();
            return Ok(());
        }
        if *heap_pos != orig_pos + offset {
            return Err(Error::BadOffset);
        }
        self.unpack_maybe_heap(src, heap_pos)
    }

    fn unpack_maybe_heap(&mut self, src: &[u8], pos: &mut u32) -> Result<()> {
        let len = u32::unpack(src, pos)?;
        if len == 0 {
            return Err(Error::BadEmptyEncoding);
        }
        let bytes = src
            .get(*pos as usize..(*pos + len) as usize)
            .ok_or(Error::ReadPastEnd)?;
        *pos += len;
        // TODO: from_utf8 (error if bad) instead?
        *self = String::from_utf8_lossy(bytes).into_owned();
        Ok(())
    }

    fn unpack(_src: &[u8], _pos: &mut u32) -> Result<Self> {
        todo!("Does the spec support top-level string?");
    }

    fn option_pack_fixed(_opt: &Option<Self>, dest: &mut Vec<u8>) {
        dest.extend_from_slice(&1u32.to_le_bytes())
    }

    fn option_repack_fixed(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if let Some(x) = opt {
            if x.is_empty() {
                dest[fixed_pos as usize..fixed_pos as usize + 4]
                    .copy_from_slice(&0_u32.to_le_bytes())
            } else {
                dest[fixed_pos as usize..fixed_pos as usize + 4]
                    .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes())
            }
        }
    }

    fn option_pack_variable(opt: &Option<Self>, dest: &mut Vec<u8>) {
        if let Some(x) = opt {
            x.pack_variable(dest)
        }
    }

    fn option_unpack_inplace(
        opt: &mut Option<Self>,
        src: &[u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<()> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 1 {
            *opt = None;
            return Ok(());
        }
        if offset == 0 {
            *opt = Some(String::from(""));
            return Ok(());
        }
        if *heap_pos != orig_pos + offset {
            return Err(Error::BadOffset);
        }
        *opt = Some(Default::default());
        if let Some(ref mut x) = *opt {
            x.unpack_maybe_heap(src, heap_pos)?;
        }
        Ok(())
    }
} // impl Packable for String

impl<T: Packable + Default + Clone> Packable for Vec<T> {
    const FIXED_SIZE: u32 = 4;

    fn pack_fixed(&self, dest: &mut Vec<u8>) {
        dest.extend_from_slice(&0_u32.to_le_bytes());
    }

    fn repack_fixed(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
        if !self.is_empty() {
            dest[fixed_pos as usize..fixed_pos as usize + 4]
                .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
        }
    }

    fn pack_variable(&self, dest: &mut Vec<u8>) {
        if self.is_empty() {
            return;
        }
        dest.extend_from_slice(&(self.len() as u32).to_le_bytes());
        dest.reserve(self.len() * (T::FIXED_SIZE as usize));
        let start = dest.len();
        for x in self {
            x.pack_fixed(dest);
        }
        for (i, x) in self.iter().enumerate() {
            let heap_pos = dest.len() as u32;
            x.repack_fixed(start as u32 + (i as u32) * T::FIXED_SIZE, heap_pos, dest);
            x.pack_variable(dest);
        }
    }

    fn pack(&self, _dest: &mut Vec<u8>) {
        todo!("Does the spec support top-level vector?");
    }

    fn unpack_inplace(
        &mut self,
        src: &[u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<()> {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 0 {
            self.clear();
            return Ok(());
        }
        if *heap_pos != orig_pos + offset {
            return Err(Error::BadOffset);
        }
        self.unpack_maybe_heap(src, heap_pos)
    }

    fn unpack_maybe_heap(&mut self, src: &[u8], pos: &mut u32) -> Result<()> {
        let len = u32::unpack(src, pos)?;
        if len == 0 {
            return Err(Error::BadEmptyEncoding);
        }
        let mut heap_pos = *pos + len * T::FIXED_SIZE;
        self.clear();
        self.resize(len as usize, Default::default());
        for x in self {
            x.unpack_inplace(src, pos, &mut heap_pos)?;
        }
        *pos = heap_pos;
        Ok(())
    }

    fn unpack(_src: &[u8], _pos: &mut u32) -> Result<Self> {
        todo!("Does the spec support top-level vector?");
    }

    fn option_pack_fixed(_opt: &Option<Self>, dest: &mut Vec<u8>)
    where
        Self: Sized,
    {
        dest.extend_from_slice(&1u32.to_le_bytes())
    }

    fn option_repack_fixed(opt: &Option<Self>, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>)
    where
        Self: Sized,
    {
        if let Some(x) = opt {
            if x.is_empty() {
                dest[fixed_pos as usize..fixed_pos as usize + 4]
                    .copy_from_slice(&0_u32.to_le_bytes())
            } else {
                dest[fixed_pos as usize..fixed_pos as usize + 4]
                    .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes())
            }
        }
    }

    fn option_pack_variable(opt: &Option<Self>, dest: &mut Vec<u8>)
    where
        Self: Sized,
    {
        if let Some(x) = opt {
            x.pack_variable(dest)
        }
    }

    fn option_unpack_inplace(
        opt: &mut Option<Self>,
        src: &[u8],
        fixed_pos: &mut u32,
        heap_pos: &mut u32,
    ) -> Result<()>
    where
        Self: Sized,
    {
        let orig_pos = *fixed_pos;
        let offset = u32::unpack(src, fixed_pos)?;
        if offset == 1 {
            *opt = None;
            return Ok(());
        }
        if offset == 0 {
            *opt = Some(Default::default());
            return Ok(());
        }
        if *heap_pos != orig_pos + offset {
            return Err(Error::BadOffset);
        }
        *opt = Some(Default::default());
        if let Some(ref mut x) = *opt {
            x.unpack_maybe_heap(src, heap_pos)?;
        }
        Ok(())
    }
} // impl<T> Packable for Vec<T>
