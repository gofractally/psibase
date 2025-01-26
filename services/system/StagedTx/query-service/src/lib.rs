mod event_query {
    use async_graphql::connection::{Connection, Edge, EmptyFields};
    use async_graphql::OutputType;
    use psibase::*;
    use serde::Deserialize;
    use serde_json::Value;

    pub trait EventQueryable: Sized + OutputType {
        fn table_name() -> &'static str;
        fn from_row(row: Value) -> Result<Self, serde_json::Error>;
    }

    #[derive(Deserialize)]
    struct SqlRow {
        #[serde(rename = "rowid", deserialize_with = "deserialize_rowid")]
        rowid: i32,
        #[serde(flatten)]
        data: Value,
    }

    pub struct EventQuery<T: EventQueryable> {
        table: String,
        condition: Option<String>,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
        _phantom: std::marker::PhantomData<T>,
    }

    impl<T: EventQueryable> EventQuery<T> {
        pub fn new(table: impl Into<String>) -> Self {
            Self {
                table: table.into(),
                condition: None,
                first: None,
                last: None,
                before: None,
                after: None,
                _phantom: std::marker::PhantomData,
            }
        }

        pub fn condition(mut self, condition: impl Into<String>) -> Self {
            self.condition = Some(condition.into());
            self
        }

        pub fn first(mut self, first: Option<i32>) -> Self {
            if let Some(n) = first {
                if n < 0 {
                    abort_message("'first' cannot be negative");
                }
            }
            self.first = first;
            self
        }

        pub fn last(mut self, last: Option<i32>) -> Self {
            if let Some(n) = last {
                if n < 0 {
                    abort_message("'last' cannot be negative");
                }
            }
            self.last = last;
            self
        }

        pub fn before(mut self, before: Option<String>) -> Self {
            self.before = before;
            self
        }

        pub fn after(mut self, after: Option<String>) -> Self {
            self.after = after;
            self
        }

        fn check_pagination(
            rows: &[SqlRow],
            condition: &str,
            table: &str,
            before: Option<&String>,
            after: Option<&String>,
            first: Option<i32>,
            last: Option<i32>,
        ) -> (bool, bool) {
            // Check if we got an extra item (meaning there are more after)
            let has_next = if let Some(before_cursor) = before {
                // For before queries, check if the before cursor exists
                let next_query = generate_sql_query(
                    table,
                    condition.to_string(),
                    Some(1),
                    None,
                    None,
                    Some(before_cursor.clone()),
                );
                println!("next_query: {}", next_query);
                let next_json = services::r_events::Wrapper::call().sqlQuery(next_query);
                println!("next_json: {}", next_json);
                let next_rows: Vec<SqlRow> = serde_json::from_str(&next_json).unwrap_or_default();
                !next_rows.is_empty()
            } else {
                // For normal or after queries, use the extra item check
                match first.or(last) {
                    Some(n) => rows.len() > n as usize,
                    None => false,
                }
            };

            // Check if there are any records before our page
            let has_previous = if let Some(after_cursor) = after {
                // For after queries, check if there are records before the after cursor
                let prev_query = generate_sql_query(
                    table,
                    condition.to_string(),
                    Some(1),
                    None,
                    Some(after_cursor.clone()), // Check for records before the after cursor
                    None,
                );
                println!("prev_query: {}", prev_query);
                let prev_json = services::r_events::Wrapper::call().sqlQuery(prev_query);
                println!("prev_json: {}", prev_json);
                let prev_rows: Vec<SqlRow> = serde_json::from_str(&prev_json).unwrap_or_default();
                !prev_rows.is_empty()
            } else if let Some(first_row) = rows.first() {
                // For normal queries, check if there are any records before our first record
                let prev_query = generate_sql_query(
                    table,
                    condition.to_string(),
                    Some(1),
                    None,
                    Some(first_row.rowid.to_string()),
                    None,
                );
                println!("prev_query: {}", prev_query);
                let prev_json = services::r_events::Wrapper::call().sqlQuery(prev_query);
                println!("prev_json: {}", prev_json);
                let prev_rows: Vec<SqlRow> = serde_json::from_str(&prev_json).unwrap_or_default();
                !prev_rows.is_empty()
            } else {
                false
            };

            (has_previous, has_next)
        }

        pub fn query(self) -> async_graphql::Result<Connection<i32, T, EmptyFields, EmptyFields>> {
            // Request one more item than needed to check if there are more in either direction
            let first_plus_one = self.first.map(|n| n + 1);
            let last_plus_one = self.last.map(|n| n + 1);
            let condition = self.condition.unwrap_or_default();
            let is_before_query = self.before.is_some();

            // First query to get our page plus one extra for hasNextPage
            let query = generate_sql_query(
                &self.table,
                condition.clone(),
                first_plus_one,
                last_plus_one,
                self.before.clone(),
                self.after.clone(),
            );

            println!("query: {}", query);
            let json_str = services::r_events::Wrapper::call().sqlQuery(query);
            println!("json_str: {}", json_str);
            let mut rows: Vec<SqlRow> = serde_json::from_str(&json_str).unwrap_or_default();

            let (has_previous, has_next) = Self::check_pagination(
                &rows,
                &condition,
                &self.table,
                self.before.as_ref(),
                self.after.as_ref(),
                self.first,
                self.last,
            );

            // Remove the extra item if we got one
            if has_next && !is_before_query {
                // Only truncate for non-before queries
                rows.truncate((self.first.or(self.last).unwrap()) as usize);
            }

            // For 'last' queries, we've retrieved in DESC order, so reverse to get ascending order
            if self.last.is_some() {
                rows.reverse();
            }

            let mut connection = Connection::new(has_previous, has_next);
            for row in rows {
                if let Ok(data) = T::from_row(row.data) {
                    connection.edges.push(Edge::new(row.rowid, data));
                }
            }

            if !connection.edges.is_empty() {
                connection.has_previous_page = has_previous;
                connection.has_next_page = has_next;
            }

            Ok(connection)
        }
    }

    fn deserialize_rowid<'de, D>(deserializer: D) -> Result<i32, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s: String = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }

    fn generate_sql_query(
        table: &str,
        condition: String,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> String {
        // Disallow both 'first' and 'last' for simplicity
        if first.is_some() && last.is_some() {
            abort_message("Cannot specify both 'first' and 'last'");
        }

        // Build up the filters
        let mut filters = vec![];
        if !condition.trim().is_empty() {
            filters.push(condition);
        }

        // If `last` is set, we do descending order
        let descending = last.is_some();

        // Add cursor filters - these work the same regardless of order
        if let Some(b) = before.and_then(|s| s.parse::<i32>().ok()) {
            filters.push(format!("ROWID < {}", b));
        }
        if let Some(a) = after.and_then(|s| s.parse::<i32>().ok()) {
            filters.push(format!("ROWID > {}", a));
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
        let mut query =
            format!("SELECT ROWID, * FROM {table} {where_clause} ORDER BY ROWID {order}");

        if let Some(l) = limit {
            query.push_str(&format!(" LIMIT {}", l));
        }

        query
    }
}

// Temporary macro module until we move it to its own crate
mod event_query_derive {
    macro_rules! generate_event_query {
        (
            $(#[$attr:meta])*
            struct $name:ident {
                $(
                    $(#[$field_attr:meta])*
                    $field:ident: $type:ty
                ),* $(,)?
            }
        ) => {
            $(#[$attr])*
            struct $name {
                $(
                    $(#[$field_attr])*
                    $field: $type,
                )*
            }

            impl crate::event_query::EventQueryable for $name {
                fn table_name() -> &'static str {
                    "\"history.staged-tx.updated\""  // Default table name
                }

                fn from_row(row: serde_json::Value) -> Result<Self, serde_json::Error> {
                    println!("Trying to deserialize: {}", row);
                    let result = serde_json::from_str(&row.to_string());
                    println!("Deserialization result: {:?}", result);
                    result
                }
            }
        };
    }

    pub(crate) use generate_event_query;
}

#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use std::str::FromStr;

    use super::event_query;
    use super::event_query_derive::generate_event_query;
    use async_graphql::{
        connection::{Connection, EmptyFields},
        *,
    };
    use psibase::*;
    use serde::Deserialize;
    use staged_tx::service::*;

    generate_event_query! {
        #[derive(SimpleObject, Deserialize, Debug)]
        struct Update {
            txid: String,
            actor: AccountNumber,
            datetime: TimePointUSec,
            #[serde(rename = "event_type")]
            event_type: String,
        }
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
        ) -> async_graphql::Result<Connection<i32, Update>> {
            let actor = ExactAccountNumber::from_str(&actor).unwrap();
            event_query::EventQuery::<Update>::new("\"history.staged-tx.updated\"")
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
        ) -> async_graphql::Result<Connection<i32, Update>> {
            event_query::EventQuery::<Update>::new("\"history.staged-tx.updated\"")
                .condition(format!("txid = '{}'", txid))
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
            .or_else(|| serve_schema::<staged_tx::Wrapper>(&request))
    }
}
