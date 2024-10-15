use psibase::Table;
use service::SavedMessagesTable;

mod event_query_helpers;
mod helpers;
mod tables;

pub fn dump_table() {
    let table_ref = SavedMessagesTable::new();
    let idx = table_ref.get_index_pk();
    println!("dump_table() SavedMessages:");
    for msg in idx.into_iter() {
        println!("action: dump_table: {:#?}", msg);
    }
}

#[psibase::service(recursive = true)]
mod service {
    use crate::dump_table;
    use crate::event_query_helpers::serve_rest_api;
    use crate::tables::SavedMessage;

    use psibase::services::accounts::Wrapper as AccountsSvc;
    use psibase::services::events::Wrapper as EventsSvc;
    use psibase::services::sites::Wrapper as SitesSvc;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        anyhow, check, create_schema, get_sender, AccountNumber, DbId, Fracpack, HttpReply,
        HttpRequest, MethodNumber, Table, TimePointSec, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    #[table(name = "SavedMessagesTable", record = "SavedMessage", index = 1)]
    pub struct SavedMessagesTable;

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        SitesSvc::call().enableSpa(true);

        EventsSvc::call().setSchema(create_schema::<Wrapper>());
        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, MethodNumber::from("sent"), 0);
        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, MethodNumber::from("sent"), 1);
    }

    #[action]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        check(
            AccountsSvc::call().exists(receiver),
            &format!("receiver account {} doesn't exist", receiver),
        );
        let datetime = TransactSvc::call().currentBlock().time;
        Wrapper::emit()
            .history()
            .sent(get_sender(), receiver, subject, body, datetime);

        dump_table();
    }

    #[action]
    fn archive(msg_id: u64) {
        let saved_messages_table = SavedMessagesTable::new();
        dump_table();

        if let Some(rec) = saved_messages_table.get_index_pk().get(&msg_id) {
            Wrapper::call().unsave(
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

        dump_table();
    }

    #[action]
    fn save(
        msg_id: u64,
        receiver: AccountNumber,
        sender: AccountNumber,
        subject: String,
        body: String,
        datetime: u32,
    ) {
        check(
            get_sender() == receiver,
            &format!("only receiver of email can save it"),
        );
        let saved_messages_table = SavedMessagesTable::new();

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

        dump_table();
    }

    #[action]
    fn unsave(msg_id: u64, sender: AccountNumber, subject: String, body: String, datetime: u32) {
        let saved_messages_table = SavedMessagesTable::new();

        saved_messages_table.remove(&SavedMessage {
            msg_id,
            receiver: get_sender(),
            sender,
            subject,
            body,
            datetime: TimePointSec::from(datetime),
        });

        dump_table();
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

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_rest_api(&request))
    }
}
