#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::connection::Connection;
    use async_graphql::*;
    use evaluations::service::{
        ConfigTable, Evaluation, EvaluationTable, Group, GroupTable, User, UserSettings,
        UserSettingsTable, UserTable,
    };
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    #[derive(Deserialize, SimpleObject)]
    struct KeysSet {
        owner: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        evaluation_id: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        group_number: u32,
        keys: Vec<Vec<u8>>,
        hash: String,
    }

    #[derive(Deserialize, SimpleObject)]
    struct GroupFinish {
        owner: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        evaluation_id: u32,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        group_number: u32,
        users: Vec<AccountNumber>,
        result: Vec<u8>,
    }

    struct Query;

    #[Object]
    impl Query {
        async fn get_group_key(
            &self,
            evaluation_owner: AccountNumber,
            evaluation_id: u32,
            group_number: u32,
        ) -> async_graphql::Result<Connection<u64, KeysSet>> {
            EventQuery::new("history.evaluations.keysset")
                .condition(format!(
                    "owner = '{}' AND evaluation_id = {} AND group_number = {}",
                    evaluation_owner, evaluation_id, group_number
                ))
                .query()
        }

        async fn get_group_result(
            &self,
            evaluation_owner: AccountNumber,
            evaluation_id: u32,
            group_number: u32,
        ) -> async_graphql::Result<Connection<u64, GroupFinish>> {
            EventQuery::new("history.evaluations.group_finished")
                .condition(format!(
                    "owner = '{}' AND evaluation_id = {} AND group_number = {}",
                    evaluation_owner, evaluation_id, group_number
                ))
                .query()
        }

        async fn get_group(
            &self,
            owner: AccountNumber,
            evaluation_id: u32,
            group_number: u32,
        ) -> Option<Group> {
            GroupTable::with_service(evaluations::SERVICE)
                .get_index_pk()
                .get(&(owner, evaluation_id, group_number))
        }

        async fn get_evaluation(
            &self,
            owner: AccountNumber,
            evaluation_id: u32,
        ) -> Option<Evaluation> {
            EvaluationTable::with_service(evaluations::SERVICE)
                .get_index_pk()
                .get(&(owner, evaluation_id))
        }

        async fn get_last_evaluation(&self, owner: AccountNumber) -> Option<Evaluation> {
            let last_config = ConfigTable::with_service(evaluations::SERVICE)
                .get_index_pk()
                .get(&owner)?;

            EvaluationTable::with_service(evaluations::SERVICE)
                .get_index_pk()
                .get(&(owner, last_config.last_used_id))
        }

        async fn get_groups(
            &self,
            owner: AccountNumber,
            evaluation_id: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Group>> {
            TableQuery::subindex::<u32>(
                GroupTable::with_service(evaluations::SERVICE).get_index_pk(),
                &(owner, evaluation_id),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn get_group_users(
            &self,
            owner: AccountNumber,
            evaluation_id: u32,
            group_number: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, User>> {
            TableQuery::subindex::<AccountNumber>(
                UserTable::with_service(evaluations::SERVICE).get_index_by_group(),
                &(owner, evaluation_id, Some(group_number)),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn get_users(
            &self,
            owner: AccountNumber,
            evaluation_id: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, User>> {
            TableQuery::subindex::<AccountNumber>(
                UserTable::with_service(evaluations::SERVICE).get_index_pk(),
                &(owner, evaluation_id),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn get_user_settings(
            &self,
            accounts: Vec<AccountNumber>,
        ) -> Vec<Option<UserSettings>> {
            accounts
                .into_iter()
                .map(|account| {
                    UserSettingsTable::with_service(evaluations::SERVICE)
                        .get_index_pk()
                        .get(&account)
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
