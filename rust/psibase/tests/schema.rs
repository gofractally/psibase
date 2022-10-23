#![allow(dead_code)]

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

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
fn builtin() {
    // No user definitions -> empty
    verify::<u8>(json!([]));
    verify::<String>(json!([]));
    verify::<&str>(json!([]));
    verify::<Vec<u8>>(json!([]));

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

    alias::<Box<&mut Rc<Arc<&Cell<RefCell<f32>>>>>>("f32");

    verify::<Alias<Vec<u8>>>(json!([
        {
            "alias": {"vector": {"ty": "u8"}},
            "name": "Alias"
        }
    ]));
    verify::<&mut Alias<Box<Vec<Cell<u8>>>>>(json!([
        {
            "alias": {"vector": {"ty": "u8"}},
            "name": "Alias"
        }
    ]));
    verify::<Alias<Option<String>>>(json!([
        {
            "alias": {"option": {"ty": "string"}},
            "name": "Alias"
        }
    ]));
    verify::<Alias<[i16; 7]>>(json!([
        {
            "alias": {"array": [{"ty": "i16"}, 7]},
            "name": "Alias"
        }
    ]));
}

#[test]
fn tuple() {
    // No user definitions -> empty
    verify::<(u8,)>(json!([]));
    verify::<(u8, u16)>(json!([]));
    verify::<(u8, u16, String, &str)>(json!([]));

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
struct UnnamedStructSingleT<T: psibase::reflect::Reflect>(T);

#[derive(psibase::Reflect)]
struct UnnamedStructInnerTupleRef<'a, 'b>((&'a str, &'b i32));

#[derive(psibase::Reflect)]
struct UnnamedStructSingleRefT<'a, T: psibase::reflect::Reflect + 'a>(&'a T);

#[derive(psibase::Reflect)]
#[rustfmt::skip] // Don't remove the extra comma
struct UnnamedStructSingleExtraComma(u64,);

#[derive(psibase::Reflect)]
struct TupleStruct1((u64,));

#[derive(psibase::Reflect)]
struct TupleStruct2(Option<u8>, String);

#[derive(psibase::Reflect)]
struct TupleStruct5(u8, u16, u32, i8, i16);

#[derive(psibase::Reflect)]
struct TupleStruct3T<
    T1: psibase::reflect::Reflect,
    T2: psibase::reflect::Reflect,
    T3: psibase::reflect::Reflect,
>(T1, T2, T3);

#[derive(psibase::Reflect)]
struct TupleStruct2Ref<'a, 'b>(&'a u32, &'b Alias<u16>);

#[derive(psibase::Reflect)]
struct TupleStructRecurse(Option<Box<TupleStructRecurse>>, Vec<TupleStructRecurse>);

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
    verify::<UnnamedStructSingleT<String>>(json!([
        {
            "alias": {"ty": "string"},
            "name": "UnnamedStructSingleT"
        }
    ]));
    verify::<UnnamedStructSingleT<&str>>(json!([
        {
            "alias": {"ty": "string"},
            "name": "UnnamedStructSingleT"
        }
    ]));
    verify::<UnnamedStructSingleT<&&&mut &&u8>>(json!([
        {
            "alias": {"ty": "u8"},
            "name": "UnnamedStructSingleT"
        }
    ]));
    verify::<UnnamedStructInnerTupleRef>(json!([
        {
            "alias": {"tuple": [{"ty": "string"}, {"ty": "i32"}]},
            "name": "UnnamedStructInnerTupleRef"
        }
    ]));
    verify::<UnnamedStructSingleRefT<String>>(json!([
        {
            "alias": {"ty": "string"},
            "name": "UnnamedStructSingleRefT"
        }
    ]));
    verify::<UnnamedStructSingleRefT<i8>>(json!([
        {
            "alias": {"ty": "i8"},
            "name": "UnnamedStructSingleRefT"
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
    verify::<TupleStruct2>(json!([
        {
            "alias": {"tuple": [{"option": {"ty": "u8"}}, {"ty": "string"}]},
            "name": "TupleStruct2"
        }
    ]));
    verify::<TupleStruct5>(json!([
        {
            "alias": {"tuple": [{"ty": "u8"}, {"ty": "u16"}, {"ty": "u32"}, {"ty": "i8"}, {"ty": "i16"}]},
            "name": "TupleStruct5"
        }
    ]));
    verify::<TupleStruct3T<String, Option<String>, (String,)>>(json!([
        {
            "alias": {"tuple": [{"ty": "string"}, {"option": {"ty": "string"}}, {"tuple": [{"ty": "string"}]}]},
            "name": "TupleStruct3T"
        }
    ]));
    verify::<TupleStruct2Ref>(json!([
        {
            "alias": {"ty": "u16"},
            "name": "Alias"
        },
        {
            "alias": {"tuple": [{"ty": "u32"}, {"user": "Alias"}]},
            "name": "TupleStruct2Ref"
        }
    ]));
    verify::<TupleStructRecurse>(json!([
        {
            "alias": {"tuple": [{"option": {"user": "TupleStructRecurse"}}, {"vector": {"user": "TupleStructRecurse"}}]},
            "name": "TupleStructRecurse"
        }
    ]));
}

#[derive(psibase::Reflect)]
struct Struct0 {}

#[derive(psibase::Reflect)]
struct Struct1 {
    a: u32,
}

#[derive(psibase::Reflect)]
struct Struct2 {
    a: u32,
    b: String,
}

#[derive(psibase::Reflect)]
struct Struct3 {
    a: u32,
    b: String,
    c: Alias<f64>,
}

#[derive(psibase::Reflect)]
struct Struct2Ref<'a> {
    a: &'a u32,
    b: &'a String,
}

#[derive(psibase::Reflect)]
struct StructT1T2<T1: psibase::reflect::Reflect, T2: psibase::reflect::Reflect> {
    a: T1,
    b: T2,
}

#[derive(psibase::Reflect)]
struct StructRecurse {
    a: Option<Box<StructRecurse>>,
    b: Vec<StructRecurse>,
}

#[derive(psibase::Reflect)]
#[reflect(custom_json)]
struct StructCustomJson {
    a: u32,
}

#[derive(psibase::Reflect)]
#[fracpack(definition_will_not_change)]
struct StructWNC {
    a: u32,
}

#[derive(psibase::Reflect)]
#[fracpack(definition_will_not_change)]
#[reflect(custom_json)]
struct StructBothFlags {
    a: u32,
}

#[test]
fn test_structs() {
    verify::<Struct0>(json!([
        {
            "name": "Struct0",
            "structFields": [],
        }
    ]));
    verify::<Struct1>(json!([
        {
            "name": "Struct1",
            "structFields": [{"name": "a", "ty": {"ty": "u32"}}],
        }
    ]));
    verify::<Struct2>(json!([
        {
            "name": "Struct2",
            "structFields": [
                {"name": "a", "ty": {"ty": "u32"}},
                {"name": "b", "ty": {"ty": "string"}},
            ],
        }
    ]));
    verify::<Struct3>(json!([
        {
            "name": "Alias",
            "alias": {"ty": "f64"},
        },
        {
            "name": "Struct3",
            "structFields": [
                {"name": "a", "ty": {"ty": "u32"}},
                {"name": "b", "ty": {"ty": "string"}},
                {"name": "c", "ty": {"user": "Alias"}},
            ],
        }
    ]));
    verify::<Struct2Ref>(json!([
        {
            "name": "Struct2Ref",
            "structFields": [
                {"name": "a", "ty": {"ty": "u32"}},
                {"name": "b", "ty": {"ty": "string"}},
            ],
        }
    ]));
    verify::<StructT1T2<i8, i16>>(json!([
        {
            "name": "StructT1T2",
            "structFields": [
                {"name": "a", "ty": {"ty": "i8"}},
                {"name": "b", "ty": {"ty": "i16"}},
            ],
        }
    ]));
    verify::<StructT1T2<&f32, &Alias<&String>>>(json!([
        {
            "name": "Alias",
            "alias": {"ty": "string"},
        },
        {
            "name": "StructT1T2",
            "structFields": [
                {"name": "a", "ty": {"ty": "f32"}},
                {"name": "b", "ty": {"user": "Alias"}},
            ],
        }
    ]));
    verify::<StructRecurse>(json!([
        {
            "name": "StructRecurse",
            "structFields": [
                {"name": "a", "ty": {"option": {"user": "StructRecurse"}}},
                {"name": "b", "ty": {"vector": {"user": "StructRecurse"}}},
            ],
        }
    ]));
    verify::<StructCustomJson>(json!([
        {
            "name": "StructCustomJson",
            "customJson": true,
            "structFields": [{"name": "a", "ty": {"ty": "u32"}}],
        }
    ]));
    verify::<StructWNC>(json!([
        {
            "name": "StructWNC",
            "definitionWillNotChange": true,
            "structFields": [{"name": "a", "ty": {"ty": "u32"}}],
        }
    ]));
    verify::<StructBothFlags>(json!([
        {
            "name": "StructBothFlags",
            "customJson": true,
            "definitionWillNotChange": true,
            "structFields": [{"name": "a", "ty": {"ty": "u32"}}],
        }
    ]));
}

#[derive(psibase::Reflect)]
struct DupNameStruct<
    T1: psibase::reflect::Reflect,
    T2: psibase::reflect::Reflect,
    T3: psibase::reflect::Reflect,
> {
    a: T1,
    b: Option<Box<DupNameStruct<T2, T3, T1>>>,
    c: Option<Box<DupNameStruct<T3, T1, T2>>>,
}

#[test]
fn test_dup_names() {
    verify::<DupNameStruct<u8, u16, u32>>(json!([
        {
            "name": "DupNameStruct1",
            "structFields": [{
                "name": "a",
                "ty": {"ty": "u32"},
            }, {
                "name": "b",
                "ty": {"option": {"user": "DupNameStruct"}},
            }, {
                "name": "c",
                "ty": {"option": {"user": "DupNameStruct0"}},
            }],
        },
        {
            "name": "DupNameStruct0",
            "structFields": [{
                "name": "a",
                "ty": {"ty": "u16"},
            }, {
                "name": "b",
                "ty": {"option": {"user": "DupNameStruct1"}},
            }, {
                "name": "c",
                "ty": {"option": {"user": "DupNameStruct"}},
            }],
        },
        {
            "name": "DupNameStruct",
            "structFields": [{
                "name": "a",
                "ty": {"ty": "u8"},
            }, {
                "name": "b",
                "ty": {"option": {"user": "DupNameStruct0"}},
            }, {
                "name": "c",
                "ty": {"option": {"user": "DupNameStruct1"}},
            }],
        },
    ]));
}

#[derive(psibase::Reflect)]
enum Enum0 {}

#[derive(psibase::Reflect)]
enum EnumSimple {
    Unnamed0(),
    Unnamed1(u16),
    Unnamed1Tuple((u8,)),
    Unnamed2(u32, String),
    Named0 {},
    Named1 { a: f32 },
    Named2 { a: f32, b: f64 },
}

#[test]
fn test_enums() {
    verify::<Enum0>(json!([
        {
            "name": "Enum0",
            "unionFields": [],
        }
    ]));
    verify::<EnumSimple>(json!([
        {
            "name": "EnumSimple::Named0",
            "structFields": [],
        },
        {
            "name": "EnumSimple::Named1",
            "structFields": [{"name": "a", "ty": {"ty": "f32"}}],
        },
        {
            "name": "EnumSimple::Named2",
            "structFields": [
                {"name": "a", "ty": {"ty": "f32"}},
                {"name": "b", "ty": {"ty": "f64"}},
            ],
        },
        {
            "name": "EnumSimple",
            "unionFields": [{
                "name": "Unnamed0",
                "ty": {"tuple": []},
            }, {
                "name": "Unnamed1",
                "ty": {"ty": "u16"},
            }, {
                "name": "Unnamed1Tuple",
                "ty": {"tuple": [{"ty": "u8"}]},
            }, {
                "name": "Unnamed2",
                "ty": {"tuple": [{"ty": "u32"}, {"ty": "string"}]},
            }, {
                "name": "Named0",
                "ty": {"user": "EnumSimple::Named0"},
            }, {
                "name": "Named1",
                "ty": {"user": "EnumSimple::Named1"},
            }, {
                "name": "Named2",
                "ty": {"user": "EnumSimple::Named2"},
            }],
        }
    ]));
}

#[derive(psibase::Reflect)]
enum EnumRecursive {
    Maybe(Option<Box<EnumRecursive>>),
    Many(Vec<EnumRecursive>),
}

#[derive(psibase::Reflect)]
enum EnumLifetime<'a, 'b> {
    Stuff(&'a u32, &'b str),
}

#[derive(psibase::Reflect)]
enum EnumT1T2<T1: psibase::reflect::Reflect, T2: psibase::reflect::Reflect> {
    Stuff(T1, T2),
}

#[derive(psibase::Reflect)]
enum EnumRefT1<'a, T1: psibase::reflect::Reflect + 'a> {
    Stuff(&'a T1),
}

#[test]
fn test_enum_more() {
    verify::<EnumRecursive>(json!([
        {
            "name": "EnumRecursive",
            "unionFields": [{
                "name": "Maybe",
                "ty": {"option": {"user": "EnumRecursive"}},
            }, {
                "name": "Many",
                "ty": {"vector": {"user": "EnumRecursive"}},
            }],
        }
    ]));
    verify::<EnumLifetime>(json!([
        {
            "name": "EnumLifetime",
            "unionFields": [{
                "name": "Stuff",
                "ty": {"tuple": [{"ty": "u32"}, {"ty": "string"}]},
            }],
        }
    ]));
    verify::<EnumT1T2<f32, f64>>(json!([
        {
            "name": "EnumT1T2",
            "unionFields": [{
                "name": "Stuff",
                "ty": {"tuple": [{"ty": "f32"}, {"ty": "f64"}]},
            }],
        }
    ]));
    verify::<EnumRefT1<u16>>(json!([
        {
            "name": "EnumRefT1",
            "unionFields": [{
                "name": "Stuff",
                "ty": {"ty": "u16"},
            }],
        }
    ]));
}

#[test]
fn test_schema_schema() {
    verify::<psibase::Schema<String>>(json!([
        {
            "name": "TypeRef",
            "unionFields": [
                {
                    "name": "ty",
                    "ty": {"ty": "string"}
                },
                {
                    "name": "user",
                    "ty": {"ty": "string"}
                },
                {
                    "name": "vector",
                    "ty": {"user": "TypeRef"}
                },
                {
                    "name": "option",
                    "ty": {"user": "TypeRef"}
                },
                {
                    "name": "tuple",
                    "ty": {"vector": {"user": "TypeRef"}}
                },
                {
                    "name": "array",
                    "ty": {"tuple": [{"user": "TypeRef"}, {"ty": "u32"}]}
                }
            ]
        },
        {
            "name": "Field",
            "structFields": [
                {
                    "name": "name",
                    "ty": {"ty": "string"}
                },
                {
                    "name": "ty",
                    "ty": {"user": "TypeRef"}
                }
            ]
        },
        {
            "name": "Method",
            "structFields": [
                {
                    "name": "name",
                    "ty": {"ty": "string"}
                },
                {
                    "name": "returns",
                    "ty": {"user": "TypeRef"}
                },
                {
                    "name": "args",
                    "ty": {"vector": {"user": "Field"}}
                }
            ]
        },
        {
            "name": "Definition",
            "structFields": [
                {
                    "name": "name",
                    "ty": {"ty": "string"}
                },
                {
                    "name": "alias",
                    "ty": {"option": {"user": "TypeRef"}}
                },
                {
                    "name": "structFields",
                    "ty": {"option": {"vector": {"user": "Field"}}}
                },
                {
                    "name": "unionFields",
                    "ty": {"option": {"vector": {"user": "Field"}}}
                },
                {
                    "name": "customJson",
                    "ty": {"option": {"ty": "bool"}}
                },
                {
                    "name": "definitionWillNotChange",
                    "ty": {"option": {"ty": "bool"}}
                },
                {
                    "name": "methods",
                    "ty": {"option": {"vector": {"user": "Method"}}}
                }
            ]
        },
        {
            "name": "Schema",
            "structFields": [
                {
                    "name": "userTypes",
                    "ty": {"vector": {"user": "Definition"}}
                }
            ]
        }
    ]));
}
