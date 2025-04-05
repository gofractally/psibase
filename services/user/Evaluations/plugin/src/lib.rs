#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::evaluations::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;
use ecies::{decrypt, encrypt, utils::generate_keypair, PublicKey, SecretKey};

use psibase::{fracpack::Pack, fracpack::Unpack, get_sender};

mod errors;

mod key_table;
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
            }}
            getGroupUsers(id: {id}, groupNumber: {group_number}) {{
                user
                submission
                proposal
            }}
        }}"#,
        id = id,
        group_number = group_number
    );
    GetEvaluationResponse::from_gql(CommonServer::post_graphql_get_json(&query)?)
}

fn get_symmetric_key(evaluation_id: u32, group_number: u32) -> Result<(Vec<u8>, String), Error> {
    let key = format!("symmetric_key_{}", evaluation_id);
    let symmetric_key = Keyvalue::get(&key);
    if symmetric_key.is_some() {
        return Ok((symmetric_key.unwrap(), "salty".to_string()));
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
            // fetch the key from graphql and decrypt it with the asymmetric key;
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

            let key = format!("symmetric_key_{}", evaluation_id);
            Keyvalue::set(&key, &my_key).expect("Failed to set private key");

            return Ok((my_key, "salty".to_string()));
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

            let hash = "derp".to_string();

            let packed_args = evaluations::action_structs::groupKey {
                evaluation_id,
                keys: payloads,
                hash,
            }
            .packed();
            let tx_res = add_action_to_transaction("groupKey", &packed_args);

            if tx_res.is_err() {
                panic!("failed to set the symmetric key");
            }

            return Ok((new_shared_symmetric_key.to_vec(), "salty".to_string()));
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
        rank_amount: u8,
    ) -> Result<(), Error> {
        let sizes = group_sizes
            .iter()
            .map(|s| s.parse::<u8>().unwrap())
            .collect();

        let packed_args = evaluations::action_structs::create {
            registration,
            deliberation,
            submission,
            finish_by,
            group_sizes: sizes,
            rank_amount,
        }
        .packed();
        add_action_to_transaction("create", &packed_args)
    }

    fn refresh_key(key: Vec<u8>) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::refreshKey { key }.packed();
        add_action_to_transaction("refreshKey", &packed_args)
    }

    fn register(id: u32, account: String) -> Result<(), Error> {
        let key = key_table::AsymKey::new();
        let public_key_vectored = key.public_key().serialize().to_vec();

        let packed_args = evaluations::action_structs::refreshKey {
            key: public_key_vectored,
        }
        .packed();
        add_action_to_transaction("refreshKey", &packed_args).unwrap();
        key.save()?;

        let account_number = psibase::AccountNumber::from_str(account.as_str()).unwrap();
        let packed_args = evaluations::action_structs::register { id, account_number }.packed();
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

    fn attest(evaluation_id: u32, submission: Vec<u8>) -> Result<(), Error> {
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
        let (symmetric_key, salt) = get_symmetric_key(evaluation_id, group_number)?;

        let proposal = proposal
            .iter()
            .map(|p| p.as_bytes())
            .collect::<Vec<&[u8]>>()
            .concat();

        let encrypted_proposal =
            bindings::aes::plugin::with_password::encrypt(&symmetric_key, &proposal, &salt);

        let packed_args = evaluations::action_structs::propose {
            evaluation_id,
            proposal: encrypted_proposal,
        }
        .packed();

        add_action_to_transaction("propose", &packed_args)?;
        Ok("should have pushed...".to_string())
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
