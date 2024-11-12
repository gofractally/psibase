use chrono::DateTime;
use psibase::TimePointSec;
use serde::{de, Deserialize};
use serde_aux::prelude::*;
use std::cmp::Ordering;

use crate::bindings::exports::chainmail::plugin::queries::Message;

impl PartialEq for Message {
    fn eq(&self, other: &Self) -> bool {
        self.msg_id == other.msg_id
    }
}

impl Eq for Message {}

impl PartialOrd for Message {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        self.msg_id.partial_cmp(&other.msg_id)
    }
}

impl Ord for Message {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        if self.msg_id < other.msg_id {
            Ordering::Less
        } else if self.msg_id == other.msg_id {
            Ordering::Equal
        } else {
            Ordering::Greater
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
pub struct TempMessageForDeserEvents {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    pub msg_id: u64,
    pub receiver: String,
    pub sender: String,
    pub subject: String,
    pub body: String,
    #[serde(deserialize_with = "deserialize_timepoint")]
    pub datetime: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[allow(non_snake_case)]
pub struct TempMessageForDeserGql {
    #[serde(deserialize_with = "deserialize_number_from_string")]
    pub msgId: u64,
    pub receiver: String,
    pub sender: String,
    pub subject: String,
    pub body: String,
    #[serde(deserialize_with = "deserialize_timepoint")]
    pub datetime: u32,
}
#[derive(Debug, Deserialize)]
pub struct TempMessageForDeserGqlResponseNodes {
    pub nodes: Vec<TempMessageForDeserGql>,
}
#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
pub struct TempMessageForDeserGqlResponseData {
    pub getSavedMsgs: TempMessageForDeserGqlResponseNodes,
}
#[derive(Debug, Deserialize)]
pub struct TempMessageForDeserGqlResponse {
    pub data: TempMessageForDeserGqlResponseData,
}

fn deserialize_timepoint<'d, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: de::Deserializer<'d>,
{
    Ok(TimePointSec::deserialize(deserializer)?.seconds)
}

impl Into<Message> for TempMessageForDeserEvents {
    fn into(self) -> Message {
        Message {
            msg_id: self.msg_id,
            receiver: self.receiver,
            sender: self.sender,
            subject: self.subject,
            body: self.body,
            datetime: DateTime::from_timestamp(self.datetime as i64, 0)
                .unwrap()
                .to_string(),
            is_saved_msg: false,
        }
    }
}

impl Into<Message> for TempMessageForDeserGql {
    fn into(self) -> Message {
        Message {
            msg_id: self.msgId,
            receiver: self.receiver,
            sender: self.sender,
            subject: self.subject,
            body: self.body,
            datetime: DateTime::from_timestamp(self.datetime as i64, 0)
                .unwrap()
                .to_string(),
            is_saved_msg: false,
        }
    }
}
