#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use std::str::FromStr;

    use async_graphql::{connection::Connection, *};
    use psibase::*;
    use serde::Deserialize;
    use staged_tx::service::*;

    #[derive(Deserialize, SimpleObject)]
    struct Update {
        txid: String,            // The hex string txid of the staged transaction
        actor: AccountNumber,    // The sender of the action causing the event
        datetime: TimePointUSec, // The time of the event emission
        event_type: String,      // The type of event
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
            before: Option<i32>,
            after: Option<i32>,
        ) -> Vec<Update> {
            let actor = ExactAccountNumber::from_str(&actor).unwrap();
            let query = generate_sql_query(
                "\"history.staged-tx.updated\"",
                format!("actor = '{}'", actor),
                first,
                last,
                before,
                after,
            );

            println!("{}", query);

            let json_str = services::r_events::Wrapper::call().sqlQuery(query);

            println!("{}", json_str);

            let mut updates: Vec<Update> = serde_json::from_str(&json_str).unwrap_or_default();

            if last.is_some() {
                updates.reverse();
            }

            updates
        }

        /// This query gets the historical updates for the staged tx with the specified txid
        async fn txid_history(
            &self,
            txid: String,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<i32>,
            after: Option<i32>,
        ) -> Vec<Update> {
            let query = generate_sql_query(
                "\"history.staged-tx.updated\"",
                format!("txid = '{}'", txid),
                first,
                last,
                before,
                after,
            );

            let json_str = services::r_events::Wrapper::call().sqlQuery(query);

            serde_json::from_str(&json_str).unwrap_or_default()
        }
    }

    fn generate_sql_query(
        table: &str,
        condition: String,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<i32>,
        after: Option<i32>,
    ) -> String {
        // Disallow both 'first' and 'last' for simplicity
        if first.is_some() && last.is_some() {
            panic!("Cannot specify both 'first' and 'last'");
        }

        // Build up the filters
        let mut filters = vec![];
        if !condition.trim().is_empty() {
            filters.push(condition);
        }

        // If `last` is set, we do descending order
        let descending = last.is_some();

        if descending {
            // "before" and "after" are inverted in a descending query
            if let Some(b) = before {
                filters.push(format!("ROWID > {}", b));
            }
            if let Some(a) = after {
                filters.push(format!("ROWID < {}", a));
            }
        } else {
            // Normal ascending query
            if let Some(b) = before {
                filters.push(format!("ROWID < {}", b));
            }
            if let Some(a) = after {
                filters.push(format!("ROWID > {}", a));
            }
        }

        let where_clause = if filters.is_empty() {
            "".to_string()
        } else {
            format!("WHERE {}", filters.join(" AND "))
        };

        // Decide order and limit
        let order = if descending { "DESC" } else { "ASC" };
        let limit = last.or(first);

        // Construct the final SQL
        let mut query = format!("SELECT * FROM {table} {where_clause} ORDER BY ROWID {order}");

        if let Some(l) = limit {
            query.push_str(&format!(" LIMIT {}", l));
        }

        query
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| serve_simple_ui::<staged_tx::Wrapper>(&request))
            .or_else(|| serve_schema::<staged_tx::Wrapper>(&request))
    }
}
