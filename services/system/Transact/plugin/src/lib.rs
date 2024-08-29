#[allow(warnings)]
mod bindings;
mod errors;

use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::transact::plugin::{admin::Guest as Admin, intf::Guest as Intf};
use bindings::host::common as Host;
use bindings::host::common::types::{self as CommonTypes, BodyTypes::*, PostRequest};
use errors::ErrorType::*;
use psibase::fracpack::{Pack, Unpack};
use psibase::{
    AccountNumber, Action, MethodNumber, Tapos, TimePointSec, Transaction, TransactionTrace,
};
use psibase::{Hex, SignedTransaction};
use regex::Regex;
use serde::Deserialize;
use serde_json;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn validate_action(action_name: &str) -> Result<(), CommonTypes::Error> {
    let re = Regex::new(r"^[a-zA-Z0-9_]+$").unwrap();
    if re.is_match(action_name) {
        return Ok(());
    }
    Err(InvalidActionName.err(action_name))
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct PartialTapos {
    refBlockIndex: u8,
    refBlockSuffix: u32,
}

#[derive(Pack)]
struct SignedTransactionAlt {
    pub transaction: Vec<u8>,
    pub proofs: Vec<Vec<u8>>,
}

fn assert_from_supervisor() {
    let sender_app = Host::client::get_sender_app()
        .app
        .expect("Sender app not set");
    assert!(sender_app == "supervisor", "Unauthorized");
}

fn ten_second_expiration() -> TimePointSec {
    let expiration_time = SystemTime::now() + Duration::from_secs(10);
    let expiration = expiration_time
        .duration_since(UNIX_EPOCH)
        .expect("Failed to get time")
        .as_secs();
    assert!(expiration <= u32::MAX as u64, "expiration out of range");
    TimePointSec::from(expiration as u32)
}

struct TransactPlugin;

impl Intf for TransactPlugin {
    fn add_action_to_transaction(
        method_name: String,
        packed_args: Vec<u8>,
    ) -> Result<(), CommonTypes::Error> {
        validate_action(&method_name)?;

        let service = Host::client::get_sender_app()
            .app
            .ok_or_else(|| OnlyAvailableToPlugins.err("add_action_to_transaction"))?;

        let sender = Host::client::get_logged_in_user()?
            .ok_or_else(|| NotLoggedIn.err("add_action_to_transaction"))?;

        let new_action = Action {
            sender: AccountNumber::from(sender.as_str()),
            service: AccountNumber::from(service.as_str()),
            method: MethodNumber::from(method_name.as_str()),
            rawData: Hex::from(packed_args),
        };

        let mut actions = Keyvalue::get("actions")
            .map(|a| <Vec<Action>>::unpacked(&a).expect("Failed to unpack Vec<Action>"))
            .unwrap_or(vec![]);
        actions.push(new_action);

        Keyvalue::set("actions", &actions.packed())?;

        Ok(())
    }
}

impl Admin for TransactPlugin {
    fn start_tx() {
        assert_from_supervisor();
        let actions = Keyvalue::get("actions");
        if actions.is_some() {
            println!("[Warning] Transaction list should already have been cleared.");
            Keyvalue::delete("actions");
        }
    }

    fn finish_tx() -> Result<(), CommonTypes::Error> {
        assert_from_supervisor();

        let actions = Keyvalue::get("actions")
            .map(|a| <Vec<Action>>::unpacked(&a).expect("[finish_tx] Failed to unpack"))
            .unwrap_or_default();

        if actions.len() == 0 {
            return Ok(());
        }

        Keyvalue::delete("actions");

        let tapos_str =
            Host::server::get_json("/common/tapos/head").expect("[finish_tx] Failed to get TaPoS");
        let PartialTapos {
            refBlockSuffix,
            refBlockIndex,
        } = serde_json::from_str::<PartialTapos>(&tapos_str)
            .expect("[finish_tx] Failed to deserialize TaPoS");

        let t = Transaction {
            tapos: Tapos {
                expiration: ten_second_expiration(),
                refBlockSuffix,
                flags: 0,
                refBlockIndex,
            },
            actions,
            claims: vec![],
        };

        println!(
            "Publishing transaction: \n{}",
            serde_json::to_string_pretty(&t).expect("Can't format transaction as string")
        );

        let signed_tx = SignedTransaction {
            transaction: Hex::from(t.packed()),
            proofs: vec![],
        };

        let response = Host::server::post(&PostRequest {
            endpoint: "/push_transaction".to_string(),
            body: Bytes(signed_tx.packed()),
        })?;

        let trace =
            serde_json::from_str::<TransactionTrace>(&response).expect("Failed to get trace");

        match trace.error {
            Some(err) => Err(TransactionError.err(&err)),
            None => {
                println!("Transaction executed successfully");
                Ok(())
            }
        }
    }
}

bindings::export!(TransactPlugin with_types_in bindings);
