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
    return HttpRequest {
        host: req.host.clone(),
        rootHost: req.rootHost.clone(),
        method: String::from("POST"),
        target: String::from("/sql"),
        contentType: String::from("application/sql"),
        body: sql.into(),
        headers: vec![],
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

        let mut where_clause: String = String::from("WHERE ");
        if s_opt.is_some() {
            where_clause += s_clause.as_str();
        }
        if s_opt.is_some() && r_opt.is_some() {
            where_clause += " AND ";
        }
        if r_opt.is_some() {
            where_clause += r_clause.as_str();
        }

        let mq = make_query(
            request,
            format!(
                "SELECT * FROM \"history.chainmail.sent\" {} ORDER BY ROWID",
                where_clause
            ),
        );
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
        check(
            table.get_index_pk().get(&()).is_none(),
            "Service already initialized",
        );
        table.put(&InitRow {}).unwrap();

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

    #[event(history)]
    pub fn sent(sender: AccountNumber, receiver: AccountNumber, subject: String, body: String) {}

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_rest_api(&request))
            .or_else(|| serve_simple_ui::<Wrapper>(&request))
    }
}
