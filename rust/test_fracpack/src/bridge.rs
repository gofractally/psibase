#[cxx::bridge]
pub mod ffi {
    unsafe extern "C++" {
        include!("test_fracpack/tests/test.hpp");

        fn tests1(index: usize, blob: &[u8]);
    }
}
