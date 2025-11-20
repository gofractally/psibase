#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use psibase::{services::tokens::TID, *};
    use serde::Deserialize;
    use serde_aux::prelude::*;
    use symbol::tables::{Mapping, Symbol, SymbolLength};

    #[derive(Deserialize, SimpleObject)]
    #[graphql(complex)]
    struct SymbolEvent {
        symbol: AccountNumber,
        actor: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        #[graphql(skip)]
        action: u8,
    }

    #[ComplexObject]
    impl SymbolEvent {
        pub async fn action(&self) -> String {
            match self.action {
                symbol::service::CREATED => "created".to_string(),
                symbol::service::MAPPED => "mapped".to_string(),
                _ => "unknown".to_string(),
            }
        }
    }

    struct Query;

    #[Object]
    impl Query {
        /// Fetch price information according to symbol length
        async fn symbol_length(&self, length: u8) -> Option<SymbolLength> {
            SymbolLength::get(length)
        }

        /// Fetch symbol information, returns null if it does not exist
        async fn symbol(&self, symbol: String) -> Option<Symbol> {
            Symbol::get(symbol.as_str().into())
        }

        /// Fetch a mapping of a symbol by token ID
        async fn mapping(&self, token_id: TID) -> Option<Mapping> {
            Mapping::get(token_id)
        }

        /// Returns a paginated subset of all historical events (that haven't yet been pruned
        /// from this node) related to symbol creation and mapping. Can be filtered by symbol
        /// and/or actor.
        async fn symbol_events(
            &self,
            symbol: Option<AccountNumber>,
            actor: Option<AccountNumber>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, SymbolEvent>> {
            let mut query = EventQuery::new("history.symbol.symEvent");

            // Build conditions if filters are provided
            if symbol.is_some() || actor.is_some() {
                let mut conditions = Vec::new();
                let mut params = Vec::new();

                if let Some(sym) = symbol {
                    conditions.push("symbol = ?".to_string());
                    params.push(sym.to_string());
                }

                if let Some(act) = actor {
                    conditions.push("actor = ?".to_string());
                    params.push(act.to_string());
                }

                query = query.condition_with_params(conditions.join(" AND "), params);
            }

            query
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
