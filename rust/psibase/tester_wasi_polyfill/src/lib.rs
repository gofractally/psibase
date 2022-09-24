use std::ptr::null_mut;
use wasi::{Ciovec, Exitcode, Fd, Size};

type Errno = u16;

extern "C" {
    pub fn testerExit(rval: u32) -> !;
    pub fn testerWriteFile(fd: u32, content: *const u8, content_len: usize) -> Errno;
}

#[no_mangle]
pub unsafe extern "C" fn proc_exit(rval: Exitcode) -> ! {
    testerExit(rval)
}

#[no_mangle]
pub unsafe extern "C" fn environ_sizes_get(ptr0: *mut Size, ptr1: *mut Size) -> Errno {
    *ptr0 = 0;
    *ptr1 = 0;
    0
}

#[no_mangle]
pub unsafe extern "C" fn environ_get(_environ: *mut *mut u8, _environ_buf: *mut u8) -> Errno {
    0
}

#[no_mangle]
pub unsafe extern "C" fn fd_write(
    fd: Fd,
    mut iovs: *const Ciovec,
    mut iovs_len: Size,
    nwritten: *mut Size,
) -> Errno {
    if nwritten != null_mut() {
        *nwritten = 0;
    }
    while iovs_len > 0 {
        let error = testerWriteFile(fd, (*iovs).buf, (*iovs).buf_len);
        if error != 0 {
            return error;
        }
        if nwritten != null_mut() {
            *nwritten += (*iovs).buf_len;
        }
        iovs = iovs.offset(1);
        iovs_len -= 1;
    }
    0
}
