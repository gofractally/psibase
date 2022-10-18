use fracpack::Fracpack;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_snake_case)]
pub struct Schema {
    pub userTypes: Vec<Definition>,
}

#[derive(Debug, Clone, Default, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_snake_case)]
pub struct Definition {
    pub name: String,
    pub alias: Option<TypeRef>,
    pub structFields: Option<Vec<Field>>,
    pub unionFields: Option<Vec<Field>>,
    pub customJson: bool,
    pub definitionWillNotChange: bool,
    pub methods: Option<Vec<Method>>,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_camel_case_types)]
pub enum TypeRef {
    builtinType(String),
    userType(String),
    vector(Box<TypeRef>),
    optional(Box<TypeRef>),
    tuple(Vec<TypeRef>),
    array(Box<TypeRef>, u32),
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_snake_case)]
pub struct Field {
    name: String,
    ty: TypeRef,
}

#[derive(Debug, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[allow(non_snake_case)]
pub struct Method {
    name: String,
    returns: TypeRef,
    args: Vec<Field>,
}
