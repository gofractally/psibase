#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use psibase::*;
    use serde::Deserialize;
    use symbol::tables::{Symbol, SymbolLength};

    #[derive(Deserialize, SimpleObject)]
    struct SymbolCreated {
        symbol: AccountNumber,
        new_thing: AccountNumber,
        cost: String,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn symbol_length(&self, length: u8) -> Option<SymbolLength> {
            SymbolLength::get(length)
        }

        async fn symbol(&self, symbol: String) -> Option<Symbol> {
            Symbol::get(symbol.as_str().into())
        }

        async fn symbol_created(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, SymbolCreated>> {
            EventQuery::new("history.symbol.symCreated")
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
