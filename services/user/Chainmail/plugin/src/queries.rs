use crate::{
    bindings::chainmail::plugin::types::Message,
    bindings::host::common::{server as CommonServer, types::Error},
    deser_structs::TempMessageForDeserialization,
    errors::ErrorType,
};

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
    )?);
    println!("serde parsed resp: {:?}", resp);
    let resp_val =
        resp.map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))?;
    println!("resp_val: {:?}", resp_val);

    // TODO: There's a way to tell the bindgen to generate the rust types with custom attributes. Goes in cargo.toml.
    // Somewhere in the codebase is an example of doing this with serde serialize and deserialize attributes
    Ok(resp_val.into_iter().map(|m| m.into()).collect())
}
