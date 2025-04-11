#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::evaluations::plugin::api::Guest as Api;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;
use ecies::{decrypt, encrypt};

use psibase::{fracpack::Pack, AccountNumber};

pub mod consensus;
mod errors;
mod key_table;
pub mod types;

use types::{
    GetEvaluationResponse, GetUserSettingsResponse, KeyHistoryResponse, TryParseGqlResponse,
    UserSetting,
};

use errors::ErrorType;
struct EvaluationsPlugin;

fn parse_account_number(s: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_str(s).map_err(|_| ErrorType::InvalidAccountNumber.into())
}

fn fetch_and_decode(
    evaluation_id: u32,
    group_number: u32,
) -> Result<GetEvaluationResponse, CommonServer::Error> {
    let id = evaluation_id;

    let query = format!(
        r#"query {{
            getEvaluation(id: {id}) {{
                rankAmount
            }}
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
            getGroupKey(first: 99) {{
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

    KeyHistoryResponse::try_from(CommonServer::post_graphql_get_json(&query)?)
}
fn get_symmetric_key(
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
) -> Result<key_table::SymmetricKey, Error> {
    if let Some(key) = key_table::SymmetricKey::from_storage(evaluation_id, group_number) {
        return Ok(key);
    }

    let res = fetch_and_decode(evaluation_id, group_number)?;
    let group = res.getGroup.ok_or(ErrorType::GroupNotFound)?;
    let users = res.getGroupUsers.ok_or(ErrorType::UsersNotFound)?;

    if group.keySubmitter.is_some() {
        decrypt_existing_key(evaluation_id, group_number, sender, &users)
    } else {
        create_new_symmetric_key(evaluation_id, group_number, &users)
    }
}

fn decrypt_existing_key(
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
    users: &Vec<types::GroupUserSubset>,
) -> Result<key_table::SymmetricKey, Error> {
    let sorted_users = sort_users_by_account(users)?;
    let my_index = sorted_users
        .iter()
        .position(|user| parse_account_number(&user.user).unwrap() == sender)
        .ok_or(ErrorType::UserNotFound)?;

    let key_history = fetch_key_history()?;
    let edge = key_history
        .getGroupKey
        .edges
        .iter()
        .find(|edge| edge.node.evaluationId == evaluation_id.to_string())
        .ok_or(ErrorType::FailedToFindEvaluation)?;

    let my_cipher = &edge.node.keys[my_index];
    let my_asymmetric_key = key_table::get_latest().ok_or(ErrorType::NoAsymmetricKey)?;
    let decrypted_key = decrypt(&my_asymmetric_key.private_key, my_cipher)
        .map_err(|_| ErrorType::FailedToDecryptKey)?;

    let symmetric_key = key_table::SymmetricKey::new(decrypted_key, evaluation_id, group_number);
    if edge.node.hash != symmetric_key.hash() {
        return Err(ErrorType::KeyMismatch.into());
    }

    symmetric_key.save(evaluation_id)?;
    Ok(symmetric_key)
}

fn sort_users_by_account(
    users: &Vec<types::GroupUserSubset>,
) -> Result<Vec<types::GroupUserSubset>, Error> {
    let mut sorted = users.clone();
    sorted.sort_by(|a, b| {
        parse_account_number(&a.user)
            .map(|a| a.value)
            .unwrap_or(0)
            .cmp(&parse_account_number(&b.user).map(|b| b.value).unwrap_or(0))
    });
    Ok(sorted)
}

fn create_new_symmetric_key(
    evaluation_id: u32,
    group_number: u32,
    users: &Vec<types::GroupUserSubset>,
) -> Result<key_table::SymmetricKey, Error> {
    let symmetric_key = key_table::SymmetricKey::generate(evaluation_id, group_number);
    let sorted_users = sort_users_by_account(users)?;
    let user_settings =
        fetch_user_settings(sorted_users.iter().map(|u| u.user.clone()).collect())?.getUserSettings;

    let payloads: Vec<Vec<u8>> = sorted_users
        .iter()
        .map(|user| {
            let setting = user_settings
                .iter()
                .find(|s| s.as_ref().map(|s| s.user == user.user).unwrap_or(false))
                .and_then(|s| s.as_ref())
                .ok_or(ErrorType::UserSettingNotFound)?;
            encrypt(&setting.key, &symmetric_key.key).map_err(|_| ErrorType::EncryptionFailed)
        })
        .collect::<Result<_, _>>()?;

    let hash = symmetric_key.hash();
    let packed_args = evaluations::action_structs::groupKey {
        evaluation_id,
        keys: payloads,
        hash,
    }
    .packed();
    add_action_to_transaction("groupKey", &packed_args)?;
    Ok(symmetric_key)
}

fn get_decrypted_submissions(
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
) -> Result<Vec<(AccountNumber, Option<Vec<u8>>)>, Error> {
    let res = fetch_and_decode(evaluation_id, group_number)?;
    let mut submissions = res.getGroupUsers.unwrap();

    submissions.sort_by(|a, b| {
        psibase::AccountNumber::from_str(a.user.as_str())
            .unwrap()
            .value
            .cmp(
                &psibase::AccountNumber::from_str(b.user.as_str())
                    .unwrap()
                    .value,
            )
    });

    let symmetric_key = get_symmetric_key(evaluation_id, group_number, sender)?;

    let subs = submissions
        .into_iter()
        .map(|s| {
            let user = AccountNumber::from_str(s.user.as_str()).unwrap();
            if s.proposal.is_some() {
                (
                    user,
                    Some(
                        bindings::aes::plugin::with_password::decrypt(
                            &symmetric_key.key,
                            &s.proposal.as_ref().unwrap(),
                            &symmetric_key.salt,
                        )
                        .unwrap(),
                    ),
                )
            } else {
                (user, None)
            }
        })
        .collect::<Vec<(AccountNumber, Option<Vec<u8>>)>>();

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

        let evaluation = fetch_and_decode(evaluation_id, group_number)?;
        let consensus = consensus::calculate_consensus(
            submissions
                .into_iter()
                .map(|(_, submission)| submission)
                .collect(),
            evaluation.getEvaluation.unwrap().rankAmount,
        );

        let packed_args = evaluations::action_structs::attest {
            evaluation_id,
            submission: consensus,
        }
        .packed();
        add_action_to_transaction("attest", &packed_args)
    }

    fn get_proposal(
        evaluation_id: u32,
        group_number: u32,
        user: String,
    ) -> Result<Option<Vec<u8>>, Error> {
        let submissions = get_decrypted_submissions(
            evaluation_id,
            group_number,
            AccountNumber::from_str(user.as_str()).expect("user is not an account number"),
        )?;

        let user_account =
            AccountNumber::from_str(user.as_str()).expect("user is not an account number");

        let user_submission = submissions
            .into_iter()
            .find(|(account, _)| account.value == user_account.value)
            .expect("user submission is not found");

        Ok(user_submission.1)
    }

    fn propose(
        evaluation_id: u32,
        group_number: u32,
        proposal: Vec<String>,
        user: String,
    ) -> Result<(), Error> {
        let symmetric_key = get_symmetric_key(
            evaluation_id,
            group_number,
            AccountNumber::from_str(user.as_str()).expect("user is not an account number"),
        )?;

        let parsed_proposal = proposal
            .iter()
            .map(|p| p.parse::<u8>().unwrap())
            .collect::<Vec<u8>>();

        let encrypted_proposal = bindings::aes::plugin::with_password::encrypt(
            &symmetric_key.key,
            &parsed_proposal,
            &symmetric_key.salt,
        );

        let packed_args = evaluations::action_structs::propose {
            evaluation_id,
            proposal: encrypted_proposal,
        }
        .packed();

        add_action_to_transaction("propose", &packed_args)
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
