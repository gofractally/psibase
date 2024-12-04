#[psibase::service(name = "{{project-name}}")]
mod service {
    use async_graphql::{Object, SimpleObject};
    use psibase::{
        anyhow, serve_graphql, Fracpack, HttpReply, HttpRequest, SingletonKey,
        Table, ToSchema,
    };
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
    }

    #[pre_action(exclude(init, init2, check_inited))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[table(name = "ExampleThingTable")]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct ExampleThing {
        pub thing: String,
    }

    impl ExampleThing {
        #[primary_key]
        fn by_key(&self) -> SingletonKey {
            SingletonKey {}
        }
    }

    impl Default for ExampleThing {
        fn default() -> Self {
            ExampleThing {
                thing: String::from("default thing"),
            }
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn setExampleThing(thing: String) {
        ExampleThingTable::new()
            .put(&ExampleThing { thing: thing.clone() })
            .unwrap();

        Wrapper::emit().history().exampleThingChanged(thing);
    }

    #[event(history)]
    pub fn exampleThingChanged(thing: String) {}

    struct Query;

    #[Object]
    impl Query {
        async fn example_thing(&self) -> String {
            let curr_val = ExampleThingTable::new().get_index_pk().get(&SingletonKey {});
            curr_val.unwrap_or_default().thing
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
    }
}
