use crate::{AccountNumber, MethodNumber};
use fracpack::{AnyType, FunctionType, Pack, SchemaBuilder, ToSchema, Unpack};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

type EventMap = IndexMap<MethodNumber, AnyType>;

type ActionMap = IndexMap<MethodNumber, FunctionType>;

#[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Schema {
    pub service: AccountNumber,
    pub types: fracpack::Schema,
    pub actions: ActionMap,
    pub ui: EventMap,
    pub history: EventMap,
    pub merkle: EventMap,
}

impl ToSchema for Schema {
    fn schema(_builder: &mut SchemaBuilder) -> AnyType {
        todo!()
    }
}

pub trait ToActionsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<MethodNumber, FunctionType>;
}

pub trait ToEventsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<MethodNumber, AnyType>;
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
        }
    }
}

pub fn create_schema<T: ToServiceSchema>() -> Schema {
    T::schema()
}
