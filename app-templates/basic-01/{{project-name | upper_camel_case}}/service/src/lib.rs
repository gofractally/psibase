#[psibase::service(name = "{{project-name}}")]
pub mod service {
    use async_graphql::SimpleObject;
    use psibase::*;
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

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

    #[table(name = "ExampleThingTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct ExampleThing {
        pub thing: String,
    }

    impl ExampleThing {
        #[primary_key]
        fn pk(&self) -> SingletonKey {
            SingletonKey {}
        }
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

        Wrapper::emit().history().updated(old_thing, thing);
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
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
