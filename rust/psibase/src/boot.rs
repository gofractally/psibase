use crate::services::{account_sys, auth_delegate_sys, producer_sys, transaction_sys};
use crate::{
    method_raw, new_account_action, set_auth_service_action, validate_dependencies, AccountNumber,
    Action, AnyPublicKey, Claim, ExactAccountNumber, GenesisActionData, MethodNumber,
    PackagedService, ProducerConfigRow, SignedTransaction, Tapos, TimePointSec, Transaction,
};
use fracpack::Pack;
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Cursor, Read, Seek};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

macro_rules! method {
    ($name:expr) => {
        MethodNumber::new(method_raw!($name))
    };
}

fn set_producers_action(name: AccountNumber, key: Claim) -> Action {
    producer_sys::Wrapper::pack().setProducers(vec![ProducerConfigRow {
        producerName: name,
        producerAuth: key,
    }])
}

fn to_claim(key: &AnyPublicKey) -> Claim {
    Claim {
        service: key.key.service,
        rawData: key.key.rawData.clone(),
    }
}

fn without_tapos(actions: Vec<Action>, expiration: TimePointSec) -> Transaction {
    Transaction {
        tapos: Tapos {
            expiration,
            refBlockSuffix: 0,
            flags: 0,
            refBlockIndex: 0,
        },
        actions,
        claims: vec![],
    }
}

fn genesis_transaction<R: Read + Seek>(
    expiration: TimePointSec,
    service_packages: &mut [PackagedService<R>],
) -> Result<SignedTransaction, anyhow::Error> {
    let mut services = vec![];
    for s in service_packages {
        s.get_genesis(&mut services)?
    }

    let genesis_action_data = GenesisActionData {
        memo: "".to_string(),
        services,
    };

    let actions = vec![Action {
        // TODO: set sender,service,method in a way that's helpful to block explorers
        sender: AccountNumber { value: 0 },
        service: AccountNumber { value: 0 },
        method: method!("boot"),
        rawData: genesis_action_data.packed().into(),
    }];

    Ok(SignedTransaction {
        transaction: without_tapos(actions, expiration).packed().into(),
        proofs: vec![],
    })
}

/// Get initial actions
///
/// This returns all actions that need to be packed into the transactions pushed after the
/// boot block.
pub fn get_initial_actions<R: Read + Seek>(
    initial_key: &Option<AnyPublicKey>,
    initial_producer: AccountNumber,
    install_ui: bool,
    service_packages: &mut [PackagedService<R>],
) -> Result<Vec<Action>, anyhow::Error> {
    let mut actions = Vec::new();
    let has_package_sys = true;

    for s in &mut service_packages[..] {
        for account in s.get_accounts() {
            if !s.has_service(*account) {
                actions.push(new_account_action(account_sys::SERVICE, *account))
            }
        }

        if install_ui {
            s.reg_server(&mut actions)?;
            s.store_data(&mut actions)?;
        }

        s.postinstall(&mut actions)?;
    }

    actions.push(set_producers_action(
        initial_producer,
        match initial_key {
            Some(k) => to_claim(k),
            None => Claim {
                service: AccountNumber::new(0),
                rawData: Default::default(),
            },
        },
    ));

    actions.push(new_account_action(account_sys::SERVICE, producer_sys::ROOT));
    actions.push(
        auth_delegate_sys::Wrapper::pack_from(producer_sys::ROOT)
            .setOwner(producer_sys::PRODUCER_ACCOUNT_STRONG),
    );
    actions.push(set_auth_service_action(
        producer_sys::ROOT,
        auth_delegate_sys::SERVICE,
    ));

    // If a package sets an auth service for an account, we should not override it
    let mut accounts_with_auth = HashSet::new();
    for act in &actions {
        if act.service == account_sys::SERVICE && act.method == method!("setAuthServ") {
            accounts_with_auth.insert(act.sender);
        }
    }

    for s in &service_packages[..] {
        for account in s.get_accounts() {
            if !accounts_with_auth.contains(account) {
                actions.push(
                    auth_delegate_sys::Wrapper::pack_from(*account).setOwner(producer_sys::ROOT),
                );
                actions.push(set_auth_service_action(
                    *account,
                    auth_delegate_sys::SERVICE,
                ));
            }
        }
    }

    if has_package_sys {
        for s in &mut service_packages[..] {
            s.commit_install(producer_sys::ROOT, &mut actions)?;
        }
    }

    actions.push(transaction_sys::Wrapper::pack().finishBoot());

    Ok(actions)
}

/// Create boot transactions
///
/// This returns two sets of transactions which boot a blockchain.
/// The first set MUST be pushed as a group using push_boot and
/// will be included in the first block. The remaining transactions
/// MUST be pushed in order, but are not required to be in the first
/// block. If any of these transactions fail, the chain will be unusable.
///
/// The first transaction, the genesis transaction, installs
/// a set of service WASMs. The remainder initialize the services
/// and install apps and documentation.
///
/// If `initial_key` is set, then this initializes all accounts to use
/// that key and sets the key the initial producer signs blocks with.
/// If it is not set, then this initializes all accounts to use
/// `auth-any-sys` (no keys required) and sets it up so producers
/// don't need to sign blocks.
pub fn create_boot_transactions<R: Read + Seek>(
    initial_key: &Option<AnyPublicKey>,
    initial_producer: AccountNumber,
    install_ui: bool,
    expiration: TimePointSec,
    service_packages: &mut [PackagedService<R>],
) -> Result<(Vec<SignedTransaction>, Vec<SignedTransaction>), anyhow::Error> {
    validate_dependencies(service_packages)?;
    let mut boot_transactions = vec![genesis_transaction(expiration, service_packages)?];
    let mut actions =
        get_initial_actions(initial_key, initial_producer, install_ui, service_packages)?;
    let mut transactions = Vec::new();
    while !actions.is_empty() {
        let mut n = 0;
        let mut size = 0;
        while n < actions.len() && size < 1024 * 1024 {
            size += actions[n].rawData.len();
            n += 1;
        }
        transactions.push(SignedTransaction {
            transaction: without_tapos(actions.drain(..n).collect(), expiration)
                .packed()
                .into(),
            proofs: vec![],
        });
    }

    let mut transaction_ids: Vec<crate::Checksum256> = Vec::new();
    for trx in &transactions {
        transaction_ids.push(crate::Checksum256::from(<[u8; 32]>::from(Sha256::digest(
            &trx.transaction,
        ))))
    }
    boot_transactions.push(SignedTransaction {
        transaction: without_tapos(
            vec![transaction_sys::Wrapper::pack().startBoot(transaction_ids)],
            expiration,
        )
        .packed()
        .into(),
        proofs: vec![],
    });
    Ok((boot_transactions, transactions))
}

fn js_err<T, E: std::fmt::Display>(result: Result<T, E>) -> Result<T, JsValue> {
    result.map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Creates boot transactions.
/// This function reuses the same boot transaction construction as the psibase CLI, and
/// is used to generate a wasm that may be called from the browser to construct the boot
/// transactions when booting the chain from the GUI.
#[wasm_bindgen]
pub fn js_create_boot_transactions(
    producer: String,
    js_services: JsValue,
) -> Result<JsValue, JsValue> {
    let mut services: Vec<PackagedService<Cursor<&[u8]>>> = vec![];
    let deserialized_services: Vec<ByteBuf> = js_err(serde_wasm_bindgen::from_value(js_services))?;
    for s in &deserialized_services[..] {
        services.push(js_err(PackagedService::new(Cursor::new(&s[..])))?);
    }
    let now_plus_120secs = chrono::Utc::now() + chrono::Duration::seconds(120);
    let expiration = TimePointSec {
        seconds: now_plus_120secs.timestamp() as u32,
    };
    let prod = js_err(ExactAccountNumber::from_str(&producer))?;

    let (boot_transactions, transactions) = js_err(create_boot_transactions(
        &None,
        prod.into(),
        true,
        expiration,
        &mut services[..],
    ))?;

    let boot_transactions = boot_transactions.packed();
    let transactions: Vec<ByteBuf> = transactions
        .into_iter()
        .map(|tx| ByteBuf::from(tx.packed()))
        .collect();

    Ok(serde_wasm_bindgen::to_value(&(
        ByteBuf::from(boot_transactions),
        transactions,
    ))?)
}
