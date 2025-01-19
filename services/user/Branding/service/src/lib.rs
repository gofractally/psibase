#[psibase::service_tables]
mod tables {
    use async_graphql::SimpleObject;
    use psibase::{Fracpack, SingletonKey, ToSchema};
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
}

#[psibase::service(name = "branding")]
mod service {
    use async_graphql::Object;
    use psibase::{check, serve_graphql, HttpReply, HttpRequest, SingletonKey, Table};

    use crate::tables::{NetworkName, NetworkNameTable};

    #[action]
    #[allow(non_snake_case)]
    fn setNetworkName(name: String) {
        check(psibase::get_sender() == Wrapper::SERVICE, "Unauthorized");
        NetworkNameTable::new()
            .put(&NetworkName { name: name.clone() })
            .unwrap();

        Wrapper::emit().history().networkNameChanged(name);
    }

    #[event(history)]
    pub fn networkNameChanged(name: String) {}

    struct Query;

    #[Object]
    impl Query {
        async fn network_name(&self) -> String {
            let curr_val = NetworkNameTable::new().get_index_pk().get(&SingletonKey {});
            curr_val.unwrap_or_default().name
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
    }
}
