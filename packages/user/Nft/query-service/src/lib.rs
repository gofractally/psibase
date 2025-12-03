#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use nft::{
        service::NID,
        tables::{CreditRecord, CreditTable, Nft, NftHolder, NftHolderTable, NftTable},
    };
    use psibase::{services::accounts::Account, *};

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

    struct Query;

    #[Object]
    impl Query {
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

        async fn userCredits(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, CreditRecord>> {
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

        async fn userDebits(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, CreditRecord>> {
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
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        // Services graphql queries
        None.or_else(|| serve_graphql(&request, Query))
            // Serves a GraphiQL UI interface at the /graphiql endpoint
            .or_else(|| serve_graphiql(&request))
    }
}
