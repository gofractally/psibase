#[psibase::service(name = "minservice")]
mod service {
    use async_graphql::{Object, SimpleObject};
    // fix psibase::service macro to use this (for decode in events)
    // fix 2: I've gotta explicitly use Table, even though *all* uses of Table expand in this macro and require the Table trait to be imported
    use psibase::{Fracpack, SingletonKey, Table, ToSchema, WebContentRow};
    use serde::{Deserialize, Serialize};

    #[table(name = "ChainNameTable")]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize)]
    pub struct ChainName {
        pub name: String,
    }

    impl ChainName {
        #[primary_key]
        fn by_key(&self) -> SingletonKey {
            SingletonKey {}
        }
    }

    #[table(record = "WebContentRow", index = 1)]
    struct WebContentTable;

    #[action]
    fn set_chain_name(name: String) {
        println!("Do some stuff");

        Wrapper::emit().history().set_chain_name(name);
    }

    #[event(history)]
    pub fn set_chain_name(name: String) {}

    struct Query;

    #[Object]
    impl Query {
        async fn chain_name(&self) -> async_graphql::Result<String, async_graphql::Error> {
            // let n = ChainNameTable::new()
            //     .get_index_pk()
            //     .get(&SingletonKey {})
            //     .unwrap()
            //     .name;
            // println!("Returning name: {}", n);
            Ok(String::from("psibasename"))
        }
    }
}
