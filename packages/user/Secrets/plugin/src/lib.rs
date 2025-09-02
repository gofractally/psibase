#[allow(warnings)]
mod bindings;

use bindings::aes::plugin::{
    types::*,
    with_key::{decrypt, encrypt},
};
use bindings::exports::secrets::plugin::api::Guest as Api;
use bindings::host::common::server;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;
use secrets::action_structs as Actions;

use psibase::define_trust;
use psibase::fracpack::Pack;

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
        trust::authorize(trust::FunctionName::encode_secret)?;
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

// #[derive(serde::Deserialize, Debug)]
// #[serde(rename_all = "camelCase")]
// struct ExampleThingData {
//     example_thing: String,
// }
// #[derive(serde::Deserialize, Debug)]
// #[serde(rename_all = "camelCase")]
// struct ExampleThingResponse {
//     data: ExampleThingData,
// }

// impl Queries for SecretsPlugin {
//     fn get_example_thing() -> Result<String, Error> {
//         trust::authorize(trust::FunctionName::get_example_thing)?;

//         let graphql_str = "query { exampleThing }";

//         let examplething_val = serde_json::from_str::<ExampleThingResponse>(
//             &CommonServer::post_graphql_get_json(&graphql_str)?,
//         );

//         let examplething_val =
//             examplething_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

//         Ok(examplething_val.data.example_thing)
//     }
// }

bindings::export!(SecretsPlugin with_types_in bindings);
