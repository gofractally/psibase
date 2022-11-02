use std::ptr::{null, null_mut};
use wasi::{
    Ciovec, Exitcode, Fd, Fdflags, Filedelta, Filesize, Lookupflags, Oflags, Prestat, Rights, Size,
    ERRNO_BADF, ERRNO_INVAL, PREOPENTYPE_DIR,
};

type Errno = u16;

const POLYFILL_ROOT_DIR_FD: u32 = 3;

extern "C" {
    pub fn writeConsole(message: *const u8, len: usize);
    pub fn abortMessage(message: *const u8, len: usize) -> !;
}

#[no_mangle]
pub unsafe extern "C" fn proc_exit(_rval: Exitcode) -> ! {
    abortMessage(null(), 0)
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
pub unsafe extern "C" fn clock_time_get(id: u32, precision: u64, time: *mut u64) -> Errno {
    *time = 0;
    0
}

// Unfortunately it looks like we have to lie instead of returning an error
// to not break some Rust libraries
#[no_mangle]
pub unsafe extern "C" fn random_get(mut buf: *mut u8, mut buf_len: Size) -> Errno {
    while buf_len > 0 {
        *buf = 0;
        buf = buf.offset(1);
        buf_len -= 1;
    }
    0
}

#[no_mangle]
pub unsafe extern "C" fn fd_prestat_get(fd: Fd, buf: *mut Prestat) -> Errno {
    if fd == POLYFILL_ROOT_DIR_FD {
        (*buf).tag = PREOPENTYPE_DIR.raw();
        (*buf).u.dir.pr_name_len = 1; // strlen("/")
        return 0;
    }
    ERRNO_BADF.raw()
}

#[no_mangle]
pub unsafe extern "C" fn fd_prestat_dir_name(fd: Fd, path: *mut u8, path_len: Size) -> Errno {
    if fd == POLYFILL_ROOT_DIR_FD {
        if path_len > 0 {
            *path = b'/';
        }
        return 0;
    }
    ERRNO_BADF.raw()
}

#[no_mangle]
pub unsafe extern "C" fn path_unlink_file(arg0: i32, arg1: i32, arg2: i32) -> Errno {
    ERRNO_INVAL.raw()
}

#[no_mangle]
pub unsafe extern "C" fn path_open(
    fd: Fd,
    dirflags: Lookupflags,
    path: *const u8,
    path_len: Size,
    oflags: Oflags,
    fs_rights_base: Rights,
    fs_rights_inherting: Rights,
    fdflags: Fdflags,
    opened_fd: *mut Fd,
) -> Errno {
    ERRNO_INVAL.raw()
}

#[no_mangle]
pub unsafe extern "C" fn fd_seek(
    fd: Fd,
    offset: Filedelta,
    whence: u8,
    newoffset: *mut Filesize,
) -> Errno {
    ERRNO_INVAL.raw()
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
    if fd != 0 && fd != 1 {
        return ERRNO_BADF.raw();
    }
    while iovs_len > 0 {
        writeConsole((*iovs).buf, (*iovs).buf_len);
        if nwritten != null_mut() {
            *nwritten += (*iovs).buf_len;
        }
        iovs = iovs.offset(1);
        iovs_len -= 1;
    }
    0
}

#[no_mangle]
pub unsafe extern "C" fn fd_close(fd: Fd) -> Errno {
    ERRNO_BADF.raw()
}
