use psibase::native_raw;

pub(crate) fn mint_random<const N: usize>() -> Vec<u8> {
    let mut id = vec![0u8; N];
    unsafe { native_raw::getRandom(id.as_mut_ptr(), id.len()) };
    id
}
