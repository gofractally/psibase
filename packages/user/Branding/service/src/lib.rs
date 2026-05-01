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
    use psibase::services::http_server::Wrapper as HttpServer;
    use psibase::services::sites::Wrapper as Sites;
    use psibase::*;

    /// Sets the network name for the current network.
    ///
    /// The specified name must be a valid account name. It must either not
    /// yet exist as an account, or exist but be owned by the "branding"
    /// account (using auth-delegate).
    ///
    /// The new name's subdomain reverse-proxies the homepage service, and
    /// the homepage's subdomain is redirected to it. If a previous network
    /// name was set, that name's subdomain is also redirected to the new
    /// one.
    #[action]
    #[allow(non_snake_case)]
    fn setNetworkName(name: String) {
        check(
            get_sender() == SERVICE,
            "Only the 'branding' account is authorized to set network branding",
        );

        let account = AccountNumber::from_exact(name.as_str()).expect("Network name invalid");

        let created = AuthDelegate::call().newAccount(account, SERVICE, true);
        if !created {
            HttpServer::call_as(account).clearRedirect();
        }
        Sites::call_as(account).setProxy(account!("homepage"));

        let table = NetworkNameTable::new();
        if let Some(prev) = table.get_index_pk().get(&()) {
            let prev_account = AccountNumber::from_exact(prev.name.as_str()).unwrap();
            if prev_account != account {
                HttpServer::call_as(prev_account).setRedirect(account);
            }
        }

        table.put(&NetworkName { name: name.clone() }).unwrap();

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
