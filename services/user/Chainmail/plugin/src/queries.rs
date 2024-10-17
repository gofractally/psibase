use crate::{
    bindings::exports::chainmail::plugin::queries::Message,
    bindings::host::common::{server as CommonServer, types::Error},
    errors::ErrorType,
    serde_structs::TempMessageForDeserialization,
};

pub fn get_msg_by_id(msg_id: u64) -> Result<TempMessageForDeserialization, Error> {
    let api_root = String::from("/api");

    let res = CommonServer::get_json(&format!("{}/messages?id={}", api_root, &msg_id.to_string()))?;

    let msg = serde_json::from_str::<Vec<TempMessageForDeserialization>>(&res)
        .map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))?;

    if msg.len() == 1 {
        let msg = msg.get(0).unwrap();
        return Ok(msg.clone());
    } else {
        return Err(ErrorType::InvalidMsgId.err(&msg_id.to_string()));
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

    let resp = serde_json::from_str::<Vec<TempMessageForDeserialization>>(&CommonServer::get_json(
        &endpoint,
    )?)
    .map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))?;

    Ok(resp.into_iter().map(|m| m.into()).collect())
}
