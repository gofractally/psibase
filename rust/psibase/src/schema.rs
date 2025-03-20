use crate::{AccountNumber, DbId};
use fracpack::{AnyType, FunctionType, Pack, SchemaBuilder, ToSchema, Unpack, VisitTypes};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

type EventMap = IndexMap<String, AnyType>;

type ActionMap = IndexMap<String, FunctionType>;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct FieldId {
    pub path: Vec<u32>,
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
        self.type_.visit_types(f)
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
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<String, FunctionType>;
}

pub trait ToEventsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<String, AnyType>;
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

pub fn create_schema<T: ToServiceSchema>() -> Schema {
    T::schema()
}
