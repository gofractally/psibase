mod events;

#[psibase::service(name = "nft+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use nft::{
        service::NID,
        tables::{
            CreditRecord, CreditTable, Nft, NftHolder, NftHolderTable, NftTable, UserPending,
            UserPendingTable,
        },
    };
    use psibase::services::{accounts::Account, http_server};
    use psibase::*;

    use crate::events::OwnerChangeEvent;

    #[derive(Fracpack, ToSchema, Debug, Clone, SimpleObject)]
    struct UserDetail {
        account: AccountNumber,
        authService: AccountNumber,
    }

    impl From<Account> for UserDetail {
        fn from(account: Account) -> Self {
            Self {
                account: account.accountNum,
                authService: account.authService,
            }
        }
    }

    #[derive(Fracpack, ToSchema, Debug, Clone, SimpleObject)]
    struct NftDetail {
        id: NID,
        owner: UserDetail,
        issuer: UserDetail,
    }

    struct Query {
        user: Option<AccountNumber>,
    }

    impl Query {
        fn check_user_auth(&self, user: AccountNumber) -> async_graphql::Result<()> {
            if self.user != Some(user) {
                return Err(async_graphql::Error::new(format!(
                    "permission denied: '{}' must authorize your app to make this query. Send it through `nft:plugin/authorized::graphql`.",
                    user
                )));
            }
            Ok(())
        }
    }

    #[Object]
    impl Query {
        /// Paginated history of ownership changes for `account`.
        ///
        /// Requires the queried account to authorize the request through
        /// `nft:plugin/authorized::graphql`.
        async fn ownerChanges(
            &self,
            account: AccountNumber,
            nft_id: Option<NID>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<OwnerChangeEvent>> {
            self.check_user_auth(account)?;

            let mut conditions = vec!["account = ?".to_string()];
            let mut params = vec![account.to_string()];
            if let Some(nft_id) = nft_id {
                conditions.push("nftId = ?".to_string());
                params.push(nft_id.to_string());
            }

            EventQuery::new("history.nft.ownerChange")
                .condition_with_params(conditions.join(" AND "), params)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn allNfts(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Nft>> {
            TableQuery::subindex::<NID>(
                NftTable::with_service(psibase::services::nft::SERVICE).get_index_pk(),
                &(),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Current NFT holder settings for `user` (no history).
        async fn userConf(&self, user: AccountNumber) -> NftHolder {
            NftHolderTable::with_service(psibase::services::nft::SERVICE)
                .get_index_pk()
                .get(&user)
                .unwrap_or(NftHolder {
                    account: user,
                    config: 0,
                })
        }

        async fn issuerNfts(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Nft>> {
            TableQuery::subindex::<NID>(
                NftTable::with_service(psibase::services::nft::SERVICE).get_index_by_issuer(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Pending NFT credits/debits for `user`.
        ///
        /// Requires the queried account to authorize the request through
        /// `nft:plugin/authorized::graphql`.
        async fn user_pending(
            &self,
            user: AccountNumber,
            nft_id: Option<NID>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, UserPending>> {
            self.check_user_auth(user)?;

            if let Some(nft_id) = nft_id {
                TableQuery::subindex::<NID>(
                    UserPendingTable::with_service(psibase::services::nft::SERVICE).get_index_pk(),
                    &(user, nft_id),
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            } else {
                TableQuery::subindex::<NID>(
                    UserPendingTable::with_service(psibase::services::nft::SERVICE).get_index_pk(),
                    &(user),
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            }
        }

        async fn userNfts(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Nft>> {
            TableQuery::subindex::<NID>(
                NftTable::with_service(psibase::services::nft::SERVICE).get_index_by_owner(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn nftDetails(&self, nftId: NID) -> NftDetail {
            use psibase::services::accounts::Wrapper as Accounts;

            let nft = Nft::get_assert(nftId);

            NftDetail {
                id: nftId,
                issuer: Accounts::call().getAccount(nft.issuer).unwrap().into(),
                owner: Accounts::call().getAccount(nft.owner).unwrap().into(),
            }
        }

        /// NFTs `user` has credited and not yet debited or uncredited.
        ///
        /// Requires the queried account to authorize the request through
        /// `nft:plugin/authorized::graphql`.
        async fn userCredits(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, CreditRecord>> {
            self.check_user_auth(user)?;

            TableQuery::subindex::<NID>(
                CreditTable::with_service(psibase::services::nft::SERVICE).get_index_by_creditor(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// NFTs credited to `user` that have not yet been debited or uncredited.
        ///
        /// Requires the queried account to authorize the request through
        /// `nft:plugin/authorized::graphql`.
        async fn userDebits(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, CreditRecord>> {
            self.check_user_auth(user)?;

            TableQuery::subindex::<NID>(
                CreditTable::with_service(psibase::services::nft::SERVICE).get_index_by_debitor(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        assert_eq!(
            get_sender(),
            http_server::SERVICE,
            "permission denied: nft::serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
