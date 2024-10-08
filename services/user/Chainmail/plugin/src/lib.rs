#[allow(warnings)]
mod bindings;
mod errors;

use bindings::exports::chainmail::plugin::api::{Error, Guest as Api};
use bindings::exports::chainmail::plugin::queries::{Guest as Query, Message};
use bindings::host::common::server as CommonServer;
use bindings::transact::plugin::intf as Transact;
use errors::ErrorType::QueryResponseParseError;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use serde::Deserialize;

struct ChainmailPlugin;

#[derive(Debug, Deserialize)]
struct MessageSerde {
    msg_id: String,
    receiver: String,
    sender: String,
    subject: String,
    body: String,
}

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

impl Api for ChainmailPlugin {
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
        println!("action archive(event_id[{}]).top", event_id);
        Transact::add_action_to_transaction(
            "archive",
            &chainmail::action_structs::archive { event_id }.packed(),
        )?;
        Ok(())
    }
}

fn query_messages_endpoint(
    sender: Option<String>,
    receiver: Option<String>,
    archived_requested: bool,
) -> Result<Vec<Message>, Error> {
    println!(
        "query_messages_endpoint(sender[{}], receiver[{}]).top",
        if sender.is_some() {
            sender.clone().unwrap()
        } else {
            "".to_string()
        },
        if receiver.is_some() {
            receiver.clone().unwrap()
        } else {
            "".to_string()
        },
    );
    let mut endpoint = String::from("/api/messages?");
    if archived_requested {
        endpoint += "archived=true&";
    }
    if sender.is_some() {
        endpoint += &format!("sender={}", sender.clone().unwrap());
    }
    if sender.is_some() && receiver.is_some() {
        endpoint += "&";
    }
    if receiver.is_some() {
        endpoint += &format!("receiver={}", receiver.unwrap());
    }

    println!("plugin.endpoing: {}", endpoint);

    let resp = serde_json::from_str::<Vec<MessageSerde>>(&CommonServer::get_json(&endpoint)?);
    let mut resp_val: Vec<MessageSerde>;
    if resp.is_err() {
        return Err(errors::ErrorType::QueryResponseParseError.err(&resp.unwrap_err().to_string()));
    } else {
        resp_val = resp.unwrap();
    }
    println!("queried messages resp: {:#?}", resp_val);

    // There's a way to tell the bindgen to generate the rust types with custom attributes. Goes in cargo.toml.
    // Somewhere in the codebase is an example of doing this with serde serialize and deserialize attributes
    let messages: Vec<Message> = resp_val
        .into_iter()
        .map(|m| Message {
            msg_id: m
                .msg_id
                .parse::<u64>()
                .map_err(|err| QueryResponseParseError.err(&err.to_string()))
                .unwrap(),
            receiver: m.receiver,
            sender: m.sender,
            subject: m.subject,
            body: m.body,
        })
        .collect();
    println!("messages: {:#?}", messages);
    Ok(messages)
}

impl Query for ChainmailPlugin {
    fn get_msgs(sender: Option<String>, receiver: Option<String>) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, false)?)
    }

    fn get_archived_msgs(
        sender: Option<String>,
        receiver: Option<String>,
    ) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, true)?)
    }
}

bindings::export!(ChainmailPlugin with_types_in bindings);
