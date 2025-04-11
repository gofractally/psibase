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

pub fn create_new_symmetric_key(
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

pub fn get_decrypted_submissions(
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

pub fn get_symmetric_key(
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

pub fn decrypt_existing_key(
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
