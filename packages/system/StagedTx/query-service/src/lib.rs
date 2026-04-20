#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{
        connection::{Connection, Edge},
        ComplexObject, SimpleObject,
    };
    use psibase::services::packages::{self, InstalledSchemaTable};
    use psibase::*;
    use serde::Deserialize;
    use staged_tx::service::*;
    use std::fmt::Write;
    use std::str::FromStr;

    #[derive(SimpleObject, Deserialize, Debug)]
    struct Update {
        txid: Checksum256,
        actor: AccountNumber,
        datetime: TimePointUSec,
        event_type: String,
    }

    #[derive(SimpleObject)]
    #[graphql(complex)]
    pub struct ActionView {
        pub sender: AccountNumber,
        pub service: AccountNumber,
        pub method: MethodNumber,
        #[graphql(name = "rawData")]
        pub raw_data: Hex<Vec<u8>>,
    }

    #[ComplexObject]
    impl ActionView {
        /// A pretty, truncated JSON representation of the action's arguments,
        /// decoded using the service's installed schema.
        async fn data(&self) -> String {
            let schema = InstalledSchemaTable::with_service(packages::SERVICE)
                .get_index_pk()
                .get(&self.service)
                .map(|row| row.schema);
            let value = schema
                .as_ref()
                .and_then(|s| unpack_action_data(s, &self.method, &self.raw_data));
            match value {
                Some(serde_json::Value::Object(args)) => {
                    let mut out = String::new();
                    for (i, (name, value)) in args.iter().enumerate() {
                        if i > 0 {
                            out.push('\n');
                        }
                        write!(out, "{}: {}", name, PrunedJsonPretty(value)).unwrap();
                    }
                    out
                }
                Some(value) => PrunedJsonPretty(&value).to_string(),
                None if self.raw_data.is_empty() => String::new(),
                None => format!("<{} bytes raw>", self.raw_data.len()),
            }
        }
    }

    #[derive(SimpleObject)]
    pub struct ActionListView {
        pub actions: Vec<ActionView>,
    }

    #[derive(SimpleObject)]
    pub struct StagedTxView {
        pub id: u32,
        pub txid: Checksum256,
        pub propose_block: u32,
        pub propose_date: TimePointUSec,
        pub proposer: AccountNumber,
        pub action_list: ActionListView,
        pub auto_exec: bool,
    }

    impl From<StagedTx> for StagedTxView {
        fn from(tx: StagedTx) -> Self {
            let actions = tx
                .action_list
                .actions
                .into_iter()
                .map(|action| ActionView {
                    sender: action.sender,
                    service: action.service,
                    method: action.method,
                    raw_data: action.rawData,
                })
                .collect();
            StagedTxView {
                id: tx.id,
                txid: tx.txid,
                propose_block: tx.propose_block,
                propose_date: tx.propose_date,
                proposer: tx.proposer,
                action_list: ActionListView { actions },
                auto_exec: tx.auto_exec,
            }
        }
    }

    fn map_connection(conn: Connection<RawKey, StagedTx>) -> Connection<RawKey, StagedTxView> {
        let mut out = Connection::new(conn.has_previous_page, conn.has_next_page);
        out.edges.extend(
            conn.edges
                .into_iter()
                .map(|edge| Edge::new(edge.cursor, edge.node.into())),
        );
        out
    }

    struct Query;

    #[async_graphql::Object]
    impl Query {
        /// Gets a staged tx by its id
        async fn details(&self, id: u32) -> Option<StagedTxView> {
            StagedTxTable::with_service(staged_tx::SERVICE)
                .get_index_pk()
                .get(&id)
                .map(Into::into)
        }

        /// Get all responses to a staged transaction
        async fn responses(
            &self,
            id: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, staged_tx::service::Response>> {
            TableQuery::subindex::<AccountNumber>(
                ResponseTable::with_service(staged_tx::SERVICE).get_index_pk(),
                &(id),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Gets all staged transactions
        async fn get_staged(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, StagedTxView>> {
            let conn = TableQuery::new(
                StagedTxTable::with_service(staged_tx::SERVICE).get_index_pk(),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await?;
            Ok(map_connection(conn))
        }

        // Gets the staged txs from a particular proposer
        async fn get_staged_by_proposer(
            &self,
            proposer: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, StagedTxView>> {
            let conn = TableQuery::subindex::<AccountNumber>(
                StagedTxTable::with_service(staged_tx::SERVICE).get_index_by_proposer(),
                &proposer,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await?;
            Ok(map_connection(conn))
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
