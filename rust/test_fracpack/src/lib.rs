pub mod bridge;

use psi_macros::Fracpack;

// TODO: test reading variant with future index
#[derive(Fracpack, PartialEq, Debug)]
pub enum Variant {
    ItemU32(u32),
    ItemStr(String),
    // ItemOptStr(Option<String>),  TODO: broken in C++
}

#[derive(Fracpack, PartialEq, Debug)]
pub struct InnerStruct {
    pub inner_u32: u32,
    pub var: Option<Variant>,
    pub inner_option_u32: Option<u32>,
    pub inner_option_str: Option<String>,
    pub inner_option_vec_u16: Option<Vec<u16>>,
    pub inner_o_vec_o_u16: Option<Vec<Option<u16>>>,
}

#[derive(Fracpack, PartialEq, Debug)]
pub struct TestType {
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
    pub field_option_inner: Option<InnerStruct>,
}
