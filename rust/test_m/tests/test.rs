use fracpack::*;
use psi_macros::*;

#[derive(Fracpack, Default, PartialEq, Debug)]
pub struct InnerStruct {
    inner_u32: u32,
    inner_option_u32: Option<u32>,
}

#[derive(Fracpack, Default, PartialEq, Debug)]
pub struct TestType {
    field_u8: u8,
    field_u16: u16,
    field_u32: u32,
    field_u64: u64,
    field_i8: i8,
    field_i16: i16,
    field_i32: i32,
    field_i64: i64,
    field_f32: f32,
    field_f64: f64,
    field_inner: InnerStruct,
    field_option_u8: Option<u8>,
    field_option_u16: Option<u16>,
    field_option_u32: Option<u32>,
    field_option_u64: Option<u64>,
    field_option_i8: Option<i8>,
    field_option_i16: Option<i16>,
    field_option_i32: Option<i32>,
    field_option_i64: Option<i64>,
    field_option_f32: Option<f32>,
    field_option_f64: Option<f64>,
    field_option_inner: Option<InnerStruct>,
}

#[cxx::bridge]
mod ffi {
    unsafe extern "C++" {
        include!("test_m/tests/test.hpp");

        fn tests1(index: usize, blob: &[u8]);
    }
}

const TESTS1: [TestType; 2] = [
    TestType {
        field_u8: 1,
        field_u16: 2,
        field_u32: 3,
        field_u64: 4,
        field_i8: -5,
        field_i16: -6,
        field_i32: -7,
        field_i64: -8,
        field_f32: 9.24,
        field_f64: -10.5,
        field_inner: InnerStruct {
            inner_u32: 1234,
            inner_option_u32: None,
        },
        field_option_u8: Some(11),
        field_option_u16: Some(12),
        field_option_u32: None,
        field_option_u64: Some(13),
        field_option_i8: Some(-14),
        field_option_i16: None,
        field_option_i32: Some(-15),
        field_option_i64: None,
        field_option_f32: Some(-17.5),
        field_option_f64: None,
        field_option_inner: None,
    },
    TestType {
        field_u8: 0xff,
        field_u16: 0xfffe,
        field_u32: 0xffff_fffd,
        field_u64: 0xffff_ffff_ffff_fffc,
        field_i8: -0x80,
        field_i16: -0x7fff,
        field_i32: -0x7fff_fffe,
        field_i64: -0x7fff_ffff_ffff_fffc,
        field_f32: 9.24,
        field_f64: -10.5,
        field_inner: InnerStruct {
            inner_u32: 1234,
            inner_option_u32: Some(0x1234),
        },
        field_option_u8: None,
        field_option_u16: None,
        field_option_u32: Some(0xffff_fff7),
        field_option_u64: None,
        field_option_i8: None,
        field_option_i16: Some(0x7ff6),
        field_option_i32: None,
        field_option_i64: Some(0x7fff_ffff_ffff_fff5),
        field_option_f32: None,
        field_option_f64: Some(12.0),
        field_option_inner: Some(InnerStruct {
            inner_u32: 1234,
            inner_option_u32: Some(0x1234),
        }),
    },
];

#[test]
fn t1() -> Result<()> {
    for (i, t) in TESTS1.iter().enumerate() {
        let mut packed = Vec::<u8>::new();
        t.pack(&mut packed);
        let unpacked = TestType::unpack(&mut &packed[..])?;
        assert_eq!(*t, unpacked);
        ffi::tests1(i, &packed[..]);
        // TODO: optionals after fixed-data portion ends
    }
    Ok(())
}
