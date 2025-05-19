use crate::{
    bindings::{
        exports::chainmail::plugin::queries::Message,
        host::common::{server as CommonServer, types::Error},
    },
    errors::ErrorType::*,
    serde_structs::TempMessageForDeserEvents,
};

pub fn get_msg_by_id(msg_id: u64) -> Result<Message, Error> {
    let api_root = String::from("/api");

    let res = CommonServer::get_json(&format!("{}/messages?id={}", api_root, &msg_id.to_string()))?;

    let mut msgs = serde_json::from_str::<Vec<TempMessageForDeserEvents>>(&res)
        .map_err(|err| QueryResponseParseError(err.to_string()))?;

    if msgs.len() == 1 {
        // let msg = msgs.get(0).unwrap();
        let msg = msgs.pop().unwrap();
        return Ok(msg.into());
    } else {
        return Err(InvalidMsgId(msg_id.to_string()).into());
    }
}

pub fn query_messages_endpoint(
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

    let resp =
        serde_json::from_str::<Vec<TempMessageForDeserEvents>>(&CommonServer::get_json(&endpoint)?)
            .map_err(|err| QueryResponseParseError(err.to_string()))?;

    Ok(resp.into_iter().map(|m| m.into()).collect())
}
