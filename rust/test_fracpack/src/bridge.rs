#[cxx::bridge]
pub mod ffi {
    unsafe extern "C++" {
        include!("test_fracpack/tests/test.hpp");

        fn round_trip_outer_struct(index: usize, blob: &[u8]);
        fn round_trip_outer_struct_field(index: usize, field_name: &str, blob: &[u8]);
    }
}
