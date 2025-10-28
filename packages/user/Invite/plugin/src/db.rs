use crate::*;

use host::common::client as Client;
use host::common::store as Store;

use crate::bindings::base64::plugin as base64;
use crate::types::CurrentDetailsResponse;
use psibase::fracpack::Unpack;
use Store::*;

pub struct InviteTokensTable {}
impl InviteTokensTable {
    // The invite token itself, lasts in local storage only for this session.
    fn invite_tokens() -> Bucket {
        Bucket::new(
            Database {
                mode: DbMode::NonTransactional,
                duration: StorageDuration::Session,
            },
            "invites",
        )
    }

    // Details about this device's interactions with invites.
    fn device_history() -> Bucket {
        Bucket::new(
            Database {
                mode: DbMode::NonTransactional,
                duration: StorageDuration::Persistent,
            },
            "device-memory",
        )
    }

    // Details about an invite that don't change, but that don't need to be
    // preserved indefinitely.
    fn fixed_details() -> Bucket {
        Bucket::new(
            Database {
                mode: DbMode::NonTransactional,
                duration: StorageDuration::Session,
            },
            "fixed",
        )
    }

    // Details about an invite that can change at any time based on the
    // actions of others. Lasts in local storage only for this call context.
    fn current_details() -> Bucket {
        Bucket::new(
            Database {
                mode: DbMode::NonTransactional,
                duration: StorageDuration::Ephemeral,
            },
            "current",
        )
    }

    fn get_current_details(invite_id: u32) -> Option<CurrentDetailsResponse> {
        if let Some(cached) = Self::current_details().get(&invite_id.to_string()) {
            return Some(<CurrentDetailsResponse>::unpacked(&cached).unwrap());
        }

        let query = format!(
            r#"query {{
                inviteById(inviteId: "{id}") {{
                    numAccounts,
                }}
            }}"#,
            id = invite_id
        );
        let current_details =
            CurrentDetailsResponse::from_gql(Server::post_graphql_get_json(&query).unwrap());
        if current_details.is_err() {
            return None;
        }

        let current_details = current_details.unwrap();
        Self::current_details().set(&invite_id.to_string(), &current_details.packed());
        Some(current_details)
    }

    fn get_fixed_details(invite_id: u32, sym_key: Vec<u8>) -> Option<FixedDetails> {
        if let Some(cached) = Self::fixed_details().get(&invite_id.to_string()) {
            return Some(<FixedDetails>::unpacked(&cached).unwrap());
        }

        let query = format!(
            r#"query {{
                inviteById(inviteId: "{id}") {{
                    secret,
                    expiryDate,
                }}
            }}"#,
            id = invite_id
        );

        let response =
            FixedDetailsResponse::from_gql(Server::post_graphql_get_json(&query).unwrap());
        if response.is_err() {
            return None;
        }

        let response = response.unwrap();

        let cred_key = aes::with_key::decrypt(
            &aes::types::Key {
                strength: aes::types::Strength::Aes128,
                key_data: sym_key,
            },
            base64::standard::decode(&response.secret)
                .unwrap()
                .as_slice(),
        )
        .unwrap();

        let fixed_details = FixedDetails {
            expiry_date: response.expiryDate,
            private_key: String::from_utf8(cred_key).unwrap(),
        };
        Self::fixed_details().set(&invite_id.to_string(), &fixed_details.packed());
        Some(fixed_details)
    }

    fn delete_fixed_details(invite_id: u32) {
        Self::fixed_details().delete(&invite_id.to_string());
    }

    fn is_valid(invite_id: u32, sym_key: &Vec<u8>) -> bool {
        if let Some(device) = Self::device_history().get(&invite_id.to_string()) {
            let device = <DeviceDetails>::unpacked(&device).unwrap();
            if device.accepted {
                // Already accepted
                return false;
            }
        }

        let details = Self::get_fixed_details(invite_id, sym_key.to_vec());
        if details.is_none() {
            // Invite dne
            return false;
        }
        let details = details.unwrap();
        let expiry = DateTime::parse_from_rfc3339(&details.expiry_date)
            .unwrap()
            .with_timezone(&Utc);

        // Invite expired
        expiry > Utc::now()
    }

    fn delete_active() {
        Self::invite_tokens().delete(&Client::get_active_app());
    }

    pub fn decode_invite_token(token: String) -> Result<(u32, Vec<u8>), HostTypes::Error> {
        let data = base64::url::decode(&token)?;
        assert!(data.len() == 20, "invalid token");
        let invite_id = u32::from_le_bytes(data[..4].try_into().unwrap());
        let symmetric_key = &data[4..];

        Ok((invite_id, symmetric_key.to_vec()))
    }

    pub fn import(token: String) -> Option<u32> {
        let (invite_id, sym_key) = Self::decode_invite_token(token.to_string()).unwrap();
        if !Self::is_valid(invite_id, &sym_key) {
            Self::delete_fixed_details(invite_id);
            return None;
        }
        Self::invite_tokens().set(&Client::get_sender(), token.as_bytes());
        Some(invite_id)
    }

    fn get_active_token() -> Option<(u32, Vec<u8>)> {
        let token = Self::invite_tokens()
            .get(&Client::get_active_app())
            .map(|data| String::from_utf8(data).unwrap());
        if token.is_none() {
            return None;
        }
        let (invite_id, sym_key) = Self::decode_invite_token(token.unwrap()).unwrap();
        if !Self::is_valid(invite_id, &sym_key) {
            Self::delete_active();
            Self::delete_fixed_details(invite_id);
            return None;
        }
        Some((invite_id, sym_key))
    }

    pub fn active_invite_id() -> Option<u32> {
        let active_token = Self::get_active_token();
        if active_token.is_none() {
            return None;
        }
        let (invite_id, _) = active_token.unwrap();
        Some(invite_id)
    }

    pub fn active_can_create_account() -> bool {
        let invite_id = Self::active_invite_id();
        if invite_id.is_none() {
            return false;
        }
        let invite_id = invite_id.unwrap();

        if let Some(device) = Self::device_history().get(&invite_id.to_string()) {
            let device = <DeviceDetails>::unpacked(&device).unwrap();
            if device.account_created {
                return false;
            }
        }

        let details = Self::get_current_details(invite_id);
        if details.is_none() {
            return false;
        }
        details.unwrap().numAccounts > 0
    }

    pub fn account_created() {
        let invite_id = Self::active_invite_id().expect("No active invite token");
        let mut device = Self::device_history()
            .get(&invite_id.to_string())
            .map(|d| <DeviceDetails>::unpacked(&d).unwrap())
            .unwrap_or_default();
        device.account_created = true;
        Self::device_history().set(&invite_id.to_string(), &device.packed());
    }

    pub fn accepted() {
        let invite_id = Self::active_invite_id().expect("No active invite token");
        let mut device = Self::device_history()
            .get(&invite_id.to_string())
            .map(|d| <DeviceDetails>::unpacked(&d).unwrap())
            .unwrap_or_default();
        device.accepted = true;
        Self::device_history().set(&invite_id.to_string(), &device.packed());
        Self::delete_active();
    }

    pub fn active_credential_key() -> Option<String> {
        let (invite_id, sym_key) = Self::get_active_token().expect("No active invite token");
        let details = Self::get_fixed_details(invite_id, sym_key);
        if details.is_none() {
            return None;
        }
        Some(details.unwrap().private_key)
    }

    pub fn reject_active() {
        let active_token = Self::get_active_token();
        if active_token.is_none() {
            return;
        }

        let (invite_id, _) = active_token.unwrap();
        Self::delete_fixed_details(invite_id);
        Self::delete_active();
    }
}
