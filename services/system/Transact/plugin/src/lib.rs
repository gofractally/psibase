#[allow(warnings)]
mod bindings;

use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::transact::plugin::{admin::Guest as Admin, intf::Guest as Intf};

use bindings::host::common as Host;
use bindings::host::common::types::{self as CommonTypes, BodyTypes::Bytes, PostRequest};

use psibase::fracpack::{Pack, Unpack};
use regex::Regex;
mod errors;
use errors::ErrorType::*;
use psibase::{
    AccountNumber, Action, MethodNumber, Tapos, TimePointSec, Transaction, TransactionTrace,
};
use psibase::{Hex, SignedTransaction};

use serde::Deserialize;
use serde_json;
//use sha2::{Digest, Sha256};
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

        let actions = match Keyvalue::get("actions") {
            Some(a) => {
                let mut existing = <Vec<Action>>::unpacked(&a).expect("Failed to unpack");
                existing.push(new_action);
                existing
            }
            None => vec![new_action],
        };

        Keyvalue::set("actions", &actions.packed())?;

        Ok(())
    }
}

impl Admin for TransactPlugin {
    fn start_tx() {
        let sender_app = Host::client::get_sender_app()
            .app
            .expect("Sender app not set");
        assert!(sender_app == "supervisor", "[finish_tx] Unauthorized");

        let actions = Keyvalue::get("actions");
        if actions.is_some() {
            println!("[Warning] Transaction list should already have been cleared.");
            Keyvalue::delete("actions");
        }
    }

    fn finish_tx() -> Result<(), CommonTypes::Error> {
        let sender_app = Host::client::get_sender_app()
            .app
            .expect("Sender app not set");
        assert!(sender_app == "supervisor", "[finish_tx] Unauthorized");

        let actions: Vec<Action> = match Keyvalue::get("actions") {
            Some(a) => <Vec<Action>>::unpacked(&a).expect("[finish_tx] Failed to unpack"),
            None => vec![],
        };

        if actions.len() == 0 {
            return Ok(());
        }

        Keyvalue::delete("actions");

        let tapos_str =
            Host::server::get_json("/common/tapos/head").expect("[finish_tx] Failed to get TaPoS");
        let tapos = serde_json::from_str::<PartialTapos>(&tapos_str)
            .expect("[finish_tx] Failed to deserialize TaPoS");

        let ten_seconds = Duration::from_secs(10);
        let expiration_time = SystemTime::now() + ten_seconds;
        let expiration = expiration_time
            .duration_since(UNIX_EPOCH)
            .expect("Failed to get time")
            .as_secs();
        assert!(expiration <= u32::MAX as u64, "expiration out of range");
        let expiration = expiration as u32;

        let t = Transaction {
            tapos: Tapos {
                expiration: TimePointSec::from(expiration),
                refBlockSuffix: tapos.refBlockSuffix,
                flags: 0,
                refBlockIndex: tapos.refBlockIndex,
            },
            actions,
            claims: vec![],
        };
        println!(
            "Publishing transaction: \n{}",
            serde_json::to_string_pretty(&t).expect("Can't format transaction as string")
        );

        // Sha256 needed for signing
        // let mut hasher = Sha256::new();
        // hasher.update(&t);
        // let result = hasher.finalize();

        let signed_tx = SignedTransaction {
            transaction: Hex::from(t.packed()),
            proofs: vec![],
        };

        let response = Host::server::post_bytes(&PostRequest {
            endpoint: "/push_transaction".to_string(),
            body: Bytes(signed_tx.packed()),
        })
        .expect("Posting tx failed");

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
