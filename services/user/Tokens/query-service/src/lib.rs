#[psibase::service]
#[allow(non_snake_case)]
mod service {

    use async_graphql::{connection::Connection, *};
    use psibase::services::nft::Wrapper as Nfts;

    use psibase::*;
    use tokens::tables::tables::{
        Balance, BalanceTable, SharedBalance, SharedBalanceTable, Token, TokenTable,
    };

    struct Query;

    enum TokenType {
        Number(u32),
        Symbol(AccountNumber),
    }

    fn identify_token_type(token_id: String) -> TokenType {
        use TokenType::{Number, Symbol};

        let first_char = token_id.chars().next().unwrap();

        if first_char.is_ascii_digit() {
            Number(token_id.parse::<u32>().unwrap())
        } else {
            Symbol(AccountNumber::from(token_id.as_str()))
        }
    }

    fn token_id_to_number(token_id: String) -> u32 {
        match identify_token_type(token_id) {
            TokenType::Number(num) => num,
            TokenType::Symbol(account) => {
                TokenTable::with_service(tokens::SERVICE)
                    .get_index_by_symbol()
                    .get(&Some(account))
                    .unwrap()
                    .id
            }
        }
    }

    #[Object]
    impl Query {
        async fn token(&self, token_id: String) -> Option<Token> {
            TokenTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .get(&token_id_to_number(token_id))
        }

        async fn user_credits(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, SharedBalance>> {
            TableQuery::subindex::<(AccountNumber, u32)>(
                SharedBalanceTable::with_service(tokens::SERVICE).get_index_by_creditor(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn user_debits(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, SharedBalance>> {
            TableQuery::subindex::<(AccountNumber, u32)>(
                SharedBalanceTable::with_service(tokens::SERVICE).get_index_by_debitor(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn user_balances(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Balance>> {
            TableQuery::subindex::<u32>(
                BalanceTable::with_service(tokens::SERVICE).get_index_pk(),
                &(user),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn user_tokens(&self, user: AccountNumber) -> Vec<Token> {
            let tokens: Vec<Token> = TokenTable::with_service(tokens::SERVICE)
                .get_index_pk()
                .range(0..=(u32::MAX))
                .collect();

            tokens
                .into_iter()
                .filter(|token| {
                    let nft = Nfts::call_from(Wrapper::SERVICE).getNft(token.nft_id);
                    nft.owner == user
                })
                .collect()
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
