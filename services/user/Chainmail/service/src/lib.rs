mod event_query_helpers;
mod helpers;
mod tables;

#[psibase::service]
mod service {
    use crate::event_query_helpers::serve_rest_api;
    use crate::tables::SavedMessage;
    use psibase::services::accounts::Wrapper as AccountsSvc;
    use psibase::{
        anyhow, check, get_sender, get_service, serve_content, serve_simple_ui, store_content,
        AccountNumber, HexBytes, HttpReply, HttpRequest, Table, WebContentRow,
    };

    #[table(name = "SavedMessagesTable", record = "SavedMessage")]
    struct SavedMessagesTable;

    #[table(record = "WebContentRow", index = 1)]
    struct WebContentTable;

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
    fn archive(event_id: u64) {
        Wrapper::emit()
            .history()
            .archive(get_sender().to_string() + &event_id.to_string());
    }

    #[action]
    fn save(event_id: u64, sender: AccountNumber, subject: String, body: String) {
        let saved_messages_table = SavedMessagesTable::new();

        saved_messages_table
            .put(&SavedMessage {
                event_id,
                sender,
                subject,
                body,
            })
            .unwrap();
        ()
    }

    #[action]
    fn unsave(event_id: u64, sender: AccountNumber, subject: String, body: String) {
        let saved_messages_table = SavedMessagesTable::new();

        saved_messages_table.remove(&SavedMessage {
            event_id,
            sender,
            subject,
            body,
        })
    }

    #[event(history)]
    pub fn sent(sender: AccountNumber, receiver: AccountNumber, subject: String, body: String) {}
    #[event(history)]
    pub fn archive(event_id: String) {}

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_rest_api(&request))
            .or_else(|| serve_simple_ui::<Wrapper>(&request))
    }

    #[action]
    #[allow(non_snake_case)]
    fn storeSys(path: String, contentType: String, content: HexBytes) {
        check(get_sender() == get_service(), "unauthorized");
        let table = WebContentTable::new();
        store_content(path, contentType, content, &table).unwrap();
    }
}
