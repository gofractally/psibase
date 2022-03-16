fn main() {}

use fracpack::*;
use psi_macros::*;

#[derive(Fracpack, PartialEq, Clone, Debug)]
pub enum Variant {
    ItemU32(u32),
    ItemStr(String),
    // ItemOptStr(Option<String>),  TODO: broken in C++
}
