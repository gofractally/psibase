#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::connection::Connection;
    use async_graphql::*;
    use evaluations::db::tables::{Evaluation, Group, User, UserSettings, UserTable};
    use psibase::*;
    use serde::Deserialize;

    struct Query;

    #[derive(Deserialize, SimpleObject)]
    struct HistoricalUpdate {
        a: String,
        b: String,
        res: String,
    }

    #[derive(Deserialize, SimpleObject)]
    struct KeysSet {
        evaluation_id: String,
        group_number: String,
        keys: Vec<Vec<u8>>,
        hash: String,
    }

    #[Object]
    impl Query {
        async fn get_group_key(
            &self,
            evaluation_id: u32,
            group_number: u32,
        ) -> async_graphql::Result<Connection<u64, KeysSet>> {
            EventQuery::new("history.evaluations.keysset")
                .condition(format!(
                    "evaluation_id = {} AND group_number = {}",
                    evaluation_id, group_number
                ))
                .query()
        }

        async fn get_evaluation(&self, id: u32) -> Option<Evaluation> {
            evaluations::Wrapper::call().getEvaluation(id)
        }

        async fn get_last_id(&self) -> u32 {
            evaluations::Wrapper::call().getLastId()
        }

        async fn get_groups(&self, id: u32) -> Vec<Group> {
            evaluations::Wrapper::call().getGroups(id)
        }

        async fn get_group(&self, id: u32, group_number: u32) -> Option<Group> {
            evaluations::Wrapper::call().getGroup(id, group_number)
        }

        async fn get_group_users(
            &self,
            id: u32,
            group_number: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, User>> {
            TableQuery::subindex::<AccountNumber>(
                UserTable::with_service(evaluations::SERVICE).get_index_by_group(),
                &(id, Some(group_number)),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn get_users(&self, id: u32) -> Vec<User> {
            evaluations::Wrapper::call().getUsers(id)
        }

        async fn get_user(&self, id: u32, user: AccountNumber) -> Option<User> {
            evaluations::Wrapper::call().getUser(id, user)
        }

        async fn get_user_settings(
            &self,
            account_numbers: Vec<AccountNumber>,
        ) -> Vec<Option<UserSettings>> {
            account_numbers
                .iter()
                .map(|account_number| evaluations::Wrapper::call().getUserSettings(*account_number))
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
