#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use credit_lines::{
        sort_accounts,
        tables::{
            CreditLine, CreditLineTable, CreditRelation, CreditRelationTable, PendingCredit,
            PendingCreditTable, Ticker, TickerTable,
        },
    };
    use psibase::*;
    use serde::Deserialize;

    #[derive(Deserialize, SimpleObject)]
    struct Credited {
        ticker: AccountNumber,
        parties: String,
        amount: i64,
        memo: String,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn tickers(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Ticker>> {
            TableQuery::subindex::<AccountNumber>(
                TickerTable::with_service(credit_lines::SERVICE).get_index_pk(),
                &(),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn pending_credits(
            &self,
            creditor: Option<AccountNumber>,
            debitor: Option<AccountNumber>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, PendingCredit>> {
            if creditor.is_some() && debitor.is_some() {
                let creditor = creditor.unwrap();
                let debitor = debitor.unwrap();

                TableQuery::subindex::<u32>(
                    PendingCreditTable::with_service(credit_lines::SERVICE).get_index_by_creditor(),
                    &(creditor, debitor),
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            } else if let Some(creditor) = creditor {
                TableQuery::subindex::<(AccountNumber, u32)>(
                    PendingCreditTable::with_service(credit_lines::SERVICE).get_index_by_creditor(),
                    &creditor,
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            } else if let Some(debitor) = debitor {
                TableQuery::subindex::<(AccountNumber, u32)>(
                    PendingCreditTable::with_service(credit_lines::SERVICE).get_index_by_debitor(),
                    &debitor,
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            } else {
                TableQuery::subindex::<AccountNumber>(
                    PendingCreditTable::with_service(credit_lines::SERVICE).get_index_pk(),
                    &(),
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            }
        }

        async fn ticker(&self, ticker: AccountNumber) -> Option<Ticker> {
            TickerTable::with_service(credit_lines::SERVICE)
                .get_index_pk()
                .get(&ticker)
        }

        async fn credit_relations(
            &self,
            account: AccountNumber,
            ticker: Option<AccountNumber>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, CreditRelation>> {
            if let Some(ticker) = ticker {
                TableQuery::subindex::<AccountNumber>(
                    CreditRelationTable::with_service(credit_lines::SERVICE).get_index_pk(),
                    &(account, ticker),
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            } else {
                TableQuery::subindex::<AccountNumber>(
                    CreditRelationTable::with_service(credit_lines::SERVICE).get_index_pk(),
                    &account,
                )
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
            }
        }

        async fn credit_line(
            &self,
            ticker: AccountNumber,
            account_a: AccountNumber,
            account_b: AccountNumber,
        ) -> Option<CreditLine> {
            let (a, b) = sort_accounts(account_a, account_b);
            CreditLineTable::with_service(credit_lines::SERVICE)
                .get_index_pk()
                .get(&(ticker, a, b))
        }

        async fn credits(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, Credited>> {
            EventQuery::new("history.credit-lines.credited")
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
