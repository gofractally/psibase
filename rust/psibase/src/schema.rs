use crate::{AccountNumber, MethodNumber};
use fracpack::{AnyType, SchemaBuilder};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

type EventMap = IndexMap<MethodNumber, AnyType>;

#[derive(Debug, Serialize, Deserialize)]
pub struct Schema {
    pub service: AccountNumber,
    pub types: fracpack::Schema,
    pub ui: EventMap,
    pub history: EventMap,
    pub merkle: EventMap,
}

pub trait ToEventsSchema {
    fn to_schema(builder: &mut SchemaBuilder) -> IndexMap<MethodNumber, AnyType>;
}

pub trait ToServiceSchema {
    type UiEvents: ToEventsSchema;
    type HistoryEvents: ToEventsSchema;
    type MerkleEvents: ToEventsSchema;
    const SERVICE: AccountNumber;
    fn schema() -> Schema {
        let mut builder = SchemaBuilder::new();
        let mut ui = Self::UiEvents::to_schema(&mut builder);
        let mut history = Self::HistoryEvents::to_schema(&mut builder);
        let mut merkle = Self::MerkleEvents::to_schema(&mut builder);
        let types = builder.build_ext(&mut [&mut ui, &mut history, &mut merkle][..]);
        Schema {
            service: Self::SERVICE,
            types,
            ui,
            history,
            merkle,
        }
    }
}

pub fn create_schema<T: ToServiceSchema>() -> Schema {
    T::schema()
}
