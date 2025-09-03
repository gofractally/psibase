#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use ::token_stream::tables::{Stream, StreamTable};
    use async_graphql::{connection::Connection, *};
    use psibase::{
        services::{token_stream, tokens::Decimal},
        *,
    };
    use serde::{Deserialize, Deserializer};
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

    #[derive(SimpleObject)]
    struct UpdatedEvent {
        nft_id: u32,
        actor: AccountNumber,
        amount: String,
        tx_type: String,
    }

    impl<'de> Deserialize<'de> for UpdatedEvent {
        fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where
            D: Deserializer<'de>,
        {
            #[derive(Deserialize)]
            struct UpdatedEventRaw {
                #[serde(deserialize_with = "deserialize_number_from_string")]
                nft_id: u32,
                actor: AccountNumber,
                #[serde(deserialize_with = "deserialize_number_from_string")]
                amount: u64,
                #[serde(deserialize_with = "deserialize_number_from_string")]
                precision: u8,
                tx_type: String,
            }

            let raw = UpdatedEventRaw::deserialize(deserializer)?;
            Ok(UpdatedEvent {
                actor: raw.actor,
                amount: Decimal::new(raw.amount.into(), raw.precision.try_into().unwrap())
                    .to_string(),
                nft_id: raw.nft_id,
                tx_type: raw.tx_type,
            })
        }
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

        async fn updates(
            &self,
            nft_id: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, UpdatedEvent>> {
            EventQuery::new("history.token-stream.updated")
                .condition(format!("nft_id = {}", nft_id))
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
