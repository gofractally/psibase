#[cxx::bridge]
pub mod ffi {
    unsafe extern "C++" {
        include!("psibase/src/missing.hpp");

        // TODO: Replace with pure rust implementation
        fn pack_new_account(json: &str) -> UniquePtr<CxxVector<u8>>;

        // TODO: Replace with pure rust implementation
        fn pack_set_code(json: &str) -> UniquePtr<CxxVector<u8>>;

        // TODO: Replace with pure rust implementation
        fn pack_signed_transaction(json: &str) -> UniquePtr<CxxVector<u8>>;

        // TODO: Replace with pure rust implementation
        fn pack_signed_transactions(json: &str) -> UniquePtr<CxxVector<u8>>;

        // TODO: Replace with pure rust implementation
        fn pack_genesis_action_data(json: &str) -> UniquePtr<CxxVector<u8>>;

        // TODO: Replace with pure rust implementation
        fn pack_startup(json: &str) -> UniquePtr<CxxVector<u8>>;

        // TODO: Replace with pure rust implementation
        fn pack_register_server(json: &str) -> UniquePtr<CxxVector<u8>>;

        // TODO: Replace with pure rust implementation
        fn pack_upload_sys(json: &str) -> UniquePtr<CxxVector<u8>>;
    }
}
