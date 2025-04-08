#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::evaluations::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;
use ecies::{decrypt, encrypt, utils::generate_keypair, PublicKey, SecretKey};

use psibase::{
    fracpack::{Pack, Unpack},
    get_sender, AccountNumber,
};

mod errors;

pub mod consensus;
mod key_table;
pub mod types;

use rand::Rng;
use types::{
    GetEvaluationResponse, GetUserSettingsResponse, KeyHistoryResponse, TryParseGqlResponse,
    UserSetting,
};

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

fn fetch_user_settings(account_numbers: Vec<String>) -> Result<GetUserSettingsResponse, Error> {
    let query = format!(
        r#"query {{
            getUserSettings(accountNumbers: [{account_numbers}]) {{
                user
                key
            }}
        }}"#,
        account_numbers = account_numbers.join(",")
    );
    GetUserSettingsResponse::from_gql(CommonServer::post_graphql_get_json(&query)?)
}

fn fetch_key_history() -> Result<KeyHistoryResponse, Error> {
    let query = format!(
        r#"query {{
            historicalUpdates(first: 99) {{
                edges {{
                    node {{
                        evaluationId
                        hash
                        groupNumber
                        keys
                    }}
                }}
            }}
        }}"#
    );

    KeyHistoryResponse::from_gql(CommonServer::post_graphql_get_json(&query)?)
}

fn get_symmetric_key(
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
) -> Result<(Vec<u8>, String), Error> {
    let key = format!("symmetric_key_{}", evaluation_id);
    let symmetric_key = Keyvalue::get(&key);
    // if symmetric_key.is_some() {
    //     return Ok((symmetric_key.unwrap(), "salty".to_string()));
    // } else {
    let res = fetch_and_decode(evaluation_id, group_number)?;
    let group = res.getGroup.expect("group is none");
    let users = res.getGroupUsers.expect("users are none");

    let is_already_symmetric_key_created = group.keySubmitter.is_some();

    let mut sorted_users_by_alphabetical_order = users;

    sorted_users_by_alphabetical_order.sort_by(|a, b| {
        let a_account_number =
            psibase::AccountNumber::from_str(a.user.as_str()).expect("a is not an account number");
        let b_account_number =
            psibase::AccountNumber::from_str(b.user.as_str()).expect("b is not an account number");
        a_account_number.value.cmp(&b_account_number.value)
    });

    let user_settings: Vec<UserSetting> = fetch_user_settings(
        sorted_users_by_alphabetical_order
            .iter()
            .map(|user| user.user.clone())
            .collect(),
    )?
    .getUserSettings
    .into_iter()
    .map(|setting| setting.expect("setting is none"))
    .collect();

    if is_already_symmetric_key_created {
        // fetch the key from graphql and decrypt it with the asymmetric key;

        let my_index = sorted_users_by_alphabetical_order
            .iter()
            .position(|user| {
                psibase::AccountNumber::from_str(user.user.as_str())
                    .expect("user is not an account number")
                    .value
                    == sender.value
            })
            .expect("failed to find my index");

        let key_history = fetch_key_history().expect("failed to fetch key history");
        let key_history_edges = key_history.historicalUpdates.edges;
        let relevant_evaluation = key_history_edges
            .iter()
            .find(|edge| edge.node.evaluationId == evaluation_id.to_string())
            .expect("failed to find relevant evaluation");

        // get it from events.
        let my_cipher = &relevant_evaluation.node.keys[my_index];

        let my_asymmetric_key =
            key_table::get_latest().expect("failed to get latest asymmetric key");

        let my_key =
            decrypt(&my_asymmetric_key.private_key, &my_cipher).expect("failed to decrypt");

        // TODO: hash my_key and compare it with the keyHash in the group

        let key = format!("symmetric_key_{}", evaluation_id);
        Keyvalue::set(&key, &my_key).expect("Failed to set private key");

        return Ok((my_key, "salty".to_string()));
    } else {
        let new_shared_symmetric_key: [u8; 32] = rand::thread_rng().gen();

        let mut payloads: Vec<Vec<u8>> = vec![];

        sorted_users_by_alphabetical_order.iter().for_each(|user| {
            let user_setting = user_settings
                .iter()
                .find(|setting| setting.user == user.user)
                .unwrap();

            payloads.push(
                encrypt(&user_setting.key, &new_shared_symmetric_key)
                    .expect("failed encrypting messages"),
            );
        });

        let hash = "derp".to_string();

        let packed_args = evaluations::action_structs::groupKey {
            evaluation_id,
            keys: payloads,
            hash,
        }
        .packed();
        add_action_to_transaction("groupKey", &packed_args);

        return Ok((new_shared_symmetric_key.to_vec(), "salty".to_string()));
    }
    // }
}

fn get_decrypted_submissions(
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
) -> Result<Vec<Vec<u8>>, Error> {
    let res = fetch_and_decode(evaluation_id, group_number)?;
    let submissions = res.getGroupUsers.unwrap();

    let (symmetric_key, salt) = get_symmetric_key(evaluation_id, group_number, sender)?;

    let subs = submissions
        .into_iter()
        .filter(|s| s.proposal.is_some())
        .map(|s| {
            let decrypted: Vec<u8> = bindings::aes::plugin::with_password::decrypt(
                &symmetric_key,
                &s.proposal.as_ref().unwrap(),
                &salt,
            )
            .unwrap();

            decrypted
        })
        .collect::<Vec<Vec<u8>>>();

    Ok(subs)
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

    fn attest(evaluation_id: u32, group_number: u32, user: String) -> Result<(), Error> {
        let submissions = get_decrypted_submissions(
            evaluation_id,
            group_number,
            AccountNumber::from_str(user.as_str()).expect("user is not an account number"),
        )
        .expect("failed getting submissions");

        let consensus = consensus::calculate_consensus(submissions, 99);

        let packed_args = evaluations::action_structs::attest {
            evaluation_id,
            submission: consensus,
        }
        .packed();
        add_action_to_transaction("attest", &packed_args)
    }

    fn propose(
        evaluation_id: u32,
        group_number: u32,
        proposal: Vec<String>,
        user: String,
    ) -> Result<(), Error> {
        let (symmetric_key, salt) = get_symmetric_key(
            evaluation_id,
            group_number,
            AccountNumber::from_str(user.as_str()).expect("user is not an account number"),
        )?;

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

        add_action_to_transaction("propose", &packed_args)
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
