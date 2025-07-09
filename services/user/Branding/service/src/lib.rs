#[psibase::service_tables]
mod tables {
    use async_graphql::SimpleObject;
    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};
    #[table(name = "NetworkNameTable")]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct NetworkName {
        pub name: String,
    }

    impl NetworkName {
        #[primary_key]
        fn by_key(&self) {}
    }

    impl Default for NetworkName {
        fn default() -> Self {
            NetworkName {
                name: String::from("psibase"),
            }
        }
    }
}

#[psibase::service(name = "branding", tables = "tables")]
mod service {
    use crate::tables::*;
    use async_graphql::Object;
    use psibase::*;

    #[action]
    #[allow(non_snake_case)]
    fn setNetworkName(name: String) {
        check(
            get_sender() == SERVICE,
            "Only the 'branding' account is authorized to set network branding",
        );
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
            let curr_val = NetworkNameTable::new().get_index_pk().get(&());
            curr_val.unwrap_or_default().name
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest, _socket: Option<i32>, user: Option<AccountNumber>) -> Option<HttpReply> {
        // Debug logging
        println!("🔍 Branding serveSys called");
        println!("  Method: {}", request.method);
        println!("  Target: {}", request.target);
        println!("  User: {:?}", user);
        
        // Check if this is a GraphQL request
        if request.target.starts_with("/graphql") && request.method == "POST" {
            println!("🔒 GraphQL request detected");
            // For GraphQL requests, check if user is authenticated
            if user.is_none() {
                println!("❌ No user found - returning 401");
                return Some(HttpReply {
                    status: 401,
                    contentType: "application/json".into(),
                    body: r#"{"error":"Authentication required for GraphQL requests"}"#.as_bytes().to_vec().into(),
                    headers: vec![],
                });
            } else {
                println!("✅ User authenticated: {:?}", user);
            }
        }
        
        None.or_else(|| serve_graphql(&request, Query))
    }
}
