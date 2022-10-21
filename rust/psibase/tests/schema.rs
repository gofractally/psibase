#![allow(dead_code)]

use serde::Serialize;
use serde_json::{json, ser::PrettyFormatter, to_value, Serializer, Value};

#[derive(psibase::Reflect)]
struct Alias<T: psibase::reflect::Reflect>(T);

fn pretty<T: Serialize>(val: &T) -> String {
    let buf = Vec::new();
    let formatter = PrettyFormatter::with_indent(b"    ");
    let mut ser = Serializer::with_formatter(buf, formatter);
    val.serialize(&mut ser).unwrap();
    String::from_utf8(ser.into_inner()).unwrap()
}

fn dump<T: psibase::reflect::Reflect>() {
    let sch = psibase::create_schema::<T>();
    println!("===========\n{}", pretty(&sch));
}

fn verify<T: psibase::reflect::Reflect>(expected: Value) {
    let expected = json!({ "userTypes": expected });
    let sch = psibase::create_schema::<T>();
    let val = to_value(&sch).unwrap();
    assert_eq!(
        val,
        expected,
        "Does not match.\nReflected: {}\nExpected: {}",
        pretty(&val),
        pretty(&expected),
    );
}

#[test]
fn builtin_and_tuple() {
    // No user definitions -> empty
    verify::<u8>(json!([]));
    verify::<String>(json!([]));
    verify::<&str>(json!([]));
    verify::<Vec<u8>>(json!([]));
    verify::<(u8,)>(json!([]));
    verify::<(u8, u16)>(json!([]));
    verify::<(u8, u16, String, &str)>(json!([]));

    // Aliasing exposes the types
    fn alias<T: psibase::reflect::Reflect>(name: &str) {
        verify::<Alias<T>>(json!([{
            "alias": {"ty": name},
            "name": "Alias",
        }]));
    }
    alias::<bool>("bool");
    alias::<u8>("u8");
    alias::<u16>("u16");
    alias::<u32>("u32");
    alias::<u64>("u64");
    alias::<i8>("i8");
    alias::<i16>("i16");
    alias::<i32>("i32");
    alias::<i64>("i64");
    alias::<f32>("f32");
    alias::<f64>("f64");
    alias::<String>("string");
    alias::<&str>("string");

    fn tuple<T: psibase::reflect::Reflect>(args: &Value) {
        verify::<Alias<T>>(json!([{
            "alias": {"tuple": args},
            "name": "Alias",
        }]));
    }
    tuple::<(u8,)>(&json!([{"ty":"u8"}]));
    tuple::<(u8, u16)>(&json!([{"ty":"u8"},{"ty":"u16"}]));
    tuple::<(u8, u16, &u32)>(&json!([{"ty":"u8"},{"ty":"u16"},{"ty":"u32"}]));
    tuple::<(u8, u16, &mut u32)>(&json!([{"ty":"u8"},{"ty":"u16"},{"ty":"u32"}]));
    tuple::<(u8, u16, &str)>(&json!([{"ty":"u8"},{"ty":"u16"},{"ty":"string"}]));
    tuple::<(u8, &&mut &u16, &&&mut &mut &String)>(
        &json!([{"ty":"u8"},{"ty":"u16"},{"ty":"string"}]),
    );
    tuple::<(u8, (u16,), u32)>(&json!([{"ty":"u8"},{"tuple":[{"ty":"u16"}]},{"ty":"u32"}]));
    tuple::<(u8, (u16, String), u32)>(
        &json!([{"ty":"u8"},{"tuple":[{"ty":"u16"},{"ty":"string"}]},{"ty":"u32"}]),
    );
    tuple::<(u8, &&mut &mut (&u16, &mut String), u32)>(
        &json!([{"ty":"u8"},{"tuple":[{"ty":"u16"},{"ty":"string"}]},{"ty":"u32"}]),
    );
}

#[derive(psibase::Reflect)]
struct TupleStructEmpty();

#[derive(psibase::Reflect)]
struct UnnamedStructSingleU32(u32);

#[derive(psibase::Reflect)]
#[rustfmt::skip] // Don't remove the extra comma
struct UnnamedStructSingleExtraComma(u64,);

#[derive(psibase::Reflect)]
struct TupleStruct1((u64,));

#[test]
fn test_tuple_structs() {
    verify::<TupleStructEmpty>(json!([
        {
            "alias": {"tuple": []},
            "name": "TupleStructEmpty"
        }
    ]));
    verify::<UnnamedStructSingleU32>(json!([
        {
            "alias": {"ty": "u32"},
            "name": "UnnamedStructSingleU32"
        }
    ]));
    verify::<UnnamedStructSingleExtraComma>(json!([
        {
            "alias": {"ty": "u64"},
            "name": "UnnamedStructSingleExtraComma"
        }
    ]));
    verify::<TupleStruct1>(json!([
        {
            "alias": {"tuple": [{"ty": "u64"}]},
            "name": "TupleStruct1"
        }
    ]));
}
