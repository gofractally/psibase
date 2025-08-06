#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use psibase::*;
    use serde::Deserialize;
    use staged_tx::service::*;
    use std::str::FromStr;

    #[derive(SimpleObject, Deserialize, Debug)]
    struct Update {
        txid: Checksum256,
        actor: AccountNumber,
        datetime: TimePointUSec,
        event_type: String,
    }

    struct Query;

    #[async_graphql::Object]
    impl Query {
        /// Gets a staged tx by its id
        async fn details(&self, id: u32) -> Option<StagedTx> {
            StagedTxTable::with_service(staged_tx::SERVICE)
                .get_index_pk()
                .get(&id)
        }

        /// Gets all staged transactions
        async fn get_staged(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, StagedTx>> {
            TableQuery::new(StagedTxTable::with_service(staged_tx::SERVICE).get_index_pk())
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        // Gets the staged txs from a particular proposer
        async fn get_staged_by_proposer(
            &self,
            proposer: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, StagedTx>> {
            TableQuery::subindex::<AccountNumber>(
                StagedTxTable::with_service(staged_tx::SERVICE).get_index_by_proposer(),
                &proposer,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Gets staged transaction IDs for staged transactions that include a specified party
        /// Where a `party` is a sender of an action within the staged transaction.
        async fn get_ids_for_party(
            &self,
            party: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, StagedTxParty>> {
            TableQuery::subindex::<AccountNumber>(
                StagedTxPartyTable::with_service(staged_tx::SERVICE).get_index_by_party(),
                &party,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// This query gets the historical actions taken with respect to staged transactions
        /// by a specified actor.
        async fn actor_history(
            &self,
            actor: String,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, Update>> {
            let actor = ExactAccountNumber::from_str(&actor).unwrap();
            EventQuery::new("history.staged-tx.updated")
                .condition(format!("actor = '{}'", actor))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        /// This query gets the historical updates for the staged tx with the specified txid
        async fn txid_history(
            &self,
            txid: String,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, Update>> {
            EventQuery::new("history.staged-tx.updated")
                .condition(format!("txid = X'{}'", txid))
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
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| serve_simple_ui::<staged_tx::Wrapper>(&request))
    }
}
