use std::collections::HashMap;

use psibase::services::accounts::Wrapper as AccountsSvc;
use psibase::services::r_events::Wrapper as REventsSvc;
use psibase::AccountNumber;
use psibase::HttpReply;
use psibase::HttpRequest;

fn validate_user(user: &str) -> bool {
    let acc = AccountNumber::from(user);
    if acc.to_string() != user {
        return false;
    }

    AccountsSvc::call().exists(acc)
}

fn make_query(req: &HttpRequest, sql: String) -> HttpRequest {
    //events.psibase.???
    return HttpRequest {
        host: req.host.clone(),
        rootHost: req.rootHost.clone(),
        method: String::from("POST"),
        target: String::from("/sql"),
        contentType: String::from("application/sql"),
        body: sql.into(),
    };
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut params: HashMap<String, String> = HashMap::new();

    let itr = query.split("&");
    for p in itr {
        let kv = p.split_once("=").unwrap();
        params.insert(kv.0.to_string(), kv.1.trim_start_matches('=').to_string());
    }
    params
}

fn serve_rest_api(request: &HttpRequest) -> Option<HttpReply> {
    if request.method == "GET" {
        if !request.target.starts_with("/messages") {
            return None;
        }

        let query_start = request.target.find('?');
        if query_start.is_none() {
            return None;
        }
        let query_start = query_start.unwrap();

        let query = request.target.split_at(query_start + 1).1;
        let params = crate::parse_query(query);

        let mut s_clause = String::new();
        let s_opt = params.get("sender");
        if let Some(s) = s_opt {
            if !validate_user(s) {
                return None;
            }
            s_clause = format!("sender = '{}'", s);
        }

        let mut r_clause = String::new();
        let r_opt = params.get(&String::from("receiver"));
        if let Some(r) = r_opt {
            if !validate_user(r) {
                return None;
            }
            r_clause = format!("receiver = '{}'", r);
        }

        if s_opt.is_none() && r_opt.is_none() {
            return None;
        }

        let archived_requested = match params.get(&String::from("archived")) {
            Some(arch) => arch == "true",
            None => false,
        };

        let mut where_clause_sender_receiver: String = String::from("");
        if s_opt.is_some() {
            where_clause_sender_receiver += s_clause.as_str();
        }
        if s_opt.is_some() && r_opt.is_some() {
            where_clause_sender_receiver += " AND ";
        }
        if r_opt.is_some() {
            where_clause_sender_receiver += r_clause.as_str();
        }

        /* TASKS
         * x- clean this up so chainmail shows sent/received messages instead of []
         * x- send a couple of archive actions so 'alice test 2' and 'bob test 1' are archived
         * x- tweak this sql until I can retrieve archived an not archived messages properly
         */

        // let archived_msgs_query =     "SELECT DISTINCT sent.rowid as msg_id,                   sent.* FROM \"history.chainmail.sent\" AS sent INNER JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id";
        // let not_archvied_msgs_query = "SELECT DISTINCT sent.rowid as msg_id, archive.event_id, sent.* FROM \"history.chainmail.sent\" AS sent LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id WHERE event_id IS NULL";

        // Select from all sent emails *not archived* where receiver/send are as query params specify
        let select_clause = format!("DISTINCT sent.rowid as msg_id, archive.event_id, sent.*");
        let from_clause = format!("\"history.chainmail.sent\" AS sent LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id" );
        let where_clause_archived_or_not = format!(
            "archive.event_id IS {} NULL",
            if archived_requested { "NOT" } else { "" }
        );
        let order_by_clause = "sent.ROWID";

        let sql_query_str = format!(
            "SELECT {} FROM {} WHERE {} {} {} ORDER BY {}",
            select_clause,
            from_clause,
            where_clause_archived_or_not,
            if s_opt.is_some() || r_opt.is_some() {
                "AND"
            } else {
                ""
            },
            where_clause_sender_receiver,
            order_by_clause
        );

        let mq = make_query(request, sql_query_str.clone());

        println!("query: {}", sql_query_str);

        return REventsSvc::call().serveSys(mq);
    }
    return None;
}

#[psibase::service]
mod service {

    use psibase::*;
    use serde::{Deserialize, Serialize};
    use services::accounts::Wrapper as AccountsSvc;
    use services::events::Wrapper as EventsSvc;
    use services::sites::Wrapper as SitesSvc;

    use crate::serve_rest_api;

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
    fn archive(event_id: u64) {
        Wrapper::emit()
            .history()
            .archive(get_sender().to_string() + &event_id.to_string());
    }

    #[event(history)]
    pub fn sent(sender: AccountNumber, receiver: AccountNumber, subject: String, body: String) {}
    #[event(history)]
    pub fn archive(event_id: String) {}

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_rest_api(&request))
            .or_else(|| serve_simple_ui::<Wrapper>(&request))
    }
}
