#[allow(warnings)]
mod bindings;
mod errors;

use bindings::chainmail::plugin::types::Message;
use bindings::exports::chainmail::plugin::api::{Error, Guest as Api};
use bindings::exports::chainmail::plugin::queries::Guest as Query;
use bindings::host::common::server as CommonServer;
use bindings::transact::plugin::intf as Transact;
use errors::ErrorType::{self, InvalidMsgId, QueryResponseParseError};
use psibase::fracpack::Pack;
use psibase::{get_sender, AccountNumber, TimePointSec};
use serde::Deserialize;

struct ChainmailPlugin;

#[derive(Clone, Debug, Deserialize)]
struct MessageSerde {
    msg_id: String,
    archived_msg_id: Option<String>,
    receiver: String,
    sender: String,
    subject: String,
    body: String,
    datetime: TimePointSec,
}

fn get_msg_by_id(msg_id: u64) -> Result<MessageSerde, Error> {
    let api_root = String::from("/api");
    println!("save(msg_id[{}]", msg_id);
    println!(
        "endpoing[{}]",
        &format!("{}/messages?id={}", api_root, &msg_id.to_string())
    );
    // look up message details via msg_id
    // let (sender, receiver, subject, body) = fetch.get(/rest/message by id);
    println!("get_sender(): {}", get_sender().to_string());
    println!("msg_id: {}", get_sender().to_string() + &msg_id.to_string());
    let res = CommonServer::get_json(&format!("{}/messages?id={}", api_root, &msg_id.to_string()))?;
    println!("{}", res);

    let msg = serde_json::from_str::<Vec<MessageSerde>>(&res).map_err(|err| {
        println!("err: {:#?}", err);
        ErrorType::QueryResponseParseError.err(err.to_string().as_str())
    })?;
    println!("Deserialization complete. msg: {:#?}", msg);

    if msg.len() == 1 {
        // TODO: make query return single record for id= param; no need for a vec here
        // save the message to state
        let msg = msg.get(0).unwrap();
        return Ok(msg.clone());
    } else {
        return Err(ErrorType::InvalidMsgId.err(&msg_id.to_string()));
    }
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

    fn archive(msg_id: u64) -> Result<(), Error> {
        // Verify receiver = get_sender() (so people can archive each others' messages)
        Transact::add_action_to_transaction(
            "archive",
            &chainmail::action_structs::archive { msg_id }.packed(),
        )?;
        Ok(())
    }

    fn save(msg_id: u64) -> Result<(), Error> {
        // let api_root = String::from("/api");
        // println!("save(msg_id[{}]", msg_id);
        // println!(
        //     "endpoing[{}]",
        //     &format!("{}/messages?id={}", api_root, &msg_id.to_string())
        // );
        // // look up message details via msg_id
        // // let (sender, receiver, subject, body) = fetch.get(/rest/message by id);
        // println!("get_sender(): {}", get_sender().to_string());
        // println!("msg_id: {}", get_sender().to_string() + &msg_id.to_string());
        // let res =
        //     CommonServer::get_json(&format!("{}/messages?id={}", api_root, &msg_id.to_string()))?;
        // println!("{}", res);

        // let msg = serde_json::from_str::<Vec<MessageSerde>>(&res).map_err(|err| {
        //     println!("err: {:#?}", err);
        //     ErrorType::QueryResponseParseError.err(err.to_string().as_str())
        // })?;
        // println!("Deserialization complete. msg: {:#?}", msg);

        // // TODO: make query return single record for id= param; no need for a vec here
        // // save the message to state
        // let msg = msg.get(0).unwrap();

        let msg = get_msg_by_id(msg_id)?;
        Transact::add_action_to_transaction(
            "save",
            &chainmail::action_structs::save {
                subject: msg.subject.clone(),
                body: msg.body.clone(),
                receiver: AccountNumber::from(msg.receiver.as_str()),
                msg_id: u64::from_str_radix(&msg.msg_id, 10)
                    .map_err(|err| ErrorType::QueryResponseParseError.err(&err.to_string()))?,
                sender: AccountNumber::from(msg.sender.as_str()),
                datetime: msg.datetime.seconds,
            }
            .packed(),
        )?;
        Ok(())
    }

    fn unsave(msg_id: u64) -> Result<(), Error> {
        let msg = get_msg_by_id(msg_id).unwrap();
        Transact::add_action_to_transaction(
            "save",
            &chainmail::action_structs::unsave {
                subject: msg.subject.clone(),
                body: msg.body.clone(),
                msg_id: u64::from_str_radix(&msg.msg_id, 10)
                    .map_err(|err| ErrorType::QueryResponseParseError.err(&err.to_string()))?,
                sender: AccountNumber::from(msg.sender.as_str()),
                datetime: msg.datetime.seconds,
            }
            .packed(),
        )?;
        Ok(())
    }

    // fn dump_table() -> Result<(), Error> {
    //     Transact::add_action_to_transaction(
    //         "dump_table",
    //         &chainmail::action_structs::dump_table {}.packed(),
    //     )?;
    //     Ok(())
    // }
}

fn query_messages_endpoint(
    sender: Option<String>,
    receiver: Option<String>,
    archived_requested: bool,
) -> Result<Vec<Message>, Error> {
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

    let resp = serde_json::from_str::<Vec<MessageSerde>>(&CommonServer::get_json(&endpoint)?);
    println!("resp: {:#?}", resp);
    let mut resp_val: Vec<MessageSerde>;
    if resp.is_err() {
        return Err(errors::ErrorType::QueryResponseParseError.err(&resp.unwrap_err().to_string()));
    } else {
        resp_val = resp.unwrap();
    }
    println!("resp_val: {:#?}", resp_val);

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
            datetime: m.datetime.seconds,
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
