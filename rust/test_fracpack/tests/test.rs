use fracpack::{Packable, Result};
use test_fracpack::*;

fn get_tests1() -> [OuterStruct; 3] {
    [
        OuterStruct {
            field_u8: 1,
            field_u16: 2,
            field_u32: 3,
            field_u64: 4,
            field_i8: -5,
            field_i16: -6,
            field_i32: -7,
            field_i64: -8,
            field_str: "".to_string(),
            field_f32: 9.24,
            field_f64: -10.5,
            field_inner: InnerStruct {
                inner_u32: 1234,
                var: None,
                inner_option_u32: None,
                inner_option_str: Some("".to_string()),
                inner_option_vec_u16: None,
                inner_o_vec_o_u16: None,
            },
            field_u_inner: UnextensibleInnerStruct::default(),
            field_v_inner: vec![],
            field_option_u8: Some(11),
            field_option_u16: Some(12),
            field_option_u32: None,
            field_option_u64: Some(13),
            field_option_i8: Some(-14),
            field_option_i16: None,
            field_option_i32: Some(-15),
            field_option_i64: None,
            field_option_str: Some("".to_string()),
            field_option_f32: Some(-17.5),
            field_option_f64: None,
            field_option_inner: None,
            field_o_o_i8: None,
            field_o_o_str: None,
            field_o_o_str2: Some(Some("".into())),
            field_o_o_inner: None,
        },
        OuterStruct {
            field_u8: 0xff,
            field_u16: 0xfffe,
            field_u32: 0xffff_fffd,
            field_u64: 0xffff_ffff_ffff_fffc,
            field_i8: -0x80,
            field_i16: -0x7fff,
            field_i32: -0x7fff_fffe,
            field_i64: -0x7fff_ffff_ffff_fffc,
            field_str: "ab cd ef".to_string(),
            field_f32: 9.24,
            field_f64: -10.5,
            field_inner: InnerStruct {
                inner_u32: 1234,
                var: Some(Variant::ItemStr("".to_string())),
                inner_option_u32: Some(0x1234),
                inner_option_str: None,
                inner_option_vec_u16: Some(vec![]),
                inner_o_vec_o_u16: Some(vec![None, Some(0x3456), None]),
            },
            field_u_inner: UnextensibleInnerStruct {
                field_bool: true,
                field_u32: 32,
                field_i16: 16,
                field_str: "hello".to_string(),
                field_f32: 3.2,
                field_f64: 64.64,
                field_v_u16: vec![1, 2, 3],
            },
            field_v_inner: vec![
                InnerStruct {
                    inner_u32: 1234,
                    var: Some(Variant::ItemStr("var".to_string())),
                    inner_option_u32: Some(0x1234),
                    inner_option_str: None,
                    inner_option_vec_u16: Some(vec![]),
                    inner_o_vec_o_u16: Some(vec![None, Some(0x3456), None]),
                },
                InnerStruct {
                    inner_u32: 0x9876,
                    var: Some(Variant::ItemU32(3421)),
                    inner_option_u32: None,
                    inner_option_str: Some("xyz".to_string()),
                    inner_option_vec_u16: None,
                    inner_o_vec_o_u16: None,
                },
            ],
            field_option_u8: None,
            field_option_u16: None,
            field_option_u32: Some(0xffff_fff7),
            field_option_u64: None,
            field_option_i8: None,
            field_option_i16: Some(0x7ff6),
            field_option_i32: None,
            field_option_i64: Some(0x7fff_ffff_ffff_fff5),
            field_option_str: Some("hi kl lmnop".to_string()),
            field_option_f32: None,
            field_option_f64: Some(12.0),
            field_option_inner: Some(InnerStruct {
                inner_u32: 1234,
                var: Some(Variant::ItemU32(0)),
                inner_option_u32: Some(0x1234),
                inner_option_str: Some("testing".to_string()),
                inner_option_vec_u16: Some(vec![0x1234, 0x5678]),
                inner_o_vec_o_u16: Some(vec![]),
            }),
            field_o_o_i8: Some(None),
            field_o_o_str: Some(None),
            field_o_o_str2: None,
            field_o_o_inner: Some(None),
        },
        OuterStruct {
            field_u8: 0xff,
            field_u16: 0xfffe,
            field_u32: 0xffff_fffd,
            field_u64: 0xffff_ffff_ffff_fffc,
            field_i8: -0x80,
            field_i16: -0x7fff,
            field_i32: -0x7fff_fffe,
            field_i64: -0x7fff_ffff_ffff_fffc,
            field_str: "ab cd ef".to_string(),
            field_f32: 9.24,
            field_f64: -10.5,
            field_inner: InnerStruct {
                inner_u32: 1234,
                var: Some(Variant::ItemStr("".to_string())),
                inner_option_u32: Some(0x1234),
                inner_option_str: None,
                inner_option_vec_u16: Some(vec![]),
                inner_o_vec_o_u16: Some(vec![None, Some(0x3456), None]),
            },
            field_u_inner: UnextensibleInnerStruct {
                field_bool: false,
                field_u32: 0,
                field_i16: 0,
                field_str: "".to_string(),
                field_f32: 0.0,
                field_f64: 0.0,
                field_v_u16: vec![],
            },
            field_v_inner: vec![InnerStruct {
                inner_u32: 1234,
                var: Some(Variant::ItemStr("var".to_string())),
                inner_option_u32: Some(0x1234),
                inner_option_str: None,
                inner_option_vec_u16: Some(vec![]),
                inner_o_vec_o_u16: Some(vec![None, Some(0x3456), None]),
            }],
            field_option_u8: None,
            field_option_u16: None,
            field_option_u32: Some(0xffff_fff7),
            field_option_u64: None,
            field_option_i8: None,
            field_option_i16: Some(0x7ff6),
            field_option_i32: None,
            field_option_i64: Some(0x7fff_ffff_ffff_fff5),
            field_option_str: Some("hi kl lmnop".to_string()),
            field_option_f32: None,
            field_option_f64: Some(12.0),
            field_option_inner: Some(InnerStruct {
                inner_u32: 1234,
                var: Some(Variant::ItemU32(0)),
                inner_option_u32: Some(0x1234),
                inner_option_str: Some("testing".to_string()),
                inner_option_vec_u16: Some(vec![0x1234, 0x5678]),
                inner_o_vec_o_u16: Some(vec![]),
            }),
            field_o_o_i8: Some(Some(123)),
            field_o_o_str: Some(Some("a string".into())),
            field_o_o_str2: None,
            field_o_o_inner: Some(Some(InnerStruct {
                inner_u32: 1234,
                var: Some(Variant::ItemU32(0)),
                inner_option_u32: Some(0x1234),
                inner_option_str: Some("testing".to_string()),
                inner_option_vec_u16: Some(vec![0x1234, 0x5678]),
                inner_o_vec_o_u16: Some(vec![]),
            })),
        },
    ]
} // get_tests1()

fn round_trip_field<T: fracpack::PackableOwned + PartialEq + std::fmt::Debug>(
    index: usize,
    field: &T,
    field_name: &str,
) -> T {
    println!("    {}", field_name);
    let mut packed = Vec::<u8>::new();
    field.pack(&mut packed);
    println!("packed bytes {:?}", packed);

    // TODO: pos = 0 (!= src.len() when unextensible), is it desired?
    // T::verify_no_extra(&packed[..]).unwrap();

    let unpacked = T::unpack(&packed[..], &mut 0).unwrap();
    assert_eq!(*field, unpacked);
    test_fracpack::bridge::ffi::round_trip_outer_struct_field(index, field_name, &packed[..]);
    unpacked
}

macro_rules! do_rt {
    ($index:expr, $obj:ident, $field:ident) => {
        round_trip_field($index, &$obj.$field, stringify!($field));
    };
}

fn round_trip_fields(index: usize, obj: &OuterStruct) {
    do_rt!(index, obj, field_u8);
    do_rt!(index, obj, field_u16);
    do_rt!(index, obj, field_u32);
    do_rt!(index, obj, field_u64);
    do_rt!(index, obj, field_i8);
    do_rt!(index, obj, field_i16);
    do_rt!(index, obj, field_i32);
    do_rt!(index, obj, field_i64);
    do_rt!(index, obj, field_str);
    do_rt!(index, obj, field_f32);
    do_rt!(index, obj, field_f64);
    do_rt!(index, obj, field_inner);
    do_rt!(index, obj, field_u_inner);
    do_rt!(index, obj, field_v_inner);
    do_rt!(index, obj, field_option_u8);
    do_rt!(index, obj, field_option_u16);
    do_rt!(index, obj, field_option_u32);
    do_rt!(index, obj, field_option_u64);
    do_rt!(index, obj, field_option_i8);
    do_rt!(index, obj, field_option_i16);
    do_rt!(index, obj, field_option_i32);
    do_rt!(index, obj, field_option_i64);
    do_rt!(index, obj, field_option_str);
    do_rt!(index, obj, field_option_f32);
    do_rt!(index, obj, field_option_f64);
    do_rt!(index, obj, field_option_inner);
    do_rt!(index, obj, field_o_o_i8);
    do_rt!(index, obj, field_o_o_str);
    do_rt!(index, obj, field_o_o_str2);
    do_rt!(index, obj, field_o_o_inner);
}

#[test]
fn t1() -> Result<()> {
    for (i, t) in get_tests1().iter().enumerate() {
        println!("index {}", i);
        round_trip_fields(i, t);
        println!("    whole");

        let mut packed = Vec::<u8>::new();
        t.pack(&mut packed);
        println!("    whole packed!");

        OuterStruct::verify(&packed[..], &mut 0)?;
        println!("    whole verified!");

        let unpacked = OuterStruct::unpack(&packed[..], &mut 0)?;
        println!("    whole unpacked {:?}", unpacked);

        assert_eq!(*t, unpacked);
        test_fracpack::bridge::ffi::round_trip_outer_struct(i, &packed[..]);
        // TODO: optionals after fixed-data portion ends
    }
    Ok(())
}

#[test]
fn testz() {
    println!("running tests!!!!!!!");

    let x = MyStruct {
        age1: 0xfafbfcfd,
        btc: 0xfafb,
        cool: true,
        msg: String::from("hello"),
        maybe1: Some(0xfa),
        maybe2: None,
        not_cool: true,
    };
    let mut bytes: Vec<u8> = Vec::new();
    x.pack(&mut bytes);
    println!("rust packed bytes: {:?}", bytes);

    test_fracpack::bridge::ffi::round_tripz(&bytes[..]);

    let unpacked = MyStruct::unpack(&bytes[..], &mut 0).unwrap();
    assert_eq!(x, unpacked);
}
