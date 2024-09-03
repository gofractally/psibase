use std::collections::HashMap;

use psibase::services::accounts::Wrapper as AccountsSvc;
use psibase::services::r_events::Wrapper as REventsSvc;
use psibase::AccountNumber;
use psibase::HttpReply;
use psibase::HttpRequest;

fn validate_user(user: String) -> bool {
    let acc = AccountNumber::from(user.as_str());
    if acc.to_string() != user {
        return false;
    }

    AccountsSvc::call().exists(acc)
}

fn make_query(req: &HttpRequest, sql: &str) -> HttpRequest {
    return HttpRequest {
        host: req.host.clone(),
        rootHost: req.rootHost.clone(),
        method: String::from("POST"),
        target: String::from("/sql"),
        contentType: String::from("application/sql"),
        body: psibase::Hex(sql.as_bytes().to_vec()),
    };
}

fn parse_query(query: String) -> HashMap<String, String> {
    let mut params: HashMap<String, String> = HashMap::new();

    let itr = query.split("&");
    for p in itr {
        let idx = p.find("=").unwrap();
        let kv = p.split_at(idx);
        params.insert(kv.0.to_string(), kv.1.to_string());
    }
    params
}

fn serve_rest_api(request: &HttpRequest) -> Option<HttpReply> {
    if request.method == "GET" {
        if !request.target.starts_with("/messages") {
            return None;
        }

        let queryStart = request.target.find('?');
        if queryStart.is_none() {
            return None;
        }
        let queryStart = queryStart.unwrap();

        let query = request.target.split_at(queryStart + 1).1;
        let params = crate::parse_query(String::from(query));

        let mut s_clause = String::new();
        let s_opt = params.get(&String::from("sender"));
        if let Some(s) = s_opt {
            if !validate_user(String::from(s)) {
                return None;
            }
            s_clause = format!("sender = '{}'", s);
        }

        let mut r_clause = String::new();
        let r_opt = params.get(&String::from("receiver"));
        if let Some(r) = r_opt {
            if !validate_user(String::from(r)) {
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
            where_clause += " AND WHERE ";
        }
        if r_opt.is_some() {
            where_clause += r_clause.as_str();
        }

        return REventsSvc::call().serveSys(make_query(
            request,
            format!(
                "SELECT * FROM \"history.webmail.sent\" {} ORDER BY ROWID",
                where_clause
            )
            .as_str(),
        ));
    }
    return None;
}

#[psibase::service]
mod service {
    use async_graphql::{Object, SimpleObject};
    use psibase::{
        anyhow, check, get_sender, get_service, serve_content, serve_graphiql, serve_graphql,
        serve_simple_ui, services, store_content, AccountNumber, Fracpack, HexBytes, HttpReply,
        HttpRequest, SingletonKey, Table, ToSchema, WebContentRow,
    };
    use serde::{Deserialize, Serialize};

    use crate::{serve_rest_api, validate_user};

    // #[table(name = "InitTable")]
    // #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    // pub struct Init {
    //     inited: bool,
    // }

    // impl Init {
    //     #[primary_key]
    //     fn by_key(&self) -> SingletonKey {
    //         SingletonKey {}
    //     }
    // }

    // impl Default for Init {
    //     fn default() -> Self {
    //         Init { inited: false }
    //     }
    // }

    #[table(record = "WebContentRow")]
    struct WebContentTable;

    #[action]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        check(
            validate_user(receiver.to_string()),
            &format!("receiver account {} doesn't exist", receiver),
        );
        Wrapper::emit()
            .history()
            .sent(get_sender(), receiver, subject, body);
    }

    #[event(history)]
    pub fn sent(sender: AccountNumber, receiver: AccountNumber, subject: String, body: String) {}

    // struct Query;

    // #[Object]
    // impl Query {
    //     async fn getMessages(&self) -> async_graphql::Result<Vec<Message>>, async_graphql::Error> {
    //         // let curr_val = InitTable::new().get_index_pk().get(&SingletonKey {});
    //         // Ok(match curr_val {
    //         //     Some(val) => val.name,
    //         //     None => String::from("psibase"),
    //         // })
    //         Ok(String::from("placeholder"))
    //     }
    // }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_rest_api(&request))
            // .or_else(|| serve_graphql(&request, Query))
            // .or_else(|| serve_graphiql(&request))
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
