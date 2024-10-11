mod event_query_helpers;
mod helpers;
mod tables;

#[psibase::service]
mod service {
    use crate::event_query_helpers::serve_rest_api;
    use crate::tables::SavedMessage;

    use psibase::services::accounts::Wrapper as AccountsSvc;
    use psibase::services::events::Wrapper as EventsSvc;
    use psibase::services::sites::Wrapper as SitesSvc;
    use psibase::{
        anyhow, check, create_schema, get_sender, AccountNumber, DbId, Fracpack, HttpReply,
        HttpRequest, MethodNumber, Table, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    #[table(name = "SavedMessagesTable", record = "SavedMessage", index = 1)]
    struct SavedMessagesTable;

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
        Wrapper::emit()
            .history()
            .sent(get_sender(), receiver, subject, body);
    }

    #[action]
    fn archive(msg_id: u64) {
        Wrapper::emit()
            .history()
            .archive(get_sender().to_string() + &msg_id.to_string());
    }

    #[action]
    fn save(
        msg_id: u64,
        receiver: AccountNumber,
        sender: AccountNumber,
        subject: String,
        body: String,
    ) {
        check(
            get_sender() == receiver,
            &format!("only receiver of email can save it"),
        );
        let saved_messages_table = SavedMessagesTable::new();

        saved_messages_table
            .put(&SavedMessage {
                msg_id,
                sender,
                subject,
                body,
            })
            .unwrap();
        ()
    }

    #[action]
    fn unsave(msg_id: u64, sender: AccountNumber, subject: String, body: String) {
        let saved_messages_table = SavedMessagesTable::new();

        saved_messages_table.remove(&SavedMessage {
            msg_id,
            sender,
            subject,
            body,
        })
    }

    #[event(history)]
    pub fn sent(sender: AccountNumber, receiver: AccountNumber, subject: String, body: String) {}
    #[event(history)]
    pub fn archive(msg_id: String) {}

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_rest_api(&request))
    }
}
