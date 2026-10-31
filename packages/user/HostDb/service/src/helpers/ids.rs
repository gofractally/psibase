use psibase::native_raw;

use super::constants::ID_LEN;

pub(crate) fn mint_id() -> Vec<u8> {
    let mut id = vec![0u8; ID_LEN];
    unsafe { native_raw::getRandom(id.as_mut_ptr(), id.len()) };
    id
}
