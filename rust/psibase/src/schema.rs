use crate::AccountNumber;
use fracpack::{AnyType, FunctionType, Pack, SchemaBuilder, ToSchema, Unpack};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

type EventMap = IndexMap<String, AnyType>;

type ActionMap = IndexMap<String, FunctionType>;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
struct FieldId {
    path: Vec<u32>,
}

type IndexInfo = Vec<FieldId>;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct TableInfo {
    name: Option<String>,
    table: u16,
    #[serde(rename = "type")]
    type_: AnyType,
    indexes: Vec<IndexInfo>,
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

pub trait ToServiceSchema {
    type UiEvents: ToEventsSchema;
    type HistoryEvents: ToEventsSchema;
    type MerkleEvents: ToEventsSchema;
    type Actions: ToActionsSchema;
    const SERVICE: AccountNumber;
    fn schema() -> Schema {
        let mut builder = SchemaBuilder::new();
        let mut actions = Self::Actions::to_schema(&mut builder);
        let mut ui = Self::UiEvents::to_schema(&mut builder);
        let mut history = Self::HistoryEvents::to_schema(&mut builder);
        let mut merkle = Self::MerkleEvents::to_schema(&mut builder);
        let types = builder.build_ext(&mut (&mut actions, &mut ui, &mut history, &mut merkle));
        Schema {
            service: Self::SERVICE,
            types,
            actions,
            ui,
            history,
            merkle,
            // TODO: fill in database
            database: None,
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
