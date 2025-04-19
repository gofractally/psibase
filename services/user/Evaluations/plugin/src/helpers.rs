use crate::bindings;
use crate::bindings::transact::plugin::intf::add_action_to_transaction;
use crate::errors::ErrorType;
use crate::key_table;
use crate::types;
use ecies::{decrypt, encrypt};
use psibase::AccountNumber;

use crate::bindings::host::common::types::Error;
use crate::graphql::{fetch_and_decode, fetch_key_history, fetch_user_settings};
use psibase::fracpack::Pack;

use std::str::FromStr;

pub fn parse_account_number(s: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_str(s).map_err(|_| ErrorType::InvalidAccountNumber.into())
}

pub fn current_user() -> Result<AccountNumber, Error> {
    let current_user = bindings::accounts::plugin::api::get_current_user()?;
    if current_user.is_none() {
        return Err(ErrorType::NotLoggedIn.into());
    }
    let account_number = psibase::AccountNumber::from_str(current_user.unwrap().as_str()).unwrap();
    Ok(account_number)
}

pub fn create_new_symmetric_key(
    evaluation_owner: AccountNumber,
    evaluation_id: u32,
    users: &Vec<types::GroupUserSubset>,
    creator: AccountNumber,
) -> Result<key_table::SymmetricKey, Error> {
    let sorted_users = sort_users_by_account(users)?;
    let user_settings =
        fetch_user_settings(sorted_users.iter().map(|u| u.user.clone()).collect())?.getUserSettings;

    let creator_public_key = user_settings
        .iter()
        .find_map(|opt_s| {
            opt_s.as_ref().and_then(|s| {
                if s.user == creator.to_string() {
                    Some(s.key.clone())
                } else {
                    None
                }
            })
        })
        .ok_or(ErrorType::UserSettingNotFound)?;

    let symmetric_key = key_table::SymmetricKey::generate(creator_public_key);

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
        owner: evaluation_owner,
        evaluation_id,
        keys: payloads,
        hash,
    }
    .packed();
    add_action_to_transaction("groupKey", &packed_args)?;
    Ok(symmetric_key)
}

pub fn get_decrypted_proposals(
    evaluation_owner: AccountNumber,
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
) -> Result<Vec<(AccountNumber, Option<Vec<u8>>)>, Error> {
    let res = fetch_and_decode(evaluation_id, group_number)?;
    let mut proposals = res.getGroupUsers.unwrap();

    proposals.sort_by(|a, b| {
        parse_account_number(&a.user)
            .unwrap()
            .value
            .cmp(&parse_account_number(&b.user).unwrap().value)
    });

    let symmetric_key = get_symmetric_key(evaluation_owner, evaluation_id, group_number, sender)?;

    let proposals = proposals
        .into_iter()
        .map(|s| {
            let user = parse_account_number(&s.user).unwrap();
            if s.proposal.is_some() {
                (
                    user,
                    Some(
                        bindings::aes::plugin::with_password::decrypt(
                            &symmetric_key.key,
                            &s.proposal.as_ref().unwrap(),
                            symmetric_key.salt_base_64().as_str(),
                        )
                        .unwrap(),
                    ),
                )
            } else {
                (user, None)
            }
        })
        .collect::<Vec<(AccountNumber, Option<Vec<u8>>)>>();

    Ok(proposals)
}

pub fn get_symmetric_key(
    evaluation_owner: AccountNumber,
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
) -> Result<key_table::SymmetricKey, Error> {
    // if let Some(key) = key_table::SymmetricKey::from_storage(evaluation_id) {
    //     return Ok(key);
    // }

    let res = fetch_and_decode(evaluation_id, group_number)?;
    let group = res.getGroup.ok_or(ErrorType::GroupNotFound)?;
    let users = res.getGroupUsers.ok_or(ErrorType::UsersNotFound)?;

    if group.keySubmitter.is_some() {
        decrypt_existing_key(
            evaluation_id,
            group_number,
            sender,
            &users,
            parse_account_number(
                &group
                    .keySubmitter
                    .expect("keySubmitter is invalid account number"),
            )?,
        )
    } else {
        create_new_symmetric_key(evaluation_owner, evaluation_id, &users, sender)
    }
}

pub fn get_user_public_key(user: AccountNumber) -> Result<Vec<u8>, Error> {
    let user_public_key = fetch_user_settings(vec![user.to_string()])?
        .getUserSettings
        .iter()
        .find_map(|s| {
            s.as_ref().and_then(|s| {
                if s.user == user.to_string() {
                    Some(s.key.clone())
                } else {
                    None
                }
            })
        })
        .ok_or(ErrorType::UserSettingNotFound)?;
    Ok(user_public_key)
}

pub fn decrypt_existing_key(
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
    users: &Vec<types::GroupUserSubset>,
    submitter: AccountNumber,
) -> Result<key_table::SymmetricKey, Error> {
    let sorted_users = sort_users_by_account(users)?;
    let my_index = sorted_users
        .iter()
        .position(|user| parse_account_number(&user.user).unwrap() == sender)
        .ok_or(ErrorType::UserNotFound)?;

    let key_history = fetch_key_history(evaluation_id, group_number)?;
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

    let submitter_public_key = get_user_public_key(submitter)?;

    let symmetric_key = key_table::SymmetricKey::new(decrypted_key, submitter_public_key);
    if edge.node.hash != symmetric_key.hash() {
        return Err(ErrorType::KeyMismatch.into());
    }

    symmetric_key.save(evaluation_id)?;
    Ok(symmetric_key)
}

pub fn sort_users_by_account(
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
