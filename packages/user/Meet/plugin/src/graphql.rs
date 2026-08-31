use crate::bindings::host::common::server as CommonServer;
use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ResponseRoot<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserKeyData {
    user_key: Option<UserKeyNode>,
}

#[derive(Debug, Deserialize)]
pub struct UserKeyNode {
    #[allow(dead_code)]
    pub user: String,
    pub key: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeetingData {
    meeting: Option<MeetingNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingNode {
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub host: String,
    pub key_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembersData {
    meeting_members: Connection<MemberNode>,
}

#[derive(Debug, Deserialize)]
struct Connection<T> {
    nodes: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberNode {
    #[allow(dead_code)]
    pub meeting_id: String,
    pub account: String,
    pub wrap: Vec<u8>,
}

pub fn fetch_user_key(account: &str) -> Result<Option<Vec<u8>>, Error> {
    let query = format!(
        r#"query {{ userKey(account: "{account}") {{ user key }} }}"#,
        account = account
    );
    let root: ResponseRoot<UserKeyData> =
        serde_json::from_str(&CommonServer::post_graphql_get_json(&query)?)
            .map_err(|e| ErrorType::QueryResponseParseError(e.to_string()))?;
    Ok(root.data.user_key.map(|node| node.key))
}

pub fn fetch_meeting(id: &str) -> Result<MeetingNode, Error> {
    let query = format!(
        r#"query {{ meeting(id: "{id}") {{ id host keyHash }} }}"#,
        id = id
    );
    let root: ResponseRoot<MeetingData> =
        serde_json::from_str(&CommonServer::post_graphql_get_json(&query)?)
            .map_err(|e| ErrorType::QueryResponseParseError(e.to_string()))?;
    root.data
        .meeting
        .ok_or_else(|| ErrorType::MeetingNotFound.into())
}

pub fn fetch_members(meeting_id: &str) -> Result<Vec<MemberNode>, Error> {
    let query = format!(
        r#"query {{ meetingMembers(meetingId: "{id}", first: 100) {{ nodes {{ meetingId account wrap }} }} }}"#,
        id = meeting_id
    );
    let root: ResponseRoot<MembersData> =
        serde_json::from_str(&CommonServer::post_graphql_get_json(&query)?)
            .map_err(|e| ErrorType::QueryResponseParseError(e.to_string()))?;
    Ok(root.data.meeting_members.nodes)
}
