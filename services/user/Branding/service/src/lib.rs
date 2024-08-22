#[psibase::service(name = "branding")]
mod service {
    use async_graphql::{Object, SimpleObject};
    // fix psibase::service macro to use this (for decode in events)
    // fix 2: I've gotta explicitly use Table, even though *all* uses of Table expand in this macro and require the Table trait to be imported
    use psibase::{
        anyhow, check, get_sender, get_service, serve_content, serve_graphiql, serve_graphql,
        serve_simple_ui, store_content, Fracpack, HexBytes, HttpReply, HttpRequest, SingletonKey,
        Table, ToSchema, WebContentRow,
    };
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
        // save name to singleton
        let chain_name_table = ChainNameTable::new();
        chain_name_table
            .put(&ChainName { name: name.clone() })
            .unwrap();

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

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| serve_simple_ui::<Wrapper>(&request))
    }

    #[action]
    #[allow(non_snake_case)]
    fn storeSys(path: String, contentType: String, content: HexBytes) {
        check(get_sender() == get_service(), "unauthorized");
        let table = WebContentTable::new();
        store_content(path, contentType, content, &table).unwrap();
    }
}
