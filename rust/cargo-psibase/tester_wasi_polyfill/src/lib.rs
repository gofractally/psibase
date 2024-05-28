use std::ptr::null_mut;
use wasi::Size;

type Errno = u16;

// We dont need WASI polyfills anymore, but heres an example of wasi_snapshot_preview1::random_get

// // Unfortunately it looks like we have to lie instead of returning an error
// // to not break some Rust libraries
// #[no_mangle]
// pub unsafe extern "C" fn random_get(mut buf: *mut u8, mut buf_len: Size) -> Errno {
//     while buf_len > 0 {
//         *buf = 0;
//         buf = buf.offset(1);
//         buf_len -= 1;
//     }
//     0
// }
