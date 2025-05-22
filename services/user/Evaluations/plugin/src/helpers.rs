use crate::bindings;
use crate::bindings::transact::plugin::intf::add_action_to_transaction;
use crate::errors::ErrorType;
use crate::key_table;
use crate::types;
use ecies::{decrypt, encrypt};
use psibase::{fracpack::Pack, AccountNumber};

use crate::bindings::host::common::types::Error;
use crate::graphql::{fetch_and_decode, fetch_key_history, fetch_user_settings};

pub fn parse_account_number(s: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_exact(s).map_err(|_| ErrorType::InvalidAccountNumber.into())
}

pub fn current_user() -> Result<AccountNumber, Error> {
    let current_user = bindings::accounts::plugin::api::get_current_user()?;
    let current_user = current_user.ok_or(ErrorType::NotLoggedIn)?;
    let account_number =
        AccountNumber::from_exact(&current_user).map_err(|_| ErrorType::InvalidAccountNumber)?;
    Ok(account_number)
}

pub fn create_new_symmetric_key(
    evaluation_owner: AccountNumber,
    evaluation_id: u32,
    users: &types::GetGroupUsers,
    creator: AccountNumber,
) -> Result<key_table::SymmetricKey, Error> {
    let sorted_users = sort_users_by_account(users)?;
    let user_settings =
        fetch_user_settings(sorted_users.nodes.iter().map(|u| u.user.clone()).collect())?
            .get_user_settings;

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
        .nodes
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

    let packed_args = evaluations::action_structs::group_key {
        owner: evaluation_owner,
        evaluation_id,
        keys: payloads,
        hash,
    }
    .packed();
    add_action_to_transaction(
        evaluations::action_structs::group_key::ACTION_NAME,
        &packed_args,
    )?;
    Ok(symmetric_key)
}

pub fn get_decrypted_proposals(
    evaluation_owner: AccountNumber,
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
) -> Result<Vec<(AccountNumber, Option<Vec<u8>>)>, Error> {
    let res = fetch_and_decode(evaluation_owner, evaluation_id, group_number)?;
    let proposals = res.get_group_users.ok_or(ErrorType::UsersNotFound)?;

    let symmetric_key = get_symmetric_key(evaluation_owner, evaluation_id, group_number, sender)?;

    let proposals = proposals
        .nodes
        .iter()
        .map(|s| {
            let user = parse_account_number(&s.user).unwrap();
            Ok(if s.proposal.is_some() {
                (
                    user,
                    Some(
                        bindings::aes::plugin::with_password::decrypt(
                            &symmetric_key.key,
                            s.proposal.as_ref().unwrap(),
                            symmetric_key.salt_base_64().as_str(),
                        )
                        .map_err(|_| ErrorType::DecryptionFailed)?,
                    ),
                )
            } else {
                (user, None)
            })
        })
        .collect::<Result<Vec<(AccountNumber, Option<Vec<u8>>)>, Error>>()?;

    Ok(proposals)
}

pub fn get_symmetric_key(
    evaluation_owner: AccountNumber,
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
) -> Result<key_table::SymmetricKey, Error> {
    if let Some(key) =
        key_table::SymmetricKey::from_storage(evaluation_owner, evaluation_id, group_number)?
    {
        return Ok(key);
    }

    let res = fetch_and_decode(evaluation_owner, evaluation_id, group_number)?;
    let group = res.get_group.ok_or(ErrorType::GroupNotFound)?;
    let users = res.get_group_users.ok_or(ErrorType::UsersNotFound)?;

    if group.key_submitter.is_some() {
        decrypt_existing_key(
            evaluation_owner,
            evaluation_id,
            group_number,
            sender,
            &users,
            parse_account_number(&group.key_submitter.ok_or(ErrorType::MissingKeySubmitter)?)?,
        )
    } else {
        create_new_symmetric_key(evaluation_owner, evaluation_id, &users, sender)
    }
}

pub fn get_user_public_key(user: AccountNumber) -> Result<Vec<u8>, Error> {
    let user_public_key = fetch_user_settings(vec![user.to_string()])?
        .get_user_settings
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
    evaluation_owner: AccountNumber,
    evaluation_id: u32,
    group_number: u32,
    sender: AccountNumber,
    users: &types::GetGroupUsers,
    submitter: AccountNumber,
) -> Result<key_table::SymmetricKey, Error> {
    let sorted_users = sort_users_by_account(users)?;

    let my_index = sorted_users
        .nodes
        .iter()
        .position(|user| {
            parse_account_number(&user.user)
                .map(|u| u == sender)
                .unwrap_or(false)
        })
        .ok_or(ErrorType::UserNotFound)?;

    let key_history = fetch_key_history(evaluation_owner, evaluation_id, group_number)?;
    let edge = key_history
        .get_group_key
        .edges
        .iter()
        .find(|edge| edge.node.evaluation_id == evaluation_id)
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

    symmetric_key.save(evaluation_owner, evaluation_id, group_number)?;
    Ok(symmetric_key)
}

pub fn sort_users_by_account(users: &types::GetGroupUsers) -> Result<types::GetGroupUsers, Error> {
    let mut sorted = users.clone();
    sorted.nodes.sort_by(|a, b| {
        let a_value = parse_account_number(&a.user).map(|a| a.value).unwrap_or(0);
        let b_value = parse_account_number(&b.user).map(|b| b.value).unwrap_or(0);
        a_value.cmp(&b_value)
    });
    Ok(sorted)
}
