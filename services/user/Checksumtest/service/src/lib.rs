#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Checksum256, Fracpack, ToSchema};
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
        pub who: AccountNumber,
        pub checksum: Checksum256,
    }

    impl ExampleThing {
        #[primary_key]
        fn pk(&self) {}
        #[secondary_key(1)]
        fn by_checksum(&self) -> &Checksum256 {
            &self.checksum
        }
        #[secondary_key(2)]
        fn by_checksum_account(&self) -> &(Checksum256, AccountNumber) {
            &(self.checksum, self.who)
        }
    }
}

#[psibase::service(name = "checksumtest", tables = "tables")]
pub mod service {
    use crate::tables::{ExampleThing, ExampleThingTable, InitRow, InitTable};
    use psibase::*;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        // Initial service configuration
        let thing_table = ExampleThingTable::new();
        if thing_table.get_index_pk().get(&()).is_none() {
            thing_table
                .put(&ExampleThing {
                    thing: String::from("default thing"),
                    who: AccountNumber::from(0),
                    checksum: Checksum256::from([0; 32]),
                })
                .unwrap();
        }
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn setExampleThing(thing: String) {
        let table = ExampleThingTable::new();
        let old_thing = table.get_index_pk().get(&()).unwrap_or_default().thing;

        table
            .put(&ExampleThing {
                thing: thing.clone(),
                who: AccountNumber::from(0),
                checksum: Checksum256::from([0; 32]),
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
