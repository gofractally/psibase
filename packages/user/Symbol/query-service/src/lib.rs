#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use psibase::services::diff_adjust::Wrapper as DiffAdjust;
    use psibase::services::tokens::Wrapper as Tokens;
    use psibase::{services::tokens::Decimal, *};
    use serde::Deserialize;
    use symbol::tables::{InitRow, Symbol, SymbolSaleTable, SymbolTable};

    #[derive(Deserialize, SimpleObject)]
    struct PurchaseEvent {
        symbol: AccountNumber,
        actor: AccountNumber,
    }

    #[derive(Deserialize, SimpleObject)]
    struct MapEvent {
        symbol: AccountNumber,
        token_id: u32,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn symbol(&self, symbol: AccountNumber) -> Option<Symbol> {
            SymbolTable::read().get_index_pk().get(&symbol)
        }

        async fn price(&self, len: u8) -> Option<Decimal> {
            SymbolSaleTable::read()
                .get_index_pk()
                .get(&len)
                .map(|sale| {
                    Decimal::new(
                        DiffAdjust::call().get_price(sale.nft_id).into(),
                        Tokens::call()
                            .getToken(InitRow::get_assert().token_id)
                            .precision,
                    )
                })
        }

        async fn purchased(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, PurchaseEvent>> {
            EventQuery::new("history.symbol.purchased")
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        async fn mapped(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, MapEvent>> {
            EventQuery::new("history.symbol.mapped")
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
