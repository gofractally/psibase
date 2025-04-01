#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use evaluations::db::tables::{Evaluation, Group, User};

    struct Query;

    #[Object]
    impl Query {

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

        async fn get_group_users(&self, id: u32, group_number: u32) -> Vec<User> {
            evaluations::Wrapper::call().getGroupUsers(id, group_number)
        }

        async fn get_users(&self, id: u32) -> Vec<User> {
            evaluations::Wrapper::call().getUsers(id)
        }

        async fn get_user(&self, id: u32, user: AccountNumber) -> Option<User> {
            evaluations::Wrapper::call().getUser(id, user)
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
            // Services graphql queries
        None.or_else(|| serve_graphql(&request, Query))

            // Serves a GraphiQL UI interface at the /graphiql endpoint
            .or_else(|| serve_graphiql(&request))

            // Serves a full service schema at the /schema endpoint
            .or_else(|| serve_schema::<evaluations::Wrapper>(&request))
    }
}
