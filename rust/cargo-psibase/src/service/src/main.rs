fn main() {
    service::service_wasm_interface::psibase::print_schema_impl::<
        service::service_wasm_interface::Wrapper,
    >()
}

mod psibase_tester_polyfill {
    #![allow(non_snake_case)]

    use psibase::native_raw::KvHandle;
    use psibase::tester;
    use psibase::tester_raw;
    use psibase::{DbId, KvMode};
    use service::service_wasm_interface::psibase;

    #[no_mangle]
    pub unsafe extern "C" fn getResult(dest: *mut u8, dest_size: u32, offset: u32) -> u32 {
        tester_raw::getResult(dest, dest_size, offset)
    }

    #[no_mangle]
    pub unsafe extern "C" fn getKey(dest: *mut u8, dest_size: u32) -> u32 {
        tester::polyfill::getKey(dest, dest_size)
    }

    #[no_mangle]
    pub unsafe extern "C" fn writeConsole(message: *const u8, len: u32) {
        print!(
            "{}",
            std::str::from_utf8(std::slice::from_raw_parts(message, len as usize)).unwrap()
        );
    }

    #[no_mangle]
    pub unsafe extern "C" fn abortMessage(message: *const u8, len: u32) -> ! {
        tester_raw::abortMessage(message, len)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvOpen(
        db: DbId,
        key: *const u8,
        key_len: u32,
        mode: KvMode,
    ) -> KvHandle {
        tester::polyfill::kvOpen(db, key, key_len, mode)
    }

    #[no_mangle]
    pub unsafe extern "C" fn psibase_proxy_kv_open(
        db: DbId,
        key: *const u8,
        key_len: u32,
        mode: KvMode,
    ) -> KvHandle {
        tester::polyfill::kvOpen(db, key, key_len, mode)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvOpenAt(
        db: KvHandle,
        key: *const u8,
        key_len: u32,
        mode: KvMode,
    ) -> KvHandle {
        tester::polyfill::kvOpenAt(db, key, key_len, mode)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvClose(handle: KvHandle) {
        tester::polyfill::kvClose(handle)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvGet(db: KvHandle, key: *const u8, key_len: u32) -> u32 {
        tester::polyfill::kvGet(db, key, key_len)
    }

    #[no_mangle]
    pub unsafe extern "C" fn getSequential(db: DbId, id: u64) -> u32 {
        tester::polyfill::getSequential(db, id)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvGreaterEqual(
        db: KvHandle,
        key: *const u8,
        key_len: u32,
        match_key_size: u32,
    ) -> u32 {
        tester::polyfill::kvGreaterEqual(db, key, key_len, match_key_size)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvLessThan(
        db: KvHandle,
        key: *const u8,
        key_len: u32,
        match_key_size: u32,
    ) -> u32 {
        tester::polyfill::kvLessThan(db, key, key_len, match_key_size)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvMax(db: KvHandle, key: *const u8, key_len: u32) -> u32 {
        tester::polyfill::kvMax(db, key, key_len)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvPut(
        db: KvHandle,
        key: *const u8,
        key_len: u32,
        value: *const u8,
        value_len: u32,
    ) {
        tester::polyfill::kvPut(db, key, key_len, value, value_len)
    }

    #[no_mangle]
    pub unsafe extern "C" fn kvRemove(db: KvHandle, key: *const u8, key_len: u32) {
        tester::polyfill::kvRemove(db, key, key_len)
    }

    #[no_mangle]
    pub unsafe extern "C" fn setRetval(_retval: *const u8, _len: u32) -> u32 {
        panic!("setRetval not supported in tester");
    }
    #[no_mangle]
    pub unsafe extern "C" fn call(_action: *const u8, _len: u32, _flags: u64) -> u32 {
        panic!("call not supported in tester");
    }
    #[no_mangle]
    pub unsafe extern "C" fn putSequential(_db: DbId, _value: *const u8, _value_len: u32) -> u64 {
        panic!("putSequential not supported in tester");
    }
    #[no_mangle]
    pub unsafe extern "C" fn getCurrentAction() -> u32 {
        panic!("getCurrentAction not supported in tester");
    }
}
