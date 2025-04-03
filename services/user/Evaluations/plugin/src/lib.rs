#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::evaluations::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;
use ecies::{decrypt, encrypt, utils::generate_keypair};

use psibase::{fracpack::Pack, get_sender};

mod errors;

pub mod types;

use rand::Rng;
use types::{EvaluationRecordSubset, GetEvaluationResponse, TryParseGqlResponse};

use errors::ErrorType;
struct EvaluationsPlugin;

fn fetch_and_decode(
    evaluation_id: u32,
    group_number: u32,
) -> Result<GetEvaluationResponse, CommonServer::Error> {
    let id = evaluation_id;

    let query = format!(
        r#"query {{
            getGroup(id: {id}, groupNumber: {group_number}) {{
                evaluationId
                keySubmitter
                keyHash
                keys
            }}
            getGroupUsers(id: {id}, groupNumber: {group_number}) {{
                user
                submission
                proposal
                key
            }}
        }}"#,
        id = id,
        group_number = group_number
    );
    GetEvaluationResponse::from_gql(CommonServer::post_graphql_get_json(&query)?)
}

fn get_symmetric_key(evaluation_id: u32, group_number: u32) -> Result<Vec<u8>, Error> {
    let key = format!(
        "symmetric_key_{}_{}",
        get_sender().to_string(),
        evaluation_id
    );
    let symmetric_key = Keyvalue::get(&key);
    if symmetric_key.is_some() {
        return Ok(symmetric_key.unwrap());
    } else {
        let res = fetch_and_decode(evaluation_id, group_number)?;
        let group = res.getGroup.unwrap();
        let users = res.getGroupUsers.unwrap();

        let is_already_symmetric_key_created = group.keySubmitter.is_some();

        let mut sorted_users_by_alphabetical_order = users;

        sorted_users_by_alphabetical_order.sort_by(|a, b| {
            let a_account_number = psibase::AccountNumber::from_str(a.user.as_str()).unwrap();
            let b_account_number = psibase::AccountNumber::from_str(b.user.as_str()).unwrap();
            a_account_number.value.cmp(&b_account_number.value)
        });

        if is_already_symmetric_key_created {
            let my_index = sorted_users_by_alphabetical_order
                .iter()
                .position(|user| {
                    psibase::AccountNumber::from_str(user.user.as_str()).unwrap() == get_sender()
                })
                .unwrap();

            let my_cipher = group.keys[my_index].clone();

            let my_asymmetric_key = Keyvalue::get(&format!(
                "asym_private_key_{}_{}",
                get_sender().to_string(),
                evaluation_id
            ))
            .unwrap();

            let my_key = decrypt(&my_asymmetric_key, &my_cipher).unwrap();

            // TODO: hash my_key and compare it with the keyHash in the group

            let key = format!(
                "symmetric_key_{}_{}",
                get_sender().to_string(),
                evaluation_id
            );
            Keyvalue::set(&key, &my_key).expect("Failed to set private key");

            return Ok(my_key);
        } else {
            let new_shared_symmetric_key: [u8; 32] = rand::thread_rng().gen();

            let mut payloads: Vec<Vec<u8>> = vec![];

            sorted_users_by_alphabetical_order.iter().for_each(|user| {
                payloads.push(bindings::aes::plugin::with_password::encrypt(
                    &user.key,
                    &new_shared_symmetric_key,
                    &get_sender().to_string().as_str(),
                ));
            });

            // hash the symmetric key...
            let symmetric_key_hash = "do this later".to_string();

            Keyvalue::set(&key, &new_shared_symmetric_key)
                .expect("Failed to save the symmetric key");

            let packed_args = evaluations::action_structs::groupKey {
                evaluation_id,
                keys: payloads,
                hash: symmetric_key_hash,
            }
            .packed();
            let tx_res = add_action_to_transaction("groupKey", &packed_args);

            if tx_res.is_err() {
                panic!("failed to set the symmetric key");
            }

            return Ok(new_shared_symmetric_key.to_vec());
        }
    }
}

impl Api for EvaluationsPlugin {
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        group_sizes: Vec<String>,
    ) -> Result<(), Error> {
        let allowable_group_sizes = group_sizes
            .iter()
            .map(|s| s.parse::<u8>().unwrap())
            .collect();
        let packed_args = evaluations::action_structs::create {
            registration,
            deliberation,
            submission,
            finish_by,
            allowable_group_sizes,
        }
        .packed();
        add_action_to_transaction("create", &packed_args)
    }

    fn register(id: u32) -> Result<(), Error> {
        let (private_key, public_key) = generate_keypair();

        let public_key_vectored = public_key.serialize().to_vec();

        let key = format!("asym_private_key_{}_{}", get_sender().to_string(), id);

        Keyvalue::set(&key, &private_key.serialize().to_vec()).expect("Failed to set private key");

        let packed_args = evaluations::action_structs::register {
            id,
            key: public_key_vectored,
        }
        .packed();
        add_action_to_transaction("register", &packed_args)
    }

    fn unregister(id: u32) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::unregister { id }.packed();
        add_action_to_transaction("unregister", &packed_args)
    }

    fn start(id: u32, entropy: u64) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::start { id, entropy }.packed();
        add_action_to_transaction("start", &packed_args)
    }

    fn close(id: u32) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::close { id }.packed();
        add_action_to_transaction("close", &packed_args)
    }

    fn group_key(evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::groupKey {
            evaluation_id,
            keys,
            hash,
        }
        .packed();
        add_action_to_transaction("groupKey", &packed_args)
    }

    fn attest(evaluation_id: u32, submission: Vec<String>) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::attest {
            evaluation_id,
            submission,
        }
        .packed();
        add_action_to_transaction("attest", &packed_args)
    }

    fn propose(
        evaluation_id: u32,
        group_number: u32,
        proposal: Vec<String>,
    ) -> Result<String, Error> {
        // get the symmetric key, if it doesn't exist... fetch it?
        let symmetric_key = get_symmetric_key(evaluation_id, group_number);

        match symmetric_key {
            Ok(symmetric_key) => {
                // okay okay okay, so... we have a symmetric key, so we need to encrypt the proposal with the symmetric key
                let accounts: Vec<psibase::AccountNumber> = proposal
                    .iter()
                    .map(|s| psibase::AccountNumber::from_str(s.as_str()).unwrap())
                    .collect();

                let encrypted_proposal = bindings::aes::plugin::with_password::encrypt(
                    &symmetric_key,
                    &accounts.packed(),
                    &get_sender().to_string().as_str(),
                );

                let packed_args = evaluations::action_structs::propose {
                    evaluation_id,
                    proposal: encrypted_proposal,
                }
                .packed();
                let _ = add_action_to_transaction("propose", &packed_args);
                return Ok("should have pushed...".to_string());
            }
            Err(e) => {
                return Ok("we have an error".to_string() + e.message.to_string().as_str());
            }
        }
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
