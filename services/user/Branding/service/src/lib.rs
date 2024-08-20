#[psibase::service(name = "branding")]
mod service {
    use async_graphql::SimpleObject;
    // fix psibase::service macro to use this (for decode in events)
    use psibase::{anyhow, Fracpack, SingletonKey, ToSchema, WebContentRow};
    use serde::{Deserialize, Serialize};

    #[table(name = "ChainNameTable", index = 0)]
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
        // chain_name_table.g

        Wrapper::emit().history().set_chain_name(name);
    }

    #[action]
    fn set_logo(img: Vec<u8>) {
        // store logo to accessible url
        let url = String::from("/chain_logo");

        Wrapper::emit().history().set_logo(url);
    }

    #[event(history)]
    pub fn set_chain_name(name: String) {}

    #[event(history)]
    pub fn set_logo(url: String) {}

    // #[action]
    // #[allow(non_snake_case)]
    // fn serveSys(request: HttpRequest) -> Option<HttpReply> {
    //     None.or_else(|| serve_content(&request, &WebContentTable::new()))
    //         .or_else(|| serve_graphql(&request, Query))
    //         .or_else(|| serve_graphiql(&request))
    //         .or_else(|| serve_simple_ui::<Wrapper>(&request))
    // }

    // #[action]
    // #[allow(non_snake_case)]
    // fn storeSys(path: String, contentType: String, content: HexBytes) {
    //     check(get_sender() == get_service(), "unauthorized");
    //     let table = WebContentTable::new();
    //     store_content(path, contentType, content, &table).unwrap();
    // }
}
