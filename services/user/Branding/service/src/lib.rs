#[psibase::service(name = "branding")]
mod service {
    use async_graphql::{Object, SimpleObject};
    use psibase::{
        anyhow, check, get_sender, get_service, serve_content, serve_graphiql, serve_graphql,
        serve_simple_ui, store_content, Fracpack, HexBytes, HttpReply, HttpRequest, SingletonKey,
        Table, ToSchema, WebContentRow,
    };
    use serde::{Deserialize, Serialize};

    #[table(name = "NetworkNameTable")]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct NetworkName {
        pub name: String,
    }

    impl NetworkName {
        #[primary_key]
        fn by_key(&self) -> SingletonKey {
            SingletonKey {}
        }
    }

    impl Default for NetworkName {
        fn default() -> Self {
            NetworkName {
                name: String::from("psibase"),
            }
        }
    }

    #[table(record = "WebContentRow", index = 1)]
    struct WebContentTable;

    #[action]
    fn set_network_name(name: String) {
        NetworkNameTable::new()
            .put(&NetworkName { name: name.clone() })
            .unwrap();

        Wrapper::emit().history().set_network_name(name);
    }

    #[event(history)]
    pub fn set_network_name(name: String) {}

    struct Query;

    #[Object]
    impl Query {
        async fn network_name(&self) -> async_graphql::Result<String, async_graphql::Error> {
            let curr_val = NetworkNameTable::new().get_index_pk().get(&SingletonKey {});
            Ok(match curr_val {
                Some(val) => val.name,
                None => String::from("psibase"),
            })
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
