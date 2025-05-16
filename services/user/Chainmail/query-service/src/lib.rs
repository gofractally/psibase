mod event_query_helpers;

#[psibase::service]
#[allow(non_snake_case)]
mod service {

    use crate::event_query_helpers::serve_rest_api;
    use async_graphql::connection::Connection;
    use chainmail::service::*;
    use psibase::*;

    struct Query;

    #[async_graphql::Object]
    impl Query {
        /// Gets any saved public messages for a particular user.
        async fn get_saved_msgs(
            &self,
            receiver: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, SavedMessage>, async_graphql::Error> {
            let saved_msgs_table = SavedMessageTable::new();
            TableQuery::subindex::<AccountNumber>(
                saved_msgs_table.get_index_by_receiver(),
                &receiver,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Gets any private messaging groups of which a particular user is a member.
        async fn get_member_groups(
            &self,
            user: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, UserGroup>> {
            let table = UserGroupsTable::with_service(chainmail::SERVICE);
            TableQuery::subindex::<Checksum256>(table.get_index_pk(), &user)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        /// Gets the members of a particular private messaging group.
        async fn get_group_members(&self, group_id: Checksum256) -> Vec<AccountNumber> {
            UserGroupsTable::with_service(chainmail::SERVICE)
                .get_index_by_group()
                .range((group_id, AccountNumber::new(0))..=(group_id, AccountNumber::new(u64::MAX)))
                .map(|group| group.member)
                .collect::<Vec<_>>()
        }

        /// Gets historical events related to a particular private messaging group.
        ///
        /// Events:
        ///  * 0 - Group created
        ///  * 1 - Key rotated
        ///  * 2 - Group deleted
        async fn group_events(
            &self,
            group_id: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, event_structs::history::group_event>> {
            println!(
                "Event name: {}",
                chainmail::service::event_structs::history::group_event::ACTION_NAME
            );
            EventQuery::new("history.chainmail.group_event")
                .condition(format!("group_id = {}", group_id))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }

        /// Gets the messages sent to a private messaging group.
        async fn get_group_msgs(
            &self,
            group_id: u32,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, event_structs::history::sent_to_group>> {
            EventQuery::new("history.chainmail.sent_to_group")
                .condition(format!("group_id = {}", group_id))
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
            .or_else(|| serve_rest_api(&request))
    }
}
