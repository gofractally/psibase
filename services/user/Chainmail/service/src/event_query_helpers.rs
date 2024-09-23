use std::collections::HashMap;

use crate::helpers::validate_user;

use psibase::services::r_events::Wrapper as REventsSvc;

use psibase::{HttpReply, HttpRequest};

fn make_query(req: &HttpRequest, sql: String) -> HttpRequest {
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

fn get_where_clause_from_sender_receiver_params(params: HashMap<String, String>) -> Option<String> {
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

    Some(where_clause)
}

pub fn serve_rest_api(request: &HttpRequest) -> Option<HttpReply> {
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
        let params = parse_query(query);

        let where_clause: String;
        let mq: HttpRequest;
        // handle id param requests (for specific message)
        if params.contains_key("id") {
            where_clause = format!("WHERE CONCAT(receiver, rowid) = {}", params.get("id")?);

            mq = make_query(
                request,
                format!(
                    "SELECT *
                    FROM \"history.chainmail.sent\" {} ORDER BY ROWID",
                    where_clause
                ),
            );
        // handle receiver or sender param requests
        } else {
            where_clause = get_where_clause_from_sender_receiver_params(params)?;

            mq = make_query(
                request,
                format!("SELECT *
                    FROM \"history.chainmail.sent\" AS sent
                    LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id {} ORDER BY ROWID", where_clause),
            );
        }
        return REventsSvc::call().serveSys(mq);
    }
    return None;
}
