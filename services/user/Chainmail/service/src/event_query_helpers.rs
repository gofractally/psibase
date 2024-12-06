use std::collections::HashMap;

use crate::helpers::validate_user;

use psibase::services::r_events::Wrapper as REventsSvc;
use psibase::{Hex, HttpReply, HttpRequest};

fn build_query_by_id(params: HashMap<String, String>) -> Option<String> {
    if params.get("id").is_none() {
        return None;
    }
    let msg_id = params.get("id")?;

    let select_clause =
        format!("DISTINCT sent.*, sent.rowid as msg_id, archive.msg_id as archived_msg_id ");
    let from_clause = format!("\"history.chainmail.sent\" AS sent LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archived_msg_id" );
    let where_rowid_equals = format!("sent.rowid = {}", msg_id);

    Some(format!(
        "SELECT {} FROM {} WHERE {}",
        select_clause, from_clause, where_rowid_equals
    ))
}

fn build_query_by_rcvr_sndr(params: HashMap<String, String>) -> Option<String> {
    let mut s_clause = String::new();
    let s_opt = params.get("sender");
    if let Some(s) = s_opt {
        if !validate_user(s) {
            return None;
        }
        s_clause = format!("sender = '{}'", s);
    }

    let mut r_clause = String::new();
    let r_opt = params.get("receiver");
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
        if params.contains_key("id") {
            format!("AND sent.rowid = {}", params.get("id")?)
        } else {
            String::from("")
        },
        if s_opt.is_some() || r_opt.is_some() {
            "AND"
        } else {
            ""
        },
        where_clause_sender_receiver,
    ))
}

pub fn serve_rest_api(request: &HttpRequest) -> Option<HttpReply> {
    if request.method == "GET" {
        if request.path() != "/api/messages" {
            return None;
        }

        let params = request.query();

        let sql_query_str = if params.get("id").is_some() {
            build_query_by_id(params)
        } else {
            build_query_by_rcvr_sndr(params)
        };

        let order_by_clause = "sent.ROWID";

        let sql_query_str = format!("{} ORDER BY {}", sql_query_str?, order_by_clause);

        let query_response = REventsSvc::call().sqlQuery(sql_query_str);

        return Some(HttpReply {
            status: 200,
            contentType: String::from("application/json"),
            headers: vec![],
            body: Hex(query_response.as_bytes().to_vec()),
        });
    }
    return None;
}
