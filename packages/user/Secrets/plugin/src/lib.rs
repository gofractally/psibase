#[allow(warnings)]
mod bindings;
use bindings::*;

use aes::plugin::{
    types::*,
    with_key::{decrypt, encrypt},
};
use exports::secrets::plugin::api::Guest as Api;
use host::{common::server, types::types::Error};
use psibase::{define_trust, fracpack::Pack};
use secrets::action_structs as Actions;
use transact::plugin::intf::add_action_to_transaction;
mod errors;
use errors::ErrorType;
use rand::{rngs::OsRng, Rng, TryRngCore};

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Reading a previously stored secret (given a decryption token)
        ",
        Medium => "",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Encrypting and storing a secret on the server on your behalf
        ",
    }
    functions {
        Low => [decode_secret],
        High => [encode_secret],
    }
}

struct SecretsPlugin;

impl Api for SecretsPlugin {
    fn encode_secret(secret: Vec<u8>) -> String {
        trust::assert_authorized(trust::FunctionName::encode_secret).unwrap();

        let mut key16 = [0u8; 16];
        OsRng.try_fill_bytes(&mut key16).unwrap();

        let encrypted = encrypt(
            &Key {
                strength: Strength::Aes128,
                key_data: key16.to_vec(),
            },
            &secret,
        );

        let id: u32 = rand::rng().random();
        add_action_to_transaction(
            Actions::add_secret::ACTION_NAME,
            &Actions::add_secret {
                id,
                secret: encrypted,
            }
            .packed(),
        )
        .unwrap();

        let mut token_bytes = Vec::with_capacity(4 + key16.len());
        token_bytes.extend_from_slice(&id.to_be_bytes());
        token_bytes.extend_from_slice(&key16);
        hex::encode(token_bytes)
    }

    fn decode_secret(token: String) -> Result<Vec<u8>, Error> {
        trust::assert_authorized(trust::FunctionName::decode_secret).unwrap();

        let token_bytes = hex::decode(token).unwrap();
        let id = u32::from_be_bytes(token_bytes[..4].try_into().unwrap());
        let key: [u8; 16] = token_bytes[4..].try_into().unwrap();

        let response_json = server::post_graphql_get_json(&format!(
            "query {{ getSecret(id: {}) {{ secret }} }}",
            id
        ))?;

        let response: serde_json::Value = serde_json::from_str(&response_json).unwrap();

        let encrypted_secret: Vec<u8> = response["data"]["getSecret"]["secret"]
            .as_array()
            .ok_or_else(|| ErrorType::InvalidSecretFormat)?
            .iter()
            .filter_map(|v| v.as_i64().map(|x| x as u8))
            .collect();

        let decrypted = decrypt(
            &Key {
                strength: Strength::Aes128,
                key_data: key.to_vec(),
            },
            &encrypted_secret,
        )?;

        Ok(decrypted)
    }
}

bindings::export!(SecretsPlugin with_types_in bindings);
