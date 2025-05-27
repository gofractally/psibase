use crate::{AccountNumber, DbId, MethodNumber};
use fracpack::{
    AnyType, CompiledSchema, CompiledType, CustomHandler, CustomTypes, FunctionType, Pack,
    SchemaBuilder, ToSchema, Unpack, VisitTypes,
};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::hash::Hash;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct MethodString(pub String);

impl PartialEq for MethodString {
    fn eq(&self, other: &Self) -> bool {
        self.0
            .parse::<MethodNumber>()
            .unwrap()
            .eq(&other.0.parse::<MethodNumber>().unwrap())
    }
}

impl Eq for MethodString {}

impl Hash for MethodString {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.parse::<MethodNumber>().unwrap().hash(state)
    }
}

type EventMap = IndexMap<MethodString, AnyType>;

type ActionMap = IndexMap<MethodString, FunctionType>;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct FieldId {
    pub path: Vec<u32>,
    pub transform: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<AnyType>,
}

impl VisitTypes for FieldId {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        self.type_.visit_types(f);
    }
}

pub type IndexInfo = Vec<FieldId>;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct TableInfo {
    pub name: Option<String>,
    pub table: u16,
    #[serde(rename = "type")]
    pub type_: AnyType,
    pub indexes: Vec<IndexInfo>,
}

impl VisitTypes for TableInfo {
    fn visit_types<F: FnMut(&mut AnyType) -> ()>(&mut self, f: &mut F) {
        self.type_.visit_types(f);
        self.indexes.visit_types(f);
    }
}

pub fn db_name(db: DbId) -> String {
    match db {
        DbId::Service => "service".to_string(),
        DbId::Subjective => "subjective".to_string(),
        DbId::WriteOnly => "writeOnly".to_string(),
        _ => panic!("Unsupported db"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Schema {
    pub service: AccountNumber,
    pub types: fracpack::Schema,
    pub actions: ActionMap,
    pub ui: EventMap,
    pub history: EventMap,
    pub merkle: EventMap,
    pub database: Option<IndexMap<String, Vec<TableInfo>>>,
}

impl ToSchema for Schema {
    fn schema(_builder: &mut SchemaBuilder) -> AnyType {
        todo!()
    }
}

pub trait ToActionsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<MethodString, FunctionType>;
}

pub trait ToEventsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<MethodString, AnyType>;
}

pub trait ToIndexSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> Vec<IndexInfo>;
}

pub trait ToDatabaseSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> Option<IndexMap<String, Vec<TableInfo>>>;
}

pub struct EmptyDatabase;

impl ToDatabaseSchema for EmptyDatabase {
    fn to_schema(_builder: &mut SchemaBuilder) -> Option<IndexMap<String, Vec<TableInfo>>> {
        Some(IndexMap::new())
    }
}

pub trait ToServiceSchema {
    type UiEvents: ToEventsSchema;
    type HistoryEvents: ToEventsSchema;
    type MerkleEvents: ToEventsSchema;
    type Actions: ToActionsSchema;
    type Database: ToDatabaseSchema;
    const SERVICE: AccountNumber;
    fn schema() -> Schema {
        let mut builder = SchemaBuilder::new();
        let mut actions = Self::Actions::to_schema(&mut builder);
        let mut ui = Self::UiEvents::to_schema(&mut builder);
        let mut history = Self::HistoryEvents::to_schema(&mut builder);
        let mut merkle = Self::MerkleEvents::to_schema(&mut builder);
        let mut database = Self::Database::to_schema(&mut builder);
        let types = builder.build_ext(&mut (
            &mut actions,
            &mut ui,
            &mut history,
            &mut merkle,
            &mut database,
        ));
        Schema {
            service: Self::SERVICE,
            types,
            actions,
            ui,
            history,
            merkle,
            database,
        }
    }
    fn actions_schema() -> Schema {
        let mut builder = SchemaBuilder::new();
        let mut actions = Self::Actions::to_schema(&mut builder);
        let types = builder.build_ext(&mut [&mut actions][..]);
        Schema {
            service: Self::SERVICE,
            types,
            actions,
            ui: Default::default(),
            history: Default::default(),
            merkle: Default::default(),
            database: Default::default(),
        }
    }
}

struct CustomAccountNumber;

impl CustomHandler for CustomAccountNumber {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        matches!(
            schema.unwrap_struct(ty),
            CompiledType::Int {
                bits: 64,
                is_signed: false
            }
        )
    }
    fn frac2json(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        src: &[u8],
        pos: &mut u32,
    ) -> Result<serde_json::Value, fracpack::Error> {
        Ok(AccountNumber::new(u64::unpack(src, pos)?)
            .to_string()
            .into())
    }
    fn json2frac(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        Ok(AccountNumber::deserialize(val)?.pack(dest))
    }
    fn is_empty_container(&self, _ty: &CompiledType, _value: &serde_json::Value) -> bool {
        false
    }
}

struct CustomMethodNumber;

impl CustomHandler for CustomMethodNumber {
    fn matches(&self, schema: &CompiledSchema, ty: &CompiledType) -> bool {
        matches!(
            schema.unwrap_struct(ty),
            CompiledType::Int {
                bits: 64,
                is_signed: false
            }
        )
    }
    fn frac2json(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        src: &[u8],
        pos: &mut u32,
    ) -> Result<serde_json::Value, fracpack::Error> {
        Ok(MethodNumber::new(u64::unpack(src, pos)?).to_string().into())
    }
    fn json2frac(
        &self,
        _schema: &CompiledSchema,
        _ty: &CompiledType,
        val: &serde_json::Value,
        dest: &mut Vec<u8>,
    ) -> Result<(), serde_json::Error> {
        Ok(MethodNumber::deserialize(val)?.pack(dest))
    }
    fn is_empty_container(&self, _ty: &CompiledType, _value: &serde_json::Value) -> bool {
        false
    }
}

pub fn schema_types() -> CustomTypes<'static> {
    let mut result = fracpack::standard_types();
    static ACCOUNT_NUMBER: CustomAccountNumber = CustomAccountNumber;
    static METHOD_NUMBER: CustomMethodNumber = CustomMethodNumber;
    result.insert("AccountNumber".to_string(), &ACCOUNT_NUMBER);
    result.insert("MethodNumber".to_string(), &METHOD_NUMBER);
    result
}

pub fn create_schema<T: ToServiceSchema>() -> Schema {
    T::schema()
}

pub fn print_schema_impl<T: ToServiceSchema>() {
    println!(
        "psibase-schema-gen-output: {}",
        serde_json::to_string(&T::schema()).unwrap()
    )
}
