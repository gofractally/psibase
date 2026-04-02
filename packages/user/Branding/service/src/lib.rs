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
    use psibase::services::auth_delegate::Wrapper as AuthDelegate;
    use psibase::services::sites::Wrapper as Sites;
    use psibase::*;

    /// Sets the network name for the current network
    ///
    /// The specified name must be a valid account name.
    /// The specified name must either:
    /// * Not yet exist as an account, or
    /// * Exist but be owned by the "branding" account (using auth-delegate)
    ///
    /// The specified network name will reverse proxy its content to the
    /// homepage service.
    #[action]
    #[allow(non_snake_case)]
    fn setNetworkName(name: String) {
        check(
            get_sender() == SERVICE,
            "Only the 'branding' account is authorized to set network branding",
        );

        let account = AccountNumber::from_exact(name.as_str()).expect("Network name invalid");

        AuthDelegate::call().newAccount(account, SERVICE);
        Sites::call_as(account).setProxy(account!("homepage"));

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
            let curr_val = NetworkNameTable::read().get_index_pk().get(&());
            curr_val.unwrap_or_default().name
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        _user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
    }
}
