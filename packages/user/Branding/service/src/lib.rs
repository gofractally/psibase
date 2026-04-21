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
    use psibase::fracpack::Pack;
    use psibase::services::auth_delegate::Wrapper as AuthDelegate;
    use psibase::services::http_server::action_structs::setRedirect as HttpSetRedirect;
    use psibase::services::sites::Wrapper as Sites;
    use psibase::services::staged_tx::Wrapper as StagedTx;
    use psibase::*;

    /// Sets the network name for the current network
    ///
    /// The specified name must be a valid account name.
    /// The specified name must either:
    /// * Not yet exist as an account, or
    /// * Exist but be owned by the "branding" account (using auth-delegate)
    ///
    /// The specified network name will reverse proxy its content to the
    /// homepage service. If a previous network name was set, this action
    /// also proposes a staged transaction that points the homepage and the
    /// previous network name's subdomain at the new name via http-server's
    /// `setRedirect`.
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

        // If a previous network name was set, stage redirects so the
        // homepage and the old name both 308 to the new name. We skip
        // this on the very first install (no prior name exists in the
        // table) because the bootstrap redirect is supplied by
        // Homepage's postinstall.json and there is no old account to
        // redirect from.
        let prev = NetworkNameTable::new().get_index_pk().get(&());
        if let Some(prev) = prev {
            let prev_account = AccountNumber::from_exact(prev.name.as_str())
                .expect("stored network name is not a valid account");
            if prev_account != account {
                let http_server = account!("http-server");
                let method = HttpSetRedirect::ACTION_NAME.into();
                let raw_data: Hex<Vec<u8>> = HttpSetRedirect {
                    destination: account,
                }
                .packed()
                .into();
                let actions = vec![
                    Action {
                        sender: account!("homepage"),
                        service: http_server,
                        method,
                        rawData: raw_data.clone(),
                    },
                    Action {
                        sender: prev_account,
                        service: http_server,
                        method,
                        rawData: raw_data,
                    },
                ];
                StagedTx::call().propose(actions, true);
            }
        }

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
