//! Chainmail Plugin: Basic Chainmail API
//!
//! Provides a convenient API for interacting with Chainmail, a simple email-like client.

#[allow(warnings)]
mod bindings;
mod errors;
mod queries;
mod serde_structs;

use bindings::accounts::plugin::accounts as AccountPlugin;
use bindings::exports::chainmail::plugin::{
    api::{Error, Guest as Api},
    queries::{Guest as Query, Message},
};
use bindings::host::common::server as CommonServer;
use bindings::transact::plugin::intf as Transact;
use chrono::DateTime;
use errors::ErrorType;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use queries::{get_msg_by_id, query_messages_endpoint};
use serde_structs::TempMessageForDeserialization;

/// Struct that implements the Api as well as the Query interfaces
struct ChainmailPlugin;

fn get_u32_unix_time_from_iso8601_str(dt_str: String) -> Result<u32, Error> {
    let dt_i64 = DateTime::parse_from_str(dt_str.as_str(), "%+")
        .map_err(|e| ErrorType::DateTimeConversion.err(e.to_string().as_str()))?
        .timestamp();
    if dt_i64 >= 0 && dt_i64 < u32::MAX as i64 {
        return Ok(dt_i64 as u32);
    } else {
        return Err(ErrorType::DateTimeConversion.err(dt_str.as_str()));
    };
}

impl Api for ChainmailPlugin {
    /// Send a message
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
        Transact::add_action_to_transaction(
            "archive",
            &chainmail::action_structs::archive { msg_id }.packed(),
        )?;
        Ok(())
    }

    fn save(msg_id: u64) -> Result<(), Error> {
        let msg = get_msg_by_id(msg_id)?;

        Transact::add_action_to_transaction(
            "save",
            &chainmail::action_structs::save {
                subject: msg.subject,
                body: msg.body,
                receiver: AccountNumber::from(msg.receiver.as_str()),
                msg_id: msg.msg_id,
                sender: AccountNumber::from(msg.sender.as_str()),
                datetime: get_u32_unix_time_from_iso8601_str(msg.datetime)?,
            }
            .packed(),
        )?;
        Ok(())
    }
}

// use serde::de::{self, Visitor};
// use std::fmt;

// impl<'de> Visitor<'de> for Message {
//     type Value = i32;

//     fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
//         formatter.write_str("message fields")
//     }

//     fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
//     where
//         E: de::Error,
//     {
//         Ok(value)
//     }

//     fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
//     where
//         E: de::Error,
//     {
//         Ok(value)
//     }
// }

// impl<'de> Deserializer<'de> for Message {
//     fn from_str<'a, T>(s: &'a str) -> Result<T, E>
//     where
//         T: Deserialize<'a>,
//     {
//         let mut deserializer = Message::from_str(s);
//         let t = T::deserialize(&mut deserializer)?;
//         if deserializer.input.is_empty() {
//             Ok(t)
//         } else {
//             Err(Error::TrailingCharacters)
//         }
//     }
// }

// impl<'de> Deserialize<'de> for Message {
//     fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
//     where
//         D: serde::Deserializer<'de>,
//     {
//         // deserializer.deserialize_struct(name, fields, visitor)
//         // fails because it consumes the deserializer, leaving nothing for the later fields
//         // deserializer.deserialize_struct(name, fields, visitor)
//         let msg_id = u64::deserialize(deserializer)?;
//         let receiver = String::deserialize(deserializer)?;
//         let sender = String::deserialize(deserializer)?;
//         let subject = String::deserialize(deserializer)?;
//         let body = String::deserialize(deserializer)?;
//         let datetime = TimePointSec::deserialize(deserializer)?.seconds;

//         Ok(Message {
//             msg_id,
//             receiver,
//             sender,
//             subject,
//             body,
//             datetime,
//         })
//     }
// }

impl Query for ChainmailPlugin {
    /// Retrieve non-archived messages
    /// - Messages can be filtered by one or both of sender and/or receiver
    fn get_msgs(sender: Option<String>, receiver: Option<String>) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, false)?)
    }

    /// Retrieve archived messages
    /// - Messages can be filtered by one or both of sender and/or receiver
    fn get_archived_msgs(
        sender: Option<String>,
        receiver: Option<String>,
    ) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, true)?)
    }

    /// Retrieve saved messages
    fn get_saved_msgs(receiver: Option<String>) -> Result<Vec<Message>, Error> {
        let rcvr = match receiver {
            Some(r) => r,
            None => AccountPlugin::get_logged_in_user()?.expect("No receiver specified"),
        };
        let graphql_str = format!(
            "query {{ getSavedMsgs(receiver:\"{}\") {{ msgId, receiver, sender, subject, body, datetime {{ seconds }} }} }}",
            rcvr
        );

        let summary_val = serde_json::from_str::<Vec<TempMessageForDeserialization>>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        )
        .map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))?;

        Ok(summary_val.into_iter().map(|m| m.into()).collect())
    }
}

bindings::export!(ChainmailPlugin with_types_in bindings);
