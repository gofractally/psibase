#[cxx::bridge]
pub mod ffi {
    unsafe extern "C++" {
        include!("psibase/src/missing.hpp");

        // TODO: Replace with pure rust implementation
        fn pack_signed_transaction(json: &str) -> UniquePtr<CxxVector<u8>>;

        // TODO: Replace with pure rust implementation
        fn pack_upload_sys(json: &str) -> UniquePtr<CxxVector<u8>>;
    }
}
