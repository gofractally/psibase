use std::io::{Error, ErrorKind, Read, Result};
use std::mem;

pub fn read_u8_arr<R: Read, const SIZE: usize>(src: &mut R) -> Result<[u8; SIZE]> {
    let mut bytes: [u8; SIZE] = [0; SIZE];
    if src.read(&mut bytes)? != SIZE {
        return Err(Error::new(ErrorKind::UnexpectedEof, "Unexpected EOF"));
    }
    Ok(bytes)
}

pub trait Packable: Sized + Default {
    const FIXED_SIZE: u32;
    fn pack_fixed(&self, dest: &mut Vec<u8>);
    fn repack_fixed(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>);
    fn pack_variable(&self, dest: &mut Vec<u8>);
    fn pack(&self, dest: &mut Vec<u8>);
    fn unpack_inplace(&mut self, src: &mut &[u8]) -> Result<()>;
    fn unpack(src: &mut &[u8]) -> Result<Self> {
        let mut result: Self = Default::default();
        result.unpack_inplace(src)?;
        Ok(result)
    }
}

macro_rules! impl_fracpack_fixed {
    ($t:ty) => {
        impl Packable for $t {
            const FIXED_SIZE: u32 = mem::size_of::<u32>() as u32;
            fn pack_fixed(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&self.to_le_bytes());
            }
            fn repack_fixed(&self, _fixed_pos: u32, _heap_pos: u32, _dest: &mut Vec<u8>) {}
            fn pack_variable(&self, _dest: &mut Vec<u8>) {}
            fn pack(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&self.to_le_bytes());
            }
            fn unpack_inplace(&mut self, src: &mut &[u8]) -> Result<()> {
                *self = <$t>::from_le_bytes(read_u8_arr(src)?.into());
                Ok(())
            }
        }
    };
}

impl_fracpack_fixed! {i8}
impl_fracpack_fixed! {i16}
impl_fracpack_fixed! {i32}
impl_fracpack_fixed! {i64}
impl_fracpack_fixed! {u8}
impl_fracpack_fixed! {u16}
impl_fracpack_fixed! {u32}
impl_fracpack_fixed! {u64}
impl_fracpack_fixed! {f32}
impl_fracpack_fixed! {f64}
