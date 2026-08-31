#[psibase::service(name = "meet+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use meet::tables::{
        Meeting, MeetingMember, MeetingMemberTable, MeetingTable, UserKey, UserKeyTable,
    };
    use psibase::*;

    struct Query;

    #[Object]
    impl Query {
        async fn user_key(&self, account: AccountNumber) -> Option<UserKey> {
            UserKeyTable::with_service(meet::SERVICE)
                .get_index_pk()
                .get(&account)
        }

        async fn meeting(&self, id: AccountNumber) -> Option<Meeting> {
            MeetingTable::with_service(meet::SERVICE)
                .get_index_pk()
                .get(&id)
        }

        async fn meeting_by_hash(&self, hash: String) -> Option<Meeting> {
            MeetingTable::with_service(meet::SERVICE)
                .get_index_pk()
                .iter()
                .find(|meeting| meeting.key_hash == hash)
        }

        async fn meeting_members(
            &self,
            meeting_id: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, MeetingMember>> {
            TableQuery::subindex::<AccountNumber>(
                MeetingMemberTable::with_service(meet::SERVICE).get_index_pk(),
                &meeting_id,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn meetings_for_account(
            &self,
            account: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, MeetingMember>> {
            TableQuery::subindex::<AccountNumber>(
                MeetingMemberTable::with_service(meet::SERVICE).get_index_by_account(),
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

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
