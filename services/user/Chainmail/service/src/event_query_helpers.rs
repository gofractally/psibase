use std::collections::HashMap;

use crate::helpers::validate_user;

use psibase::services::r_events::Wrapper as REventsSvc;

use psibase::{Hex, HttpReply, HttpRequest};

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut params: HashMap<String, String> = HashMap::new();

    let itr = query.split("&");
    for p in itr {
        let kv = p.split_once("=").unwrap();
        params.insert(kv.0.to_string(), kv.1.trim_start_matches('=').to_string());
    }
    params
}

fn build_query_by_id(params: HashMap<String, String>) -> Option<String> {
    if params.get("id").is_none() {
        return None;
    }
    // println!("param.id = {}", params.contains_key("id"));
    let msg_id = params.get("id")?;

    // let archived_msgs_query =     "SELECT DISTINCT sent.rowid as msg_id,                   sent.* FROM \"history.chainmail.sent\" AS sent INNER JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id";
    // let not_archvied_msgs_query = "SELECT DISTINCT sent.rowid as msg_id, archive.event_id, sent.* FROM \"history.chainmail.sent\" AS sent LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id WHERE event_id IS NULL";

    // Select from all sent emails *not archived* where receiver/send are as query params specify
    let select_clause =
        format!("DISTINCT sent.*, sent.rowid as msg_id, archive.msg_id as archived_msg_id ");
    let from_clause = format!("\"history.chainmail.sent\" AS sent LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archived_msg_id" );
    // let where_sent_archived = "CONCAT(sent.receiver, sent.rowid) = archived_msg_id";
    let where_rowid_equals = format!("sent.rowid = {}", msg_id);

    Some(format!(
        "SELECT {} FROM {} WHERE {}",
        select_clause, from_clause, where_rowid_equals
    ))
}

fn build_query_by_rcvr_sndr(params: HashMap<String, String>) -> Option<String> {
    println!("params: {:#?}", params);

    let mut s_clause = String::new();
    let s_opt = params.get("sender");
    // println!("sender: {:#?}", s_opt);
    if let Some(s) = s_opt {
        if !validate_user(s) {
            return None;
        }
        s_clause = format!("sender = '{}'", s);
    }

    let mut r_clause = String::new();
    let r_opt = params.get(&String::from("receiver"));
    // println!("receiver: {:#?}", r_opt);
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
    // println!("archived_requested: {}", archived_requested);

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
    // println!("where-clause: {}", where_clause_sender_receiver);

    // let archived_msgs_query =     "SELECT DISTINCT sent.rowid as msg_id,                   sent.* FROM \"history.chainmail.sent\" AS sent INNER JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id";
    // let not_archvied_msgs_query = "SELECT DISTINCT sent.rowid as msg_id, archive.event_id, sent.* FROM \"history.chainmail.sent\" AS sent LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id WHERE event_id IS NULL";

    // Select from all sent emails *not archived* where receiver/send are as query params specify
    let select_clause =
        format!("DISTINCT sent.*, sent.rowid as msg_id, archive.msg_id as archived_msg_id ");
    let from_clause = format!("\"history.chainmail.sent\" AS sent LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archived_msg_id" );
    let where_clause_archived_or_not = format!(
        "archived_msg_id IS {} NULL",
        if archived_requested { "NOT" } else { "" }
    );

    Some(format!(
        "SELECT {} FROM {} WHERE {} {} {} {}",
        select_clause,
        from_clause,
        where_clause_archived_or_not,
        if s_opt.is_some() || r_opt.is_some() {
            "AND"
        } else {
            ""
        },
        if params.contains_key("id") {
            format!("AND sent.rowid = {}", params.get("id")?)
        } else {
            String::from("")
        },
        where_clause_sender_receiver,
    ))
}

pub fn serve_rest_api(request: &HttpRequest) -> Option<HttpReply> {
    if request.method == "GET" {
        // println!("request.target = {}", request.target);
        if !request.target.starts_with("/api/messages") {
            return None;
        }

        let query_start = request.target.find('?');
        if query_start.is_none() {
            return None;
        }
        let query_start = query_start.unwrap();

        let query = request.target.split_at(query_start + 1).1;
        let params = parse_query(query);

        // HERE

        let sql_query_str = if params.get("id").is_some() {
            build_query_by_id(params)
        } else {
            build_query_by_rcvr_sndr(params)
        };

        let order_by_clause = "sent.ROWID";

        let sql_query_str = format!("{} ORDER BY {}", sql_query_str?, order_by_clause);
        println!("query: {}", sql_query_str);

        let query_response = REventsSvc::call().sqlQuery(sql_query_str);
        println!("query_response: {}", query_response);

        return Some(HttpReply {
            status: 200,
            contentType: String::from("application/json"),
            headers: vec![],
            body: Hex(query_response.as_bytes().to_vec()),
        });
    }
    return None;
}
