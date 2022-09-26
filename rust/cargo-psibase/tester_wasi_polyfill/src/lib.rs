use std::ptr::null_mut;
use wasi::{
    Ciovec, Exitcode, Fd, Fdflags, Filedelta, Filesize, Filestat, Iovec, Lookupflags, Oflags,
    Prestat, Rights, Size, ERRNO_BADF, ERRNO_INVAL, PREOPENTYPE_DIR,
};

type Errno = u16;

const POLYFILL_ROOT_DIR_FD: u32 = 3;

extern "C" {
    fn testerExit(rval: u32) -> !;
    fn testerGetArgCounts(argc: *mut Size, argv_buf_size: *mut Size);
    fn testerGetArgs(argv: *mut *mut u8, argv_buf: *mut u8);
    fn testerClockTimeGet(id: u32, precision: u64, time: *mut u64) -> Errno;
    fn testerOpenFile(
        path: *const u8,
        path_len: Size,
        oflags: u16,
        fs_rights_base: u64,
        fdflags: u16,
        opened_fd: *mut u32,
    ) -> Errno;
    fn testerReadFile(fd: u32, data: *mut u8, size: Size, bytes_read: *mut Size) -> Errno;
    fn testerWriteFile(fd: u32, content: *const u8, content_len: Size) -> Errno;
    fn testerCloseFile(fd: Fd) -> Errno;
}

#[no_mangle]
pub unsafe extern "C" fn proc_exit(rval: Exitcode) -> ! {
    testerExit(rval)
}

#[no_mangle]
pub unsafe extern "C" fn sched_yield() -> Errno {
    0
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
pub unsafe extern "C" fn args_sizes_get(argc: *mut Size, argv_buf_size: *mut Size) -> Errno {
    testerGetArgCounts(argc, argv_buf_size);
    0
}

#[no_mangle]
pub unsafe extern "C" fn args_get(argv: *mut *mut u8, argv_buf: *mut u8) -> Errno {
    testerGetArgs(argv, argv_buf);
    0
}

#[no_mangle]
pub unsafe extern "C" fn clock_time_get(id: u32, precision: u64, time: *mut u64) -> Errno {
    testerClockTimeGet(id, precision, time)
}

#[no_mangle]
pub unsafe extern "C" fn random_get(buf: *mut u8, buf_len: Size) -> Errno {
    ERRNO_INVAL.raw()
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
pub unsafe extern "C" fn path_filestat_get(
    fd: Fd,
    flags: Lookupflags,
    path: *const u8,
    path_len: Size,
    ret: *mut Filestat,
) -> Errno {
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
    if fd != POLYFILL_ROOT_DIR_FD {
        return ERRNO_BADF.raw();
    }
    testerOpenFile(path, path_len, oflags, fs_rights_base, fdflags, opened_fd)
}

#[no_mangle]
pub unsafe extern "C" fn fd_filestat_get(fd: Fd, retptr0: *mut Filestat) -> Errno {
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
pub unsafe extern "C" fn fd_read(
    fd: Fd,
    mut iovs: *mut Iovec,
    mut iovs_len: Size,
    nread: *mut Size,
) -> Errno {
    if nread != null_mut() {
        *nread = 0;
    }
    while iovs_len > 0 {
        // We're reusing (*iovs).buf_len to receive bytes_read instead of a local
        // variable to hack around the lack of a data SP (no reloc available).
        // We're violating Rust's aliasing rules (iovs should be *const Iovec),
        // so this wouldn't be safe under LTO, but we're linking wasm-to-wasm post
        // LTO.
        let buf_len = (*iovs).buf_len;
        let error = testerReadFile(fd, (*iovs).buf, buf_len, &mut (*iovs).buf_len);
        let bytes_read = (*iovs).buf_len;
        (*iovs).buf_len = buf_len;
        if error != 0 {
            return error;
        }
        if nread != null_mut() {
            *nread += bytes_read;
        }
        if bytes_read < (*iovs).buf_len {
            return 0;
        }
        iovs = iovs.offset(1);
        iovs_len -= 1;
    }
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

#[no_mangle]
pub unsafe extern "C" fn fd_close(fd: Fd) -> Errno {
    testerCloseFile(fd)
}
