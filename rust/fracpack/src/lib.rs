use std::mem;

pub trait Packable: Sized {
    fn fixed_size(&self) -> u32;
    fn pack_fixed(&self, dest: &mut Vec<u8>);
    fn repack_fixed(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>);
    fn pack_variable(&self, dest: &mut Vec<u8>);
    fn pack(&self, dest: &mut Vec<u8>);
}

macro_rules! impl_fracpack_fixed {
    ($t:ty) => {
        impl Packable for $t {
            fn fixed_size(&self) -> u32 {
                mem::size_of::<$t> as u32
            }
            fn pack_fixed(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&self.to_le_bytes());
            }
            fn repack_fixed(&self, _fixed_pos: u32, _heap_pos: u32, _dest: &mut Vec<u8>) {}
            fn pack_variable(&self, _dest: &mut Vec<u8>) {}
            fn pack(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&self.to_le_bytes());
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
