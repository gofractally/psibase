//! Chainmail Service
//!
//! Provides the Chainmail service, a simple email-like client.

mod event_query_helpers;
mod helpers;
mod tables;

#[psibase::service(tables = "tables::tables")]
mod service {
    use crate::event_query_helpers::serve_rest_api;
    use crate::tables::tables::{InitRow, InitTable, SavedMessage, SavedMessageTable};

    use psibase::services::accounts::Wrapper as AccountsSvc;
    use psibase::services::events::Wrapper as EventsSvc;
    use psibase::services::sites::Wrapper as SitesSvc;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        check, get_sender, serve_graphql, AccountNumber, DbId, HttpReply, HttpRequest,
        MethodNumber, RawKey, Table, TableQuery, TimePointSec,
    };

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        SitesSvc::call().enableSpa(true);

        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, MethodNumber::from("sent"), 0);
        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, MethodNumber::from("sent"), 1);
    }

    /// Send message
    /// by emiting a `sent` event
    #[action]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        check(
            AccountsSvc::call().exists(receiver),
            &format!("receiver account {} doesn't exist", receiver),
        );
        let datetime = TransactSvc::call().currentBlock().time.seconds();
        Wrapper::emit()
            .history()
            .sent(get_sender(), receiver, subject, body, datetime);
    }

    /// Archive message
    /// by emiting an `archived` event
    #[action]
    fn archive(msg_id: u64) {
        let saved_messages_table = SavedMessageTable::new();
        if let Some(rec) = saved_messages_table.get_index_pk().get(&msg_id) {
            unsave(
                msg_id,
                rec.sender,
                rec.subject,
                rec.body,
                rec.datetime.seconds,
            );
        }

        Wrapper::emit()
            .history()
            .archive(get_sender().to_string() + &msg_id.to_string());
    }

    /// Save a message
    /// Events can be pruned by nodes. Since Chainmail relies on events to "store" messages,
    /// `save` copies a message into state where it can be stored indefinitely at the user's expense.
    #[action]
    fn save(
        msg_id: u64,
        receiver: AccountNumber,
        sender: AccountNumber,
        subject: String,
        body: String,
        datetime: i64,
    ) {
        check(
            get_sender() == receiver,
            &format!("only receiver of email can save it"),
        );

        let saved_messages_table = SavedMessageTable::new();
        saved_messages_table
            .put(&SavedMessage {
                msg_id,
                receiver,
                sender,
                subject,
                body,
                datetime: TimePointSec::from(datetime),
            })
            .unwrap();
    }

    /// Unsave a message
    /// `unsave` releases the state storage for a previously saved message
    #[action]
    fn unsave(msg_id: u64, sender: AccountNumber, subject: String, body: String, datetime: i64) {
        let saved_messages_table = SavedMessageTable::new();

        saved_messages_table.remove(&SavedMessage {
            msg_id,
            receiver: get_sender(),
            sender,
            subject,
            body,
            datetime: TimePointSec::from(datetime),
        });
    }

    #[event(history)]
    pub fn sent(
        sender: AccountNumber,
        receiver: AccountNumber,
        subject: String,
        body: String,
        datetime: TimePointSec,
    ) {
    }
    #[event(history)]
    pub fn archive(msg_id: String) {}

    use async_graphql::connection::Connection;
    struct Query;

    #[async_graphql::Object]
    impl Query {
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
    }

    /// Serve REST and GraphQL calls
    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_rest_api(&request))
    }
}
