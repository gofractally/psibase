#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use ::token_stream::tables::{Stream, StreamTable};
    use async_graphql::{connection::Connection, *};
    use psibase::{services::token_stream, *};
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(Deserialize, SimpleObject)]
    struct CreatedEvent {
        #[serde(deserialize_with = "deserialize_number_from_string")]
        nft_id: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        decay_rate_per_million: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        token_id: u32,
        creator: AccountNumber,
    }

    #[derive(Deserialize, SimpleObject)]
    struct DepositedEvent {
        #[serde(deserialize_with = "deserialize_number_from_string")]
        nft_id: u32,
        depositor: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        amount: u64,
    }

    #[derive(Deserialize, SimpleObject)]
    struct ClaimedEvent {
        #[serde(deserialize_with = "deserialize_number_from_string")]
        nft_id: u32,
        claimer: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        amount: u64,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn stream(&self, nft_id: u32) -> Option<Stream> {
            StreamTable::with_service(token_stream::SERVICE)
                .get_index_pk()
                .get(&nft_id)
        }

        async fn streams(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Stream>> {
            TableQuery::subindex::<AccountNumber>(
                StreamTable::with_service(token_stream::SERVICE).get_index_pk(),
                &(),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn created(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, CreatedEvent>> {
            EventQuery::new("history.token-stream.created")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn deposited(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, DepositedEvent>> {
            EventQuery::new("history.token-stream.deposited")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn claimed(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, ClaimedEvent>> {
            EventQuery::new("history.token-stream.claimed")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
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
