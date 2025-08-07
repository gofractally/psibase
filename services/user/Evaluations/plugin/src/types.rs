use crate::bindings::aes::plugin as Aes;
use crate::bindings::*;
use crate::graphql::fetch_group_proposals;
use crate::helpers::parse_account_number;
use crate::{errors::ErrorType::*, Error};

use crate::Actions;
use base64::plugin::standard as Base64;
use host::common::types as CommonTypes;
use psibase::{
    fracpack::{Pack, Unpack},
    AccountNumber,
};
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use transact::plugin::intf::add_action_to_transaction;

pub trait TryParseGqlResponse: Sized {
    fn from_gql(s: String) -> Result<Self, CommonTypes::Error>;
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ResponseRoot<T> {
    pub data: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetEvaluation {
    #[serde(rename = "getEvaluation")]
    pub details: Option<EvalDetails>,
}
impl TryFrom<String> for GetEvaluation {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<GetEvaluation> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("GetEvaluationResponse: {}", e)))?;

        Ok(response_root.data)
    }
}

#[derive(Deserialize, Pack, Unpack, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    user: String,
    message_id: u64,
    encrypted: Vec<u8>,
    decrypted: Option<Vec<u8>>,
}

#[derive(Deserialize, Pack, Unpack, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserProposals {
    pub proposals: Vec<Message>,
}

#[derive(Deserialize, Pack, Unpack, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserDetail {
    pub user: String,
    pub encrypted_message: Option<Vec<u8>>,
    pub decryption_pubkey: Option<Vec<u8>>,
    pub attestation: Option<Vec<u8>>,
}

#[derive(Pack, Unpack, Debug, Default, Clone, Deserialize)]
pub struct SymmetricKeyPassword {
    pub password: [u8; 32],
    pub salt: String,
}

impl SymmetricKeyPassword {
    fn hash(password: [u8; 32]) -> String {
        let pw_hash = Sha256::digest(password.to_vec());
        Base64::encode(&pw_hash)
    }

    pub fn new(password: [u8; 32], salt: Vec<u8>, hash: String) -> Result<Self, Error> {
        if Self::hash(password) != hash {
            return Err(KeyMismatch.into());
        }

        Ok(Self {
            password,
            salt: Base64::encode(&salt),
        })
    }
}

#[derive(Deserialize, Pack, Unpack, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvalGroup {
    owner: AccountNumber,
    evaluation_id: u32,

    pub group_id: u32,
    pub key_decrypt_info: Option<KeyDetails>,
    pub users: Vec<UserDetail>,
    pub sym_key_password: Option<SymmetricKeyPassword>,
}

impl EvalGroup {
    pub fn get_user_cipher(&self, user: &str) -> Result<&Vec<u8>, Error> {
        let cipher = self
            .users
            .iter()
            .find(|&s| &s.user == user)
            .map(|s| {
                s.encrypted_message
                    .as_ref()
                    .expect("User was not given an encrypted message")
            })
            .unwrap();
        Ok(cipher)
    }

    pub fn create_message_group(&self, password: &[u8; 32]) -> Result<(), Error> {
        let payloads = self
            .users
            .iter()
            .map(|user| {
                let user_pub = user.decryption_pubkey.as_ref().unwrap();
                ecies::encrypt(user_pub, password).unwrap()
            })
            .collect::<Vec<_>>();

        add_action_to_transaction(
            Actions::group_key::ACTION_NAME,
            &Actions::group_key {
                owner: self.owner,
                evaluation_id: self.evaluation_id,
                keys: payloads,
                hash: SymmetricKeyPassword::hash(*password),
            }
            .packed(),
        )?;

        Ok(())
    }

    pub fn propose(&mut self, proposal: &[u8]) -> Result<(), Error> {
        let password = if self.sym_key_password.is_none() {
            // No encryption keys have been created for this group yet, so we send a message with a random password
            // to the group. The password is used as a kdf password to generate a shared symmetric key.
            let random_password: [u8; 32] = rand::rng().random();
            self.create_message_group(&random_password)?;
            random_password
        } else {
            self.sym_key_password.as_ref().unwrap().password
        };

        let salt = self.sym_key_password.as_ref().unwrap().salt.clone();
        let encrypted_proposal = Aes::with_password::encrypt(&password, proposal, &salt);

        add_action_to_transaction(
            Actions::propose::ACTION_NAME,
            &Actions::propose {
                owner: self.owner,
                evaluation_id: self.evaluation_id,
                proposal: encrypted_proposal,
            }
            .packed(),
        )
    }

    pub fn get_proposals(&mut self) -> Result<Vec<(AccountNumber, Vec<u8>)>, Error> {
        let proposals: UserProposals =
            fetch_group_proposals(self.owner, self.evaluation_id, self.group_id)?;
        let sym_key_info = &self.sym_key_password.as_ref().unwrap();

        let decrypted_proposals = proposals
            .proposals
            .into_iter()
            .map(|p| {
                let decrypted = Aes::with_password::decrypt(
                    &sym_key_info.password,
                    &p.encrypted,
                    &sym_key_info.salt,
                )?;
                Ok((parse_account_number(&p.user)?, decrypted))
            })
            .collect::<Result<Vec<_>, Error>>()?;

        Ok(decrypted_proposals)
    }
}

#[derive(Deserialize, Pack, Unpack, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvalDetails {
    pub num_options: u8,
}

#[derive(Deserialize, Pack, Unpack, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetails {
    pub key_submitter: Option<String>,
    pub key_hash: String,
    pub users: Vec<UserDetail>,
}

#[derive(Deserialize, Pack, Unpack, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeyDetails {
    pub salt: Vec<u8>,
    pub key_hash: String,
}

#[derive(Deserialize, Pack, Unpack, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyDetailsResponse {
    #[serde(rename = "getGroupKey")]
    pub key_details: Option<KeyDetails>,
}

//////////////////////////////////////////////////////

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalInfo {
    // When deserializing, the json will contain a field called "get_evaluation" but I want it
    // to be called "Evaluation" in this struct
    #[serde(rename = "getEvaluation")]
    pub details: Option<EvalDetails>,
    #[serde(rename = "getGroup")]
    pub group: Option<GroupDetails>,
    #[serde(rename = "getGroupUsers")]
    pub group_users: Option<UserDetails>,
}

impl EvalInfo {
    pub fn num_options(&self) -> u8 {
        self.details.as_ref().unwrap().num_options
    }

    pub fn key_submitter(&self) -> Option<String> {
        self.group.as_ref().unwrap().key_submitter.clone()
    }

    pub fn users(&self) -> Vec<String> {
        self.group_users
            .as_ref()
            .unwrap()
            .users
            .iter()
            .map(|n| n.user.clone())
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDetails {
    #[serde(rename = "nodes")]
    pub users: Vec<User>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct User {
    pub user: String,
    pub attestation: Option<Vec<u8>>,
    pub proposal: Option<Vec<u8>>,
}

impl TryFrom<String> for EvalInfo {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<EvalInfo> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("GetEvaluationResponse: {}", e)))?;

        Ok(response_root.data)
    }
}

#[allow(non_snake_case)]
#[derive(Deserialize, Pack, Unpack, Debug)]
pub struct UserSetting {
    pub user: String,
    pub key: Vec<u8>,
}

#[derive(Deserialize, Pack, Unpack, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GetUserSettingsResponse {
    pub get_user_settings: Vec<Option<UserSetting>>,
}

impl TryFrom<String> for GetUserSettingsResponse {
    type Error = CommonTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<GetUserSettingsResponse> = serde_json::from_str(&response)
            .map_err(|e| GraphQLParseError(format!("GetUserSettingsResponse: {}", e)))?;

        Ok(response_root.data)
    }
}
