use fracpack::{Pack, Result, SchemaBuilder, ToSchema, Unpack, UnpackOwned};
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
            field_u_inner: DefWontChangeInnerStruct {
                field_bool: false,
                field_u32: 0,
                field_var: Variant::ItemU32(0),
                field_i16: 0,
                field_o_var: None,
                field_str: "".to_string(),
                field_a_i16_3: [0, 0, 0],
                field_f32: 0.0,
                field_o_v_i8: None,
                field_a_s_2: ["".to_string(), "".to_string()],
                field_f64: 0.0,
                field_o_str: None,
                field_v_u16: vec![],
                field_i32: 0,
            },
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
            field_option_sws: None,
            field_option_sns: None,
            field_option_inner: None,
            field_option_u_inner: None,
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
            field_u_inner: DefWontChangeInnerStruct {
                field_bool: true,
                field_u32: 32,
                field_var: Variant::ItemStr("abcd".to_string()),
                field_i16: 16,
                field_o_var: Some(Variant::ItemU32(99)),
                field_str: "hello".to_string(),
                field_a_i16_3: [44, 55, 66],
                field_f32: 3.2,
                field_o_v_i8: Some(vec![11, 22, 33]),
                field_a_s_2: ["cc".to_string(), "dd".to_string()],
                field_f64: 64.64,
                field_o_str: Some("hi".to_string()),
                field_v_u16: vec![1, 2, 3],
                field_i32: -123,
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
            field_option_sws: Some(SimpleWithString {
                a: 0x0a,
                b: 0x0b,
                c: 0x0c,
                s: "hi".to_string(),
                f: 1.23,
            }),
            field_option_sns: Some(SimpleWithNoString {
                a: 0xaa,
                b: 0xbb,
                c: 0xcc,
                f: 4.56,
            }),
            field_option_inner: Some(InnerStruct {
                inner_u32: 1234,
                var: Some(Variant::ItemU32(0)),
                inner_option_u32: Some(0x1234),
                inner_option_str: Some("testing".to_string()),
                inner_option_vec_u16: Some(vec![0x1234, 0x5678]),
                inner_o_vec_o_u16: Some(vec![]),
            }),
            field_option_u_inner: Some(DefWontChangeInnerStruct {
                field_bool: true,
                field_u32: 44,
                field_var: Variant::ItemStr("xyz".to_string()),
                field_i16: 55,
                field_o_var: Some(Variant::ItemU32(88)),
                field_str: "byebye".to_string(),
                field_a_i16_3: [77, 88, 99],
                field_f32: 6.4,
                field_o_v_i8: Some(vec![44, 55, 66]),
                field_a_s_2: ["aa".to_string(), "bb".to_string()],
                field_f64: 128.128,
                field_o_str: Some("lo".to_string()),
                field_v_u16: vec![3, 2, 1],
                field_i32: -999,
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
            field_u_inner: DefWontChangeInnerStruct {
                field_bool: false,
                field_u32: 0,
                field_var: Variant::ItemU32(0),
                field_i16: 0,
                field_o_var: None,
                field_str: "".to_string(),
                field_a_i16_3: [0, 0, 0],
                field_f32: 0.0,
                field_o_v_i8: None,
                field_a_s_2: ["".to_string(), "".to_string()],
                field_f64: 0.0,
                field_o_str: None,
                field_v_u16: vec![],
                field_i32: 0,
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
            field_option_sws: None,
            field_option_sns: None,
            field_option_inner: Some(InnerStruct {
                inner_u32: 1234,
                var: Some(Variant::ItemU32(0)),
                inner_option_u32: Some(0x1234),
                inner_option_str: Some("testing".to_string()),
                inner_option_vec_u16: Some(vec![0x1234, 0x5678]),
                inner_o_vec_o_u16: Some(vec![]),
            }),
            field_option_u_inner: Some(DefWontChangeInnerStruct {
                field_bool: false,
                field_u32: 0,
                field_var: Variant::ItemU32(0),
                field_i16: 0,
                field_o_var: None,
                field_str: "".to_string(),
                field_a_i16_3: [0, 0, 0],
                field_f32: 0.0,
                field_o_v_i8: None,
                field_a_s_2: ["".to_string(), "".to_string()],
                field_f64: 0.0,
                field_o_str: None,
                field_v_u16: vec![],
                field_i32: 0,
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

fn round_trip_field<T: Pack + UnpackOwned + PartialEq + std::fmt::Debug>(
    index: usize,
    field: &T,
    field_name: &str,
) -> T {
    println!("    {}", field_name);
    let mut packed = Vec::<u8>::new();
    field.pack(&mut packed);

    println!("packed > {}", hex::encode(&packed[..]).to_uppercase());

    T::verify_no_extra(&packed[..]).unwrap();

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
    do_rt!(index, obj, field_option_sws);
    println!("comparing sns");
    do_rt!(index, obj, field_option_sns);
    println!("compared sns");
    do_rt!(index, obj, field_option_inner);
    do_rt!(index, obj, field_option_u_inner);
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
        let mut packed = Vec::<u8>::new();
        t.pack(&mut packed);
        OuterStruct::verify(&packed[..], &mut 0)?;
        let unpacked = OuterStruct::unpack(&packed[..], &mut 0)?;
        assert_eq!(*t, unpacked);
        test_fracpack::bridge::ffi::round_trip_outer_struct(i, &packed[..]);
        // TODO: optionals after fixed-data portion ends

        let mut builder = SchemaBuilder::new();
        builder.insert_named::<OuterStruct>("OuterStruct".to_string());
        let schema = builder.build().packed();
        test_fracpack::bridge::ffi::round_trip_with_schema(i, &schema[..], &packed[..]);
    }
    Ok(())
}

#[test]
fn test_simple() {
    let sws = SimpleWithString {
        a: 0x0a,
        b: 0x0b,
        c: 0x0c,
        s: "hi".to_string(),
        f: 1.23,
    };
    pack_and_compare(
        &sws,
        "0A0000000B000000000000000C0008000000A4709D3F020000006869",
    );
}

#[test]
fn test_complex_structs() {
    let osa = OuterSimpleArray {
        oa: 0x0a,
        ob: 0x0b,
        oc: 0x0c,
        arrs: ["hi".to_string(), "abc".to_string(), "xyz".to_string()],
        s: "qwerty".to_string(),
        sti163: ThreeElementsFixedStruct {
            element_1: 0xdd,
            element_2: 0xee,
            element_3: 0xff,
        },
        ari163: [0xdd, 0xee, 0xff],
        z: true,
    };
    pack_and_compare(
        &osa,
        "23000A0000000B000000000000000C001500000031000000DD00EE00FF00DD00EE00FF00010C0000000E00000011000000020000006869030000006162630300000078797A06000000717765727479",
    );

    let sws = SimpleWithString {
        a: 0x0a,
        b: 0x0b,
        c: 0x0c,
        s: "hi".to_string(),
        f: 1.23,
    };
    let os = ParentStruct {
        oa: 0xfa,
        ob: 0xfb,
        oc: 0xfc,
        ar: [0xea, 0xeb, 0xec],
        is: sws,
        vu32: vec![0xaa, 0xbb, 0xcc],
        ar_s: ["d".to_string(), "e".to_string(), "f".to_string()],
        z: true,
        s: "abc".to_string(),
    };
    pack_and_compare(
        &os,
        "2500FA000000FB00000000000000FC00EA00EB00EC00110000002900000035000000014B0000000A0000000B000000000000000C0008000000A4709D3F0200000068690C000000AA000000BB000000CC0000000C0000000D0000000E00000001000000640100000065010000006603000000616263",
    );
}

#[test]
fn test_unextensible_option_fields() {
    let x = UnextensibleWithOptions {
        a: 0x0a,
        opt_a: Some(0x1a),
        b: 0x0b,
        opt_b: Some(0x1b),
        c: 0x0c,
        opt_c: Some(0x1c),
        s: "hi".to_string(),
        opt_s: Some("bye".to_string()),
        f: 1.23,
        opt_f: Some(2.34),
    };
    pack_and_compare(
        &x,
        "0A000000260000000B000000000000001E0000000C00200000001E00000020000000A4709D3F1F0000001A0000001B000000000000001C00020000006869030000006279658FC21540",
    );
}

#[test]
fn test_fixed_arrays() {
    let x = ThreeElementsFixedStruct {
        element_1: 1234,
        element_2: 0,
        element_3: -1234,
    };
    let expected_elements_hex = "D20400002EFB";
    pack_and_compare(&x, expected_elements_hex);

    let x_array: [i16; 3] = [1234, 0, -1234];
    pack_and_compare(&x_array, expected_elements_hex);

    // since vectors does not have fixed sizes we have to prefix the vector length
    let x_vector: Vec<i16> = vec![1234, 0, -1234];
    let mut bytes: Vec<u8> = Vec::new();
    x_vector.pack(&mut bytes);
    let encoded_x_vector_hex = hex::encode(&bytes).to_uppercase();
    assert_eq!(
        encoded_x_vector_hex,
        "06000000".to_owned() + expected_elements_hex
    );
}

#[test]
fn test_tuples() {
    let x_tuple: (i16, i16, i16) = (1234, 0, -1234);
    pack_and_compare(&x_tuple, "0600D20400002EFB");

    let sws_tuple: (u32, u64, u16, String, f32) = (0x0a, 0x0b, 0x0c, "hi".to_string(), 1.23);
    pack_and_compare(
        &sws_tuple,
        "16000A0000000B000000000000000C0008000000A4709D3F020000006869",
    );
}

#[test]
fn test_full_outer_struct() {
    let outer_struct = &get_tests1()[0];
    pack_and_compare(outer_struct, "8200010200030000000400000000000000FBFAFFF9FFFFFFF8FFFFFFFFFFFFFF000000000AD7134100000000000025C0540000006200000000000000A4000000A1000000010000009B0000009F000000010000009800000001000000000000009000000001000000010000000100000001000000010000000100000001000000740000001000D204000001000000010000000000000000000000003400000000000100000000000000000000000000000000000100000021000000000000000000000001000000000000000000000000040000000000000000000000000000000B0C000D00000000000000F2F1FFFFFF00008CC100000000");
}

#[test]
fn test_trailing_options() {
    let all_values_present = MultipleTrailingOptions {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: Some("bye".to_string()),
        opt_z: Some(4),
    };
    pack_and_compare(
        &all_values_present,
        "1C000100000002000000000000001000000012000000120000001500000002000000686903000000030000006279650400000000000000",
    );

    let empty_last_option = MultipleTrailingOptions {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: Some("bye".to_string()),
        opt_z: None,
    };
    pack_and_compare(
        &empty_last_option,
        "18000100000002000000000000000C0000000E0000000E0000000200000068690300000003000000627965",
    );

    let empty_last_two_options = MultipleTrailingOptions {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: None,
        opt_z: None,
    };
    pack_and_compare(
        &empty_last_two_options,
        "1400010000000200000000000000080000000A00000002000000686903000000",
    );

    let empty_trailing_options = MultipleTrailingOptions {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: None,
        opt_y: None,
        opt_z: None,
    };
    pack_and_compare(
        &empty_trailing_options,
        "100001000000020000000000000004000000020000006869",
    );

    let inner_struct = InnerStruct {
        inner_u32: 1234,
        var: None,
        inner_option_u32: None,
        inner_option_str: Some("".to_string()),
        inner_option_vec_u16: None,
        inner_o_vec_o_u16: None,
    };
    pack_and_compare(&inner_struct, "1000D2040000010000000100000000000000");
}

#[test]
fn test_aliased_trailing_options() {
    let all_values_present = TrailingWithAliasedOptionType {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: Some("bye".to_string()),
        opt_z: Some(4),
    };
    pack_and_compare(
        &all_values_present,
        "1C000100000002000000000000001000000012000000120000001500000002000000686903000000030000006279650400000000000000",
    );

    let empty_last_option = TrailingWithAliasedOptionType {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: Some("bye".to_string()),
        opt_z: None,
    };
    pack_and_compare(
        &empty_last_option,
        "18000100000002000000000000000C0000000E0000000E0000000200000068690300000003000000627965",
    );

    let empty_last_two_options = TrailingWithAliasedOptionType {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: None,
        opt_z: None,
    };
    pack_and_compare(
        &empty_last_two_options,
        "1400010000000200000000000000080000000A00000002000000686903000000",
    );

    let empty_trailing_options = TrailingWithAliasedOptionType {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: None,
        opt_y: None,
        opt_z: None,
    };
    pack_and_compare(
        &empty_trailing_options,
        "100001000000020000000000000004000000020000006869",
    );
}

#[test]
fn options_but_not_trailing() {
    let x = vec![
        <u64 as fracpack::Pack>::IS_OPTIONAL,
        <u64 as fracpack::Pack>::IS_OPTIONAL,
        <Option<String> as fracpack::Pack>::IS_OPTIONAL,
        <Option<String> as fracpack::Pack>::IS_OPTIONAL,
    ];
    let last_non_optional_index = x
        .iter()
        .rposition(|&is_optional| !is_optional)
        .unwrap_or(usize::MAX);
    assert_eq!(last_non_optional_index, 1);
    let x = vec![
        <Option<String> as fracpack::Pack>::IS_OPTIONAL,
        <Option<String> as fracpack::Pack>::IS_OPTIONAL,
    ];
    let last_non_optional_index = x
        .iter()
        .rposition(|&is_optional| !is_optional)
        .unwrap_or(usize::MAX);
    assert_eq!(last_non_optional_index, usize::MAX);
    let x = vec![
        <u64 as fracpack::Pack>::IS_OPTIONAL,
        <Option<String> as fracpack::Pack>::IS_OPTIONAL,
    ];
    let last_non_optional_index = x
        .iter()
        .rposition(|&is_optional| !is_optional)
        .unwrap_or(usize::MAX);
    assert_eq!(last_non_optional_index, 0);
    let x = vec![
        <u64 as fracpack::Pack>::IS_OPTIONAL,
        <u64 as fracpack::Pack>::IS_OPTIONAL,
    ];
    let last_non_optional_index = x
        .iter()
        .rposition(|&is_optional| !is_optional)
        .unwrap_or(usize::MAX);
    assert_eq!(last_non_optional_index, 1);

    let empty_middle_option = OptionInTheMiddle {
        a: 1,
        opt_b: None,
        c: 2,
    };
    pack_and_compare(&empty_middle_option, "0C00010000000100000002000000");

    let def_wont_change_inner_struct = DefWontChangeInnerStruct {
        field_bool: false,
        field_u32: 0,
        field_var: Variant::ItemU32(0),
        field_i16: 0,
        field_o_var: None,
        field_str: "".to_string(),
        field_a_i16_3: [0, 0, 0],
        field_f32: 0.0,
        field_o_v_i8: None,
        field_a_s_2: ["".to_string(), "".to_string()],
        field_f64: 0.0,
        field_o_str: None,
        field_v_u16: vec![],
        field_i32: 0,
    };
    pack_and_compare(
        &def_wont_change_inner_struct,
        "0000000000340000000000010000000000000000000000000000000000010000002100000000000000000000000100000000000000000000000004000000000000000000000000000000",
    );

    let def_wont_change_inner_struct2 = DefWontChangeInnerStruct {
        field_bool: true,
        field_u32: 44,
        field_var: Variant::ItemStr("xyz".to_string()),
        field_i16: 55,
        field_o_var: Some(Variant::ItemU32(88)),
        field_str: "byebye".to_string(),
        field_a_i16_3: [77, 88, 99],
        field_f32: 6.4,
        field_o_v_i8: Some(vec![44, 55, 66]),
        field_a_s_2: ["aa".to_string(), "bb".to_string()],
        field_f64: 128.128,
        field_o_str: Some("lo".to_string()),
        field_v_u16: vec![3, 2, 1],
        field_i32: -999,
    };
    pack_and_compare(
        &def_wont_change_inner_struct2,
        "012C0000003400000037003A0000003F0000004D0058006300CDCCCC403B0000003E0000006ABC749318046040460000004800000019FCFFFF01070000000300000078797A00040000005800000006000000627965627965030000002C3742080000000A000000020000006161020000006262020000006C6F06000000030002000100",
    );
}

#[test]
fn test_trailing_options_unextensible() {
    let all_values_present = UnextensibleMultipleTrailingOptions {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: Some("bye".to_string()),
        opt_z: Some(4),
    };
    pack_and_compare(
        &all_values_present,
        "0100000002000000000000001000000012000000120000001500000002000000686903000000030000006279650400000000000000",
    );

    let empty_last_option = UnextensibleMultipleTrailingOptions {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: Some("bye".to_string()),
        opt_z: None,
    };
    pack_and_compare(
        &empty_last_option,
        "010000000200000000000000100000001200000012000000010000000200000068690300000003000000627965",
    );

    let empty_last_two_options = UnextensibleMultipleTrailingOptions {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: Some(3),
        opt_y: None,
        opt_z: None,
    };
    pack_and_compare(
        &empty_last_two_options,
        "0100000002000000000000001000000012000000010000000100000002000000686903000000",
    );

    let empty_trailing_options = UnextensibleMultipleTrailingOptions {
        a: 1,
        b: 2,
        s: "hi".to_string(),
        opt_x: None,
        opt_y: None,
        opt_z: None,
    };
    pack_and_compare(
        &empty_trailing_options,
        "01000000020000000000000010000000010000000100000001000000020000006869",
    );
}

#[test]
fn invalid_cases() {
    // bool is 0 or 1
    // test_invalid::<bool>(&["02", "03", "FF"]);

    // optional must be 1 or an offset pointer
    // test_invalid::<Option<u8>>(&["00000000", "02000000", "03000000", "05000000FFFF"]);

    // vector byte size must be a multiple of the element size
    test_invalid::<Vec<u16>>(&["03000000FFFFFFFFFFFF"]);

    // negative offset
    test_invalid::<(u32, Option<u8>)>(&["0800CCCCCCCCFFFFFFFF"]);
    test_invalid::<StructU32OptU8>(&["0800CCCCCCCCFFFFFFFF"]);

    // gaps after unknown fields
    test_invalid::<((u32,), (u32, Option<u8>))>(&[
        "0800",
        "08000000",
        "0F000000",
        "0800CCCCCCCC04000000FF",
        "0800DDDDDDDD05000000EEEE",
    ]);
    test_invalid::<StructStU32StU32OptU8>(&[
        "0800",
        "08000000",
        "0F000000",
        "0800CCCCCCCC04000000FF",
        "0800DDDDDDDD05000000EEEE",
    ]);

    // (Skipped) Malformed extensions - we dont support unit structs and unit type (empty tuple)

    // Enum/Variant cannot unpack unknown alternatives; known alternatives must have the correct size
    // test_invalid::<EnumU8>(&["0002000000FFFF", "0101000000FF"]);

    // No trailing empty optionals
    // test_invalid::<(Option<u8>,)>(&[
    //     "040001000000",
    //     "08000100000001000000",
    //     "08000800000001000000FF",
    // ]);
    // test_invalid::<StructOptU8>(&[
    //     "040001000000",
    //     "08000100000001000000",
    //     "08000800000001000000FF",
    // ]);

    // Offset pointer to empty container must use compression
    // test_invalid::<Option<String>>(&["0400000000000000"]);
    // test_invalid::<Option<Vec<u8>>>(&["0400000000000000"]);
    // test_invalid::<(String,)>(&["0400000000000000"]);
    // test_invalid::<(Vec<u8>,)>(&["0400000000000000"]);
    // test_invalid::<StructString>(&["0400000000000000"]);
    // test_invalid::<StructVecU8>(&["0400000000000000"]);
}

fn test_invalid<T>(hex_list: &[&str])
where
    T: Pack + UnpackOwned + std::fmt::Debug,
{
    for &h in hex_list {
        test_invalid_item::<T>(h);
    }
}

fn test_invalid_item<T>(hex: &str)
where
    T: Pack + UnpackOwned + std::fmt::Debug,
{
    println!("data: {}", hex);
    println!("type: {}", std::any::type_name::<T>());

    let data = hex::decode(hex).expect("Invalid hex string");

    // Test unpacking with verification
    {
        let result = T::unpack(&data, &mut 0);
        let _ = result
            .as_ref()
            .inspect(|x| println!("unexpected unpack: '{:?}'", x))
            .inspect_err(|x| println!("unpack error: '{:?}'", x));
        assert!(result.is_err(), "Unpacking should fail for invalid data");
    }

    // Test verification without unpacking
    {
        let result = T::verify(&data, &mut 0);
        assert!(result.is_err(), "Verification should fail for invalid data");
    }

    // // Test schema validation
    // {
    //     let mut builder = SchemaBuilder::new();
    //     builder.insert_named::<T>("T".to_string());
    //     let schema = builder.build().packed();

    //     let result = test_fracpack::bridge::ffi::validate_with_schema(&schema, &data);
    //     assert!(!result, "Schema validation should fail for invalid data");
    // }
}

fn pack_and_compare<T>(src_struct: &T, expected_hex: &str) -> Vec<u8>
where
    T: Pack + UnpackOwned + PartialEq + std::fmt::Debug,
{
    let mut bytes: Vec<u8> = Vec::new();
    src_struct.pack(&mut bytes);
    let encoded_hex = hex::encode(&bytes).to_uppercase();
    assert_eq!(encoded_hex, expected_hex);

    unpack_and_compare(src_struct, &bytes[..]);

    bytes
}

fn unpack_and_compare<T>(src_struct: &T, bytes: &[u8])
where
    T: UnpackOwned,
    T: PartialEq<T>,
    T: std::fmt::Debug,
{
    T::verify(bytes, &mut 0).unwrap();
    let unpacked = T::unpack(bytes, &mut 0).unwrap();
    assert_eq!(*src_struct, unpacked);
}
