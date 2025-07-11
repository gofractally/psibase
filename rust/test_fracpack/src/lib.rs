// #![feature(structural_match)]
// #![feature(core_intrinsics)]
// #![feature(core_panic)]
// #![feature(fmt_internals)]
// #![feature(print_internals)]

pub mod bridge;

use psibase_macros::{Pack, ToSchema, Unpack};

// TODO: test reading variant with future index
#[derive(Pack, Unpack, ToSchema, PartialEq, Eq, Debug)]
#[fracpack(fracpack_mod = "fracpack")]
pub enum Variant {
    ItemU32(u32),
    ItemStr(String),
    // ItemOptStr(Option<String>),  TODO: broken in C++
}

#[derive(Pack, Unpack, ToSchema, PartialEq, Debug)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct DefWontChangeInnerStruct {
    pub field_bool: bool,
    pub field_u32: u32,
    pub field_var: Variant,
    pub field_i16: i16,
    pub field_o_var: Option<Variant>,
    pub field_str: String,
    pub field_a_i16_3: [i16; 3],
    pub field_f32: f32,
    pub field_o_v_i8: Option<Vec<i8>>,
    pub field_a_s_2: [String; 2],
    pub field_f64: f64,
    pub field_o_str: Option<String>,
    pub field_v_u16: Vec<u16>,
    pub field_i32: i32,
}

#[derive(PartialEq, Eq, Debug, Default)]
pub struct NotPackable;

#[derive(Pack, Unpack, ToSchema, PartialEq, Eq, Debug)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct InnerStruct {
    pub inner_u32: u32,
    pub var: Option<Variant>,
    pub inner_option_u32: Option<u32>,
    pub inner_option_str: Option<String>,
    pub inner_option_vec_u16: Option<Vec<u16>>,
    pub inner_o_vec_o_u16: Option<Vec<Option<u16>>>,
}

#[derive(Pack, Unpack, ToSchema, PartialEq, Debug)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct OuterStruct {
    pub field_u8: u8,
    pub field_u16: u16,
    pub field_u32: u32,
    pub field_u64: u64,
    pub field_i8: i8,
    pub field_i16: i16,
    pub field_i32: i32,
    pub field_i64: i64,
    pub field_str: String,
    pub field_f32: f32,
    pub field_f64: f64,
    pub field_inner: InnerStruct,
    pub field_u_inner: DefWontChangeInnerStruct,
    pub field_v_inner: Vec<InnerStruct>,
    pub field_option_u8: Option<u8>,
    pub field_option_u16: Option<u16>,
    pub field_option_u32: Option<u32>,
    pub field_option_u64: Option<u64>,
    pub field_option_i8: Option<i8>,
    pub field_option_i16: Option<i16>,
    pub field_option_i32: Option<i32>,
    pub field_option_i64: Option<i64>,
    pub field_option_str: Option<String>,
    pub field_option_f32: Option<f32>,
    pub field_option_f64: Option<f64>,
    pub field_option_sws: Option<SimpleWithString>,
    pub field_option_sns: Option<SimpleWithNoString>,
    pub field_option_inner: Option<InnerStruct>,
    pub field_option_u_inner: Option<DefWontChangeInnerStruct>,
    pub field_o_o_i8: Option<Option<i8>>,
    pub field_o_o_str: Option<Option<String>>,
    pub field_o_o_str2: Option<Option<String>>,
    pub field_o_o_inner: Option<Option<InnerStruct>>,
    #[fracpack(skip)]
    pub skipped: NotPackable,
}

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct SimpleWithNoString {
    pub a: u32,
    pub b: u64,
    pub c: u16,
    pub f: f32,
}

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct SimpleWithString {
    pub a: u32,
    pub b: u64,
    pub c: u16,
    pub s: String,
    pub f: f32,
}

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ParentStruct {
    pub oa: u32,
    pub ob: u64,
    pub oc: u16,
    pub ar: [i16; 3],
    pub is: SimpleWithString,
    pub vu32: Vec<u32>,
    pub ar_s: [String; 3],
    pub z: bool,
    pub s: String,
}

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct OuterSimpleArray {
    pub oa: u32,
    pub ob: u64,
    pub oc: u16,
    pub arrs: [String; 3],
    pub s: String,
    pub sti163: ThreeElementsFixedStruct,
    pub ari163: [i16; 3],
    pub z: bool,
}

// TODO: check arrays, tuples, bool, char,

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct UnextensibleWithOptions {
    pub a: u32,
    pub opt_a: Option<u32>,
    pub b: u64,
    pub opt_b: Option<u64>,
    pub c: u16,
    pub opt_c: Option<u16>,
    pub s: String,
    pub opt_s: Option<String>,
    pub f: f32,
    pub opt_f: Option<f32>,
}

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct ThreeElementsFixedStruct {
    pub element_1: i16,
    pub element_2: i16,
    pub element_3: i16,
}

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct MultipleTrailingOptions {
    pub a: u32,
    pub b: u64,
    pub s: String,
    pub opt_x: Option<u32>,
    pub opt_y: Option<String>,
    pub opt_z: Option<u64>,
}

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct UnextensibleMultipleTrailingOptions {
    pub a: u32,
    pub b: u64,
    pub s: String,
    pub opt_x: Option<u32>,
    pub opt_y: Option<String>,
    pub opt_z: Option<u64>,
}

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct OptionInTheMiddle {
    pub a: u32,
    pub opt_b: Option<String>,
    pub c: u32,
}

type MyOpt<T> = Option<T>;

#[derive(Pack, Unpack, ToSchema, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct TrailingWithAliasedOptionType {
    pub a: u32,
    pub b: u64,
    pub s: String,
    pub opt_x: MyOpt<u32>,
    pub opt_y: MyOpt<String>,
    pub opt_z: MyOpt<u64>,
}
