#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "ExampleThingTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct ExampleThing {
        pub thing: String,
    }

    impl ExampleThing {
        #[primary_key]
        fn pk(&self) {}
    }
}

#[psibase::service(name = "symbol", tables = "tables")]
pub mod service {
    use crate::tables::{ExampleThing, ExampleThingTable, InitRow, InitTable};
    use psibase::*;

    pub type SID = psibase::AccountNumber;

    #[action]
    fn init() {
        let table = InitTable::new();

        if table.get_index_pk().get(&()).is_none() {}
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check_some(table.get_index_pk().get(&()), "service not inited");
    }

    #[action]
    #[allow(non_snake_case)]
    fn setExampleThing(thing: String) {
        let table = ExampleThingTable::new();
        let old_thing = table.get_index_pk().get(&()).unwrap_or_default().thing;

        table
            .put(&ExampleThing {
                thing: thing.clone(),
            })
            .unwrap();

        Wrapper::emit().history().updated(old_thing, thing);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getExampleThing() -> String {
        let table = ExampleThingTable::new();
        table.get_index_pk().get(&()).unwrap_or_default().thing
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
