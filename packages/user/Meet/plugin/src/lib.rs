#[allow(warnings)]
mod bindings;

use bindings::exports::meet::plugin::api::Guest as Api;
use bindings::exports::meet::plugin::queries::{Guest as Queries, Meeting, Member};
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use ecies::{decrypt, encrypt};
use psibase::define_trust;
use psibase::fracpack::Pack;
use rand::Rng;

mod errors;
mod graphql;
mod key_table;

use errors::ErrorType;
use key_table::{hash_key, to_hex, AsymKey};

define_trust! {
    descriptions {
        Low => "
            - Reading a private meeting password you are invited to
        ",
        Medium => "
            - Publishing your meeting public key
            - Wrapping a meeting key for another invited account
        ",
        High => "
            - Creating or updating a private meeting
            - Adding or removing private meeting members
            - Deleting a private meeting
        ",
    }
    functions {
        None => [user_has_key, get_meeting, get_members, get_my_meetings],
        Low => [meeting_password],
        Medium => [set_key, rotate_key, wrap_member],
        High => [set_meeting, add_members, remove_members, delete_meeting],
    }
}

struct MeetPlugin;

fn current_user() -> Result<String, Error> {
    bindings::accounts::plugin::api::get_current_user().ok_or(ErrorType::NotLoggedIn.into())
}

fn parse_account(account: &str) -> Result<psibase::AccountNumber, Error> {
    psibase::AccountNumber::from_exact(account).map_err(|_| ErrorType::InvalidAccountNumber.into())
}

fn ensure_local_key() -> Result<AsymKey, Error> {
    if let Some(existing) = key_table::get_latest() {
        return Ok(existing);
    }
    let key = AsymKey::new();
    key.save()?;
    key_table::get_latest().ok_or(ErrorType::NoAsymmetricKey.into())
}

fn publish_key(key: AsymKey) -> Result<(), Error> {
    let packed = meet::action_structs::set_key {
        key: key.public_key()?.serialize().to_vec(),
    }
    .packed();
    add_action_to_transaction(meet::action_structs::set_key::ACTION_NAME, &packed)?;
    Ok(())
}

fn wrap_for(pubkey: &[u8], secret: &[u8]) -> Result<Vec<u8>, Error> {
    encrypt(pubkey, secret).map_err(|_| ErrorType::EncryptionFailed.into())
}

impl Api for MeetPlugin {
    fn set_key() -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_key)?;
        publish_key(ensure_local_key()?)
    }

    fn rotate_key() -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::rotate_key)?;
        let key = AsymKey::new();
        key.save()?;
        publish_key(key_table::get_latest().ok_or(ErrorType::NoAsymmetricKey)?)
    }

    fn set_meeting(id: String, accounts: Vec<String>) -> Result<String, Error> {
        trust::assert_authorized(trust::FunctionName::set_meeting)?;
        queue_set_meeting(id, accounts)
    }

    fn wrap_member(meeting_id: String, account: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::wrap_member)?;
        let secret = unwrap_secret(&meeting_id)?;
        let meeting = graphql::require_meeting(&meeting_id)?;
        let pubkey = graphql::fetch_user_key(&account)?
            .ok_or_else(|| ErrorType::UserKeyNotFound(account.clone()))?;
        let wrap = wrap_for(&pubkey, &secret)?;
        let packed = meet::action_structs::set_member_wrap {
            meeting_id: parse_account(&meeting_id)?,
            account: parse_account(&account)?,
            wrap,
            hash: meeting.key_hash,
        }
        .packed();
        add_action_to_transaction(meet::action_structs::set_member_wrap::ACTION_NAME, &packed)?;
        Ok(())
    }

    fn meeting_password(meeting_id: String) -> Result<String, Error> {
        trust::assert_authorized(trust::FunctionName::meeting_password)?;
        Ok(to_hex(&unwrap_secret(&meeting_id)?))
    }

    fn add_members(meeting_id: String, accounts: Vec<String>) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::add_members)?;
        let parsed = accounts
            .iter()
            .map(|account| parse_account(account))
            .collect::<Result<Vec<_>, Error>>()?;
        let packed = meet::action_structs::add_members {
            meeting_id: parse_account(&meeting_id)?,
            accounts: parsed,
        }
        .packed();
        add_action_to_transaction(meet::action_structs::add_members::ACTION_NAME, &packed)?;
        Ok(())
    }

    fn remove_members(meeting_id: String, accounts: Vec<String>) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_members)?;
        let remove: std::collections::HashSet<_> = accounts.iter().cloned().collect();
        let remaining = graphql::fetch_members(&meeting_id)?
            .into_iter()
            .filter(|member| !remove.contains(&member.account))
            .map(|member| member.account)
            .collect();
        queue_set_meeting(meeting_id, remaining)?;
        Ok(())
    }

    fn delete_meeting(meeting_id: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::delete_meeting)?;
        let packed = meet::action_structs::delete_meeting {
            meeting_id: parse_account(&meeting_id)?,
        }
        .packed();
        add_action_to_transaction(meet::action_structs::delete_meeting::ACTION_NAME, &packed)?;
        Ok(())
    }
}

fn to_member(node: graphql::MemberNode) -> Member {
    Member {
        meeting_id: node.meeting_id,
        account: node.account,
        wrap_ready: !node.wrap.is_empty(),
    }
}

impl Queries for MeetPlugin {
    fn user_has_key(account: String) -> Result<bool, Error> {
        trust::assert_authorized(trust::FunctionName::user_has_key)?;
        Ok(graphql::fetch_user_key(&account)?.is_some())
    }

    fn get_meeting(id: String) -> Result<Option<Meeting>, Error> {
        trust::assert_authorized(trust::FunctionName::get_meeting)?;
        Ok(graphql::fetch_meeting(&id)?.map(|meeting| Meeting {
            id: meeting.id,
            host: meeting.host,
            key_hash: meeting.key_hash,
        }))
    }

    fn get_members(meeting_id: String) -> Result<Vec<Member>, Error> {
        trust::assert_authorized(trust::FunctionName::get_members)?;
        Ok(graphql::fetch_members(&meeting_id)?
            .into_iter()
            .map(to_member)
            .collect())
    }

    fn get_my_meetings() -> Result<Vec<Member>, Error> {
        trust::assert_authorized(trust::FunctionName::get_my_meetings)?;
        let Some(me) = bindings::accounts::plugin::api::get_current_user() else {
            return Ok(Vec::new());
        };
        Ok(graphql::fetch_meetings_for_account(&me)?
            .into_iter()
            .map(to_member)
            .collect())
    }
}

fn queue_set_meeting(id: String, accounts: Vec<String>) -> Result<String, Error> {
    let me = current_user()?;
    let key = ensure_local_key()?;
    let parsed_id = parse_account(&id)?;

    let mut members = accounts;
    if !members.iter().any(|account| account == &me) {
        members.push(me.clone());
    }

    let secret: [u8; 32] = rand::rng().random();
    let password = to_hex(&secret);
    let hash = hash_key(&secret);

    let mut wraps = Vec::with_capacity(members.len());
    let mut parsed_accounts = Vec::with_capacity(members.len());
    for account in &members {
        parsed_accounts.push(parse_account(account)?);
        let wrap = match graphql::fetch_user_key(account)? {
            Some(pubkey) => wrap_for(&pubkey, &secret)?,
            None if account == &me => wrap_for(&key.public_key()?.serialize(), &secret)?,
            None => Vec::new(),
        };
        wraps.push(wrap);
    }

    let packed = meet::action_structs::set_meeting {
        id: parsed_id,
        accounts: parsed_accounts,
        wraps,
        hash: hash.clone(),
    }
    .packed();
    let packed_key = meet::action_structs::set_key {
        key: key.public_key()?.serialize().to_vec(),
    }
    .packed();
    add_action_to_transaction(meet::action_structs::set_key::ACTION_NAME, &packed_key)?;
    add_action_to_transaction(meet::action_structs::set_meeting::ACTION_NAME, &packed)?;

    Ok(serde_json::json!({ "id": id, "hash": hash, "password": password }).to_string())
}

fn unwrap_secret(meeting_id: &str) -> Result<Vec<u8>, Error> {
    let me = current_user()?;
    let meeting = graphql::require_meeting(meeting_id)?;
    let members = graphql::fetch_members(meeting_id)?;
    let mine = members
        .iter()
        .find(|member| member.account == me)
        .ok_or(ErrorType::NotAMember)?;
    if mine.wrap.is_empty() {
        return Err(ErrorType::WrapNotReady.into());
    }
    let local = key_table::get_latest().ok_or(ErrorType::NoAsymmetricKey)?;
    let secret =
        decrypt(&local.private_key, &mine.wrap).map_err(|_| ErrorType::DecryptionFailed)?;
    if hash_key(&secret) != meeting.key_hash {
        return Err(ErrorType::KeyMismatch.into());
    }
    Ok(secret)
}

bindings::export!(MeetPlugin with_types_in bindings);
