use crate::services::{accounts, auth_delegate, auth_sig, producers, transact};
use crate::{
    get_schemas, method_raw, new_account_action, set_auth_service_action, set_key_action,
    validate_dependencies, AccountNumber, Action, AnyPublicKey, Claim, EssentialServices,
    GenesisActionData, MethodNumber, PackagedService, Producer, SchemaMap, SignedTransaction,
    Tapos, TimePointSec, Transaction, TransactionBuilder,
};
use fracpack::Pack;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Read, Seek};

macro_rules! method {
    ($name:expr) => {
        MethodNumber::new(method_raw!($name))
    };
}

fn set_producers_action(name: AccountNumber, key: Claim) -> Action {
    producers::Wrapper::pack().setProducers(vec![Producer {
        name: name,
        auth: key,
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
    let mut essential = EssentialServices::new();
    for s in service_packages {
        s.get_genesis(&mut services)?;
        // Only install the transact service and its dependencies
        essential.remove(s.get_accounts());
        if essential.is_empty() {
            break;
        }
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

/// genesis_block_actions
///
/// This returns all actions that need to be packed into the boot block.
fn genesis_block_actions<R: Read + Seek>(
    block_signing_key: &Option<AnyPublicKey>,
    initial_producer: AccountNumber,
    service_packages: &mut [PackagedService<R>],
    schemas: &SchemaMap,
) -> Result<Vec<Action>, anyhow::Error> {
    let mut actions = Vec::new();

    for s in &mut service_packages[..] {
        if s.get_accounts().contains(&transact::SERVICE) {
            s.reg_server(&mut actions)?;
            s.postinstall(schemas, &mut actions)?;
        }
    }

    // Set the producers
    let claim = block_signing_key
        .as_ref()
        .map_or_else(|| Default::default(), |key| to_claim(key));
    actions.push(set_producers_action(initial_producer, claim));

    Ok(actions)
}

/// Get initial actions
///
/// This returns all actions that need to be packed into the transactions pushed after the
/// boot block.
pub fn get_initial_actions<
    R: Read + Seek,
    F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>,
>(
    tx_signing_key: &Option<AnyPublicKey>,
    initial_producer: AccountNumber,
    install_ui: bool,
    service_packages: &mut [PackagedService<R>],
    compression_level: u32,
    builder: &mut TransactionBuilder<F>,
    schemas: &SchemaMap,
) -> Result<(), anyhow::Error> {
    let has_packages = true;

    let mut essential = EssentialServices::new();
    for s in &mut service_packages[..] {
        if essential.is_empty() {
            builder.set_label(format!("Installing code for {}", s.name()));
            let mut actions = Vec::new();
            s.install_code(&mut actions)?;
            for act in actions {
                builder.push(act)?;
            }
        } else {
            essential.remove(s.get_accounts());
        }
    }

    // If a package sets an auth service for an account, we should not override it
    let mut accounts_with_auth = HashSet::new();

    for s in &mut service_packages[..] {
        let mut actions = Vec::new();
        s.set_schema(&mut actions)?;
        for act in actions {
            builder.push(act)?;
        }
    }

    for s in &mut service_packages[..] {
        builder.set_label(format!("Installing {}", s.name()));
        for account in s.get_accounts() {
            if !s.has_service(*account) {
                builder.push(new_account_action(accounts::SERVICE, *account))?
            }
        }

        let mut actions = Vec::new();
        if install_ui {
            s.reg_server(&mut actions)?;
            s.store_data(&mut actions, None, compression_level)?;
        }

        s.postinstall(schemas, &mut actions)?;
        for act in &actions {
            if act.service == accounts::SERVICE && act.method == method!("setAuthServ") {
                accounts_with_auth.insert(act.sender);
            }
        }
        for act in actions {
            builder.push(act)?;
        }
    }

    builder.set_label("Creating system accounts".to_string());

    // Create producer account
    builder.push(new_account_action(accounts::SERVICE, initial_producer))?;

    if let Some(key) = tx_signing_key {
        // Set transaction signing key for producer
        builder.push(set_key_action(initial_producer, &key))?;
        builder.push(set_auth_service_action(initial_producer, auth_sig::SERVICE))?;
    }

    builder.push(new_account_action(accounts::SERVICE, producers::ROOT))?;
    builder.push(
        auth_delegate::Wrapper::pack_from(producers::ROOT)
            .setOwner(producers::PRODUCER_ACCOUNT_STRONG),
    )?;
    builder.push(set_auth_service_action(
        producers::ROOT,
        auth_delegate::SERVICE,
    ))?;

    for s in &service_packages[..] {
        for account in s.get_accounts() {
            if !accounts_with_auth.contains(account) {
                builder
                    .push(auth_delegate::Wrapper::pack_from(*account).setOwner(producers::ROOT))?;
                builder.push(set_auth_service_action(*account, auth_delegate::SERVICE))?;
            }
        }
    }

    builder.set_label("Finalizing installation".to_string());

    let mut actions = Vec::new();
    if has_packages {
        for s in &mut service_packages[..] {
            s.commit_install(producers::ROOT, &mut actions)?;
        }
    }
    for act in actions {
        builder.push(act)?;
    }

    builder.push(transact::Wrapper::pack().finishBoot())?;

    Ok(())
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
/// `auth-any` (no keys required) and sets it up so producers
/// don't need to sign blocks.
pub fn create_boot_transactions<R: Read + Seek>(
    block_signing_key: &Option<AnyPublicKey>,
    tx_signing_key: &Option<AnyPublicKey>,
    initial_producer: AccountNumber,
    install_ui: bool,
    expiration: TimePointSec,
    service_packages: &mut [PackagedService<R>],
    compression_level: u32,
) -> Result<
    (
        Vec<SignedTransaction>,
        Vec<(String, Vec<SignedTransaction>, bool)>,
    ),
    anyhow::Error,
> {
    validate_dependencies(service_packages)?;
    let (schemas, _) = get_schemas(&mut service_packages[..])?;
    let mut boot_transactions = vec![genesis_transaction(expiration, service_packages)?];

    const TARGET_SIZE: usize = 1024 * 1024;
    let mut builder = TransactionBuilder::new(TARGET_SIZE, |actions| {
        Ok(SignedTransaction {
            transaction: without_tapos(actions, expiration).packed().into(),
            proofs: vec![],
        })
    });
    get_initial_actions(
        tx_signing_key,
        initial_producer,
        install_ui,
        service_packages,
        compression_level,
        &mut builder,
        &schemas,
    )?;

    let transaction_groups = builder.finish()?;

    boot_transactions.push(SignedTransaction {
        transaction: without_tapos(
            genesis_block_actions(
                block_signing_key,
                initial_producer,
                service_packages,
                &schemas,
            )?,
            expiration,
        )
        .packed()
        .into(),
        proofs: vec![],
    });

    let mut transaction_ids: Vec<crate::Checksum256> = Vec::new();
    for (_, transactions, _) in &transaction_groups {
        for trx in transactions {
            transaction_ids.push(crate::Checksum256::from(<[u8; 32]>::from(Sha256::digest(
                &trx.transaction,
            ))))
        }
    }
    boot_transactions.push(SignedTransaction {
        transaction: without_tapos(
            vec![transact::Wrapper::pack().startBoot(transaction_ids)],
            expiration,
        )
        .packed()
        .into(),
        proofs: vec![],
    });
    Ok((boot_transactions, transaction_groups))
}
