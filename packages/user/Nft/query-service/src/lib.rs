mod events;

#[psibase::service(name = "nft+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use nft::{
        service::NID,
        tables::{
            CreditRecord, CreditTable, Nft, NftHolder, NftHolderTable, NftStatus, NftTable,
            UserPending, UserPendingTable,
        },
    };
    use psibase::services::{accounts::Account, http_server};
    use psibase::*;

    use crate::events::OwnerChangeEvent;

    #[derive(Pack, Unpack, ToSchema, Debug, Clone, SimpleObject)]
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

    #[derive(Pack, Unpack, ToSchema, Debug, Clone, SimpleObject)]
    struct NftDetail {
        id: NID,
        owner: UserDetail,
        issuer: UserDetail,
    }

    #[derive(Enum, Copy, Clone, Eq, PartialEq)]
    enum NftLife {
        #[graphql(name = "available")]
        Available,
        #[graphql(name = "burned")]
        Burned,
        #[graphql(name = "active")]
        Active,
    }

    #[derive(SimpleObject)]
    struct NftStatusView {
        state: NftLife,
        nftDetail: Option<NftDetail>,
    }

    struct Query {
        user: Option<AccountNumber>,
    }

    impl Query {
        fn nft_detail(&self, nft: &Nft) -> NftDetail {
            use psibase::services::accounts::Wrapper as Accounts;

            NftDetail {
                id: nft.id,
                issuer: Accounts::call().getAccount(nft.issuer).unwrap().into(),
                owner: Accounts::call().getAccount(nft.owner).unwrap().into(),
            }
        }

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
            counter_party: Option<AccountNumber>,
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
            if let Some(counter_party) = counter_party {
                conditions.push("counter_party = ?".to_string());
                params.push(counter_party.to_string());
            }

            EventQuery::new("history.nft.ownerChange")
                .condition_with_params(conditions.join(" AND "), params)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        /// NFTs filtered by issuer, holder, or both.
        ///
        /// With neither argument, lists every NFT.
        async fn nfts(
            &self,
            issuer: Option<AccountNumber>,
            user: Option<AccountNumber>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Nft>> {
            let table = NftTable::with_service(psibase::services::nft::SERVICE);
            match (issuer, user) {
                (None, None) => {
                    TableQuery::subindex::<NID>(table.get_index_pk(), &())
                        .first(first)
                        .last(last)
                        .before(before)
                        .after(after)
                        .query()
                        .await
                }
                (Some(issuer), None) => {
                    TableQuery::subindex::<(AccountNumber, NID)>(
                        table.get_index_by_issuer(),
                        &(issuer),
                    )
                    .first(first)
                    .last(last)
                    .before(before)
                    .after(after)
                    .query()
                    .await
                }
                (None, Some(user)) => {
                    TableQuery::subindex::<(AccountNumber, NID)>(
                        table.get_index_by_owner(),
                        &(user),
                    )
                    .first(first)
                    .last(last)
                    .before(before)
                    .after(after)
                    .query()
                    .await
                }
                (Some(issuer), Some(user)) => {
                    TableQuery::subindex::<NID>(table.get_index_by_issuer(), &(issuer, user))
                        .first(first)
                        .last(last)
                        .before(before)
                        .after(after)
                        .query()
                        .await
                }
            }
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

        /// Id that `mint` would assign when its id argument is omitted.
        async fn nextId(&self) -> u32 {
            Nft::peek_next_id()
        }

        /// Whether `mint` can create `id`.
        async fn idAvailable(&self, id: u32) -> bool {
            Nft::id_available(id)
        }

        /// Id `mint(Some)` should use for `id`.
        ///
        /// Returns `id` when it is free. A taken id above `nextId` walks
        /// forward. A taken id at or below `nextId` resumes there.
        async fn chooseId(&self, id: u32) -> u32 {
            Nft::choose_id(id)
        }

        /// First id at or after `begin` that `mint` can create. The search wraps, and never returns 0.
        async fn firstAvailableId(&self, begin: u32) -> u32 {
            Nft::first_available_id(begin)
        }

        async fn nftDetails(&self, nftId: NID) -> Option<NftDetail> {
            match Nft::status(nftId) {
                NftStatus::Active(nft) => Some(self.nft_detail(&nft)),
                NftStatus::Available | NftStatus::Burned => None,
            }
        }

        /// `available` when `nftId` was never minted, `burned` after burn, `active` while it exists.
        async fn nftStatus(&self, nftId: NID) -> NftStatusView {
            match Nft::status(nftId) {
                NftStatus::Available => NftStatusView {
                    state: NftLife::Available,
                    nftDetail: None,
                },
                NftStatus::Burned => NftStatusView {
                    state: NftLife::Burned,
                    nftDetail: None,
                },
                NftStatus::Active(nft) => NftStatusView {
                    state: NftLife::Active,
                    nftDetail: Some(self.nft_detail(&nft)),
                },
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
