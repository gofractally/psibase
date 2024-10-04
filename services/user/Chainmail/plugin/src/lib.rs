#[allow(warnings)]
mod bindings;

use bindings::exports::chainmail::plugin::api::{Error, Guest as API};
use bindings::exports::chainmail::plugin::queries::{Guest as QUERY, Message};
use bindings::host;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::{BodyTypes, PostRequest};
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::AccountNumber;

struct ChainmailPlugin;

fn build_query(
    archived_requested: bool,
    sender: Option<String>,
    receiver: Option<String>,
) -> String {
    let where_clause_sender_receiver = String::from("");

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
        if sender.is_some() || receiver.is_some() {
            "AND"
        } else {
            ""
        },
        where_clause_sender_receiver,
        order_by_clause
    );
    sql_query_str
}

impl API for ChainmailPlugin {
    fn send(receiver: String, subject: String, body: String) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "send",
            &chainmail::action_structs::send {
                receiver: AccountNumber::from(receiver.as_str()),
                subject,
                body,
            }
            .packed(),
        )?;
        Ok(())
    }

    fn archive(event_id: u64) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "archive",
            &chainmail::action_structs::archive { event_id }.packed(),
        )?;
        Ok(())
    }
}

impl QUERY for ChainmailPlugin {
    fn get_msgs(sender: Option<String>, receiver: Option<String>) -> Result<Vec<Message>, Error> {
        println!(
            "get_msgs(sender[{}], receiver[{}]).top",
            sender.clone().unwrap(),
            receiver.clone().unwrap()
        );
        // let archived_requested = false;
        // let sql_query_str = build_query(archived_requested, sender, receiver);
        // println!("sql_query_str: {}", sql_query_str);
        // need to call add_transaction(); can't call call() (not in a service)
        // use host::server to call .get(<http>)
        // let resp = REventsSvc::call().sqlQuery(sql_query_str);
        // println!("response: {}", resp);
        // let query_result = CommonServer::post(&PostRequest {
        //     endpoint: String::from("/sql"),
        //     body: BodyTypes::Json(sql_query_str),
        // });

        let resp = host::common::server::get_json(&format!(
            "/api/messages?sender={}&receiver={}",
            sender.unwrap(),
            receiver.unwrap()
        ));
        println!("inbox resp: {:#?}", resp);
        Ok(vec![])

        // println!("query_results: {:#?}", query_result);
        // let results = query_result.unwrap();
        // println!("results: {}", results);
        // Ok(vec![])
    }

    fn get_archived_msgs(
        sender: Option<String>,
        receiver: Option<String>,
    ) -> Result<Vec<Message>, Error> {
        println!("get_archived_msgs TWO ().top");
        // let archived_requested = true;
        // let sql_query_str = build_query(archived_requested, sender, receiver);
        // println!("sql_query_str: {}", sql_query_str);
        // // need to call add_transaction(); can't call call() (not in a service)
        // // use host::server to call .get(<http>)
        // // let resp = REventsSvc::call().sqlQuery(sql_query_str);
        // // println!("response: {}", resp);

        // let endpoint = CommonServer::getSiblingUrl();
        // let query_result = CommonServer::post(&PostRequest {
        //     endpoint: endpoint + "/sql",
        //     body: BodyTypes::Json(sql_query_str),
        // });
        // println!("query_results: {:#?}", query_result);
        // let results = query_result.unwrap();
        // println!("results: {}", results);
        // Ok(vec![])

        let resp = host::common::server::get_json(&format!(
            "/api/messages?archived=true&sender={}&receiver={}",
            sender.unwrap(),
            receiver.unwrap()
        ));
        println!("archived resp: {:#?}", resp);
        Ok(vec![])
    }
}

bindings::export!(ChainmailPlugin with_types_in bindings);
