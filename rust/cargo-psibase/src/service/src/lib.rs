// This module is linked to the service rlib to create a cdylib

#[no_mangle]
pub unsafe extern "C" fn called(this_service: u64, sender: u64) {
    service::service_wasm_interface::called(this_service, sender)
}

extern "C" {
    fn __wasm_call_ctors();
}

#[no_mangle]
pub unsafe extern "C" fn start(this_service: u64) {
    __wasm_call_ctors();
    service::service_wasm_interface::start(this_service)
}

#[no_mangle]
pub unsafe extern "C" fn psibase_proxy_kv_open_impl(
    db: u32,
    prefix: *const u8,
    prefix_len: u32,
    mode: u8,
) -> u32 {
    service::service_wasm_interface::psibase_service::psibase_proxy_kv_open_impl(
        db, prefix, prefix_len, mode,
    )
}
