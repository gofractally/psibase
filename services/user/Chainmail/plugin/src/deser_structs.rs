use psibase::TimePointSec;
use serde::{de, Deserialize};
use serde_aux::prelude::*;

use crate::bindings::chainmail::plugin::types::Message;

fn deserialize_timepoint<'d, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: de::Deserializer<'d>,
{
    Ok(TimePointSec::deserialize(deserializer)?.seconds)
}

#[derive(Clone, Debug, Deserialize)]
pub struct TempMessageForDeserialization {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    pub msg_id: u64,
    pub _archived_msg_id: Option<String>,
    pub receiver: String,
    pub sender: String,
    pub subject: String,
    pub body: String,
    #[serde(deserialize_with = "deserialize_timepoint")]
    pub datetime: u32,
}

impl Into<Message> for TempMessageForDeserialization {
    fn into(self) -> Message {
        Message {
            msg_id: self.msg_id,
            receiver: self.receiver,
            sender: self.sender,
            subject: self.subject,
            body: self.body,
            datetime: self.datetime,
        }
    }
}
