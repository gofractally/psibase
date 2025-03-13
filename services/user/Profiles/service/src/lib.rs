#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::AccountNumber;
    use psibase::{Fracpack, SingletonKey, ToSchema};
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

    #[table(name = "ProfileTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Profile {
        #[primary_key]
        pub account: AccountNumber,

        pub displayName: String,
    }

    impl ExampleThing {
        #[primary_key]
        fn pk(&self) -> SingletonKey {
            SingletonKey {}
        }
    }
}

#[psibase::service(name = "profiles")]
pub mod service {
    use crate::tables::{
        ExampleThing, ExampleThingTable, InitRow, InitTable, Profile, ProfileTable,
    };
    use psibase::*;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        // Configures this service within the event service
        services::events::Wrapper::call().setSchema(create_schema::<Wrapper>());

        // Initial service configuration
        let thing_table = ExampleThingTable::new();
        if thing_table.get_index_pk().get(&SingletonKey {}).is_none() {
            thing_table
                .put(&ExampleThing {
                    thing: String::from("default thing"),
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
        let old_thing = table
            .get_index_pk()
            .get(&SingletonKey {})
            .unwrap_or_default()
            .thing;

        table
            .put(&ExampleThing {
                thing: thing.clone(),
            })
            .unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn setProfile(displayName: String) {
        let caller = get_sender();

        let table = ProfileTable::new();
        table
            .put(&Profile {
                account: caller,
                displayName: displayName.clone(),
            })
            .unwrap();

        Wrapper::emit()
            .history()
            .profileSet(caller, get_sender().to_string() + &displayName.clone());
    }

    #[action]
    #[allow(non_snake_case)]
    fn getProfile(account: AccountNumber) -> Option<Profile> {
        let table = ProfileTable::new();
        table.get_index_pk().get(&account)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getExampleThing() -> String {
        let table = ExampleThingTable::new();
        table
            .get_index_pk()
            .get(&SingletonKey {})
            .unwrap_or_default()
            .thing
    }

    #[event(history)]
    pub fn profileSet(account: AccountNumber, displayName: String) {}
}

#[cfg(test)]
mod tests;
