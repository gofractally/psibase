#[psibase::service(name = "auth-rcovr+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use auth_recover::service::{AuthRow, AuthTable};
    use psibase::{services::auth_sig::SubjectPublicKeyInfo, *};

    struct Query;

    #[Object]
    impl Query {
        async fn acc_with_key(
            &self,
            pubkey_pem: String,
            gt: Option<AccountNumber>,
            ge: Option<AccountNumber>,
            lt: Option<AccountNumber>,
            le: Option<AccountNumber>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, AuthRow>> {
            let pubkey: SubjectPublicKeyInfo = pubkey_pem.parse()?;
            TableQuery::subindex::<AccountNumber>(
                AuthTable::read().get_index_by_pubkey(),
                &sha256(&pubkey.0),
            )
            .gt(gt.as_ref())
            .ge(ge.as_ref())
            .lt(lt.as_ref())
            .le(le.as_ref())
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn account(&self, name: AccountNumber) -> Option<AuthRow> {
            AuthTable::read().get_index_pk().get(&name)
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
