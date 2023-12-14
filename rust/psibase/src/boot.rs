use crate::services::{account_sys, producer_sys, transaction_sys};
use crate::{
    method_raw, new_account_action, set_auth_service_action, set_key_action, validate_dependencies,
    AccountNumber, Action, AnyPublicKey, Claim, ExactAccountNumber, GenesisActionData,
    MethodNumber, PackagedService, ProducerConfigRow, SignedTransaction, Tapos, TimePointSec,
    Transaction,
};
use fracpack::Pack;
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read, Seek};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

macro_rules! method {
    ($name:expr) => {
        MethodNumber::new(method_raw!($name))
    };
}

const ACCOUNTS: [AccountNumber; 31] = [
    account_sys::SERVICE,
    account!("alice"),
    auth_ec_sys::SERVICE,
    account!("auth-sys"),
    account!("auth-any-sys"),
    account!("auth-inv-sys"),
    account!("bob"),
    common_sys::SERVICE,
    cpu_sys::SERVICE,
    account!("doc-sys"),
    account!("supervisor-sys"),
    account!("explore-sys"),
    account!("fractal-sys"),
    account!("core-frac-sys"),
    account!("invite-sys"),
    nft_sys::SERVICE,
    producer_sys::SERVICE,
    proxy_sys::SERVICE,
    psispace_sys::SERVICE,
    account!("r-account-sys"),
    account!("r-ath-ec-sys"),
    account!("r-auth-sys"),
    account!("r-prod-sys"),
    account!("r-proxy-sys"),
    account!("r-tok-sys"),
    setcode_sys::SERVICE,
    account!("symbol-sys"),
    account!("token-sys"),
    transaction_sys::SERVICE,
    account!("verifyec-sys"),
    account!("verify-sys"),
];

macro_rules! sgc {
    ($acc:literal, $flags:expr, $wasm:literal) => {
        SharedGenesisService {
            service: account!($acc),
            flags: $flags,
            vmType: 0,
            vmVersion: 0,
            code: include_bytes!(concat!("../boot-image/contents/", $wasm)).into(),
        }
    };
}

macro_rules! store {
    ($acc:literal, $dest:expr, $ty:expr, $src:expr) => {
        store_sys(
            account!($acc),
            account!($acc),
            $dest,
            $ty,
            include_bytes!(concat!("../boot-image/contents/", $src)),
        )
    };
}

macro_rules! store_common {
    ($name:literal, $ty:expr) => {
        store!(
            "common-sys",
            concat!("/common/", $name),
            $ty,
            concat!("CommonSys/common/", $name)
        )
    };
}

macro_rules! store_third_party {
    ($name:literal, $ty:expr) => {
        store!(
            "common-sys",
            concat!("/common/", $name),
            $ty,
            concat!("CommonSys/common/thirdParty/", $name)
        )
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

        let mut reg_actions = vec![
            reg_server(account_sys::SERVICE, account!("r-account-sys")),
            reg_server(auth_ec_sys::SERVICE, account!("r-ath-ec-sys")),
            reg_server(account!("auth-sys"), account!("r-auth-sys")),
            reg_server(common_sys::SERVICE, common_sys::SERVICE),
            reg_server(account!("explore-sys"), account!("explore-sys")),
            reg_server(producer_sys::SERVICE, account!("r-prod-sys")),
            reg_server(proxy_sys::SERVICE, account!("r-proxy-sys")),
            reg_server(psispace_sys::SERVICE, psispace_sys::SERVICE),
        ];

        let mut common_sys_files = vec![
            store!(
                "common-sys",
                "/ui/common.index.html",
                html,
                "CommonSys/ui/vanilla/common.index.html"
            ),
            store_common!("keyConversions.mjs", js),
            store_common!("common-lib.js", js),
            store_common!("rpc.mjs", js),
            store_common!("SimpleUI.mjs", js),
            store_common!("useGraphQLQuery.mjs", js),
            store_common!("useLocalStorage.mjs", js),
            store_common!("widgets.mjs", js),
            store_common!("fonts/raleway.css", css),
            store_common!("fonts/raleway-variable-italic.ttf", ttf),
            store_common!("fonts/raleway-variable-normal.ttf", ttf),
            store_common!("fonts/red-hat-mono.css", css),
            store_common!("fonts/red-hat-mono-variable-normal.ttf", ttf),
        ];

        fill_dir(
            &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/CommonSys/ui/dist"),
            &mut common_sys_files,
            common_sys::SERVICE,
            common_sys::SERVICE,
        );

        let mut common_sys_3rd_party_files = vec![
            store_third_party!("htm.module.js", js),
            store_third_party!("iframeResizer.contentWindow.js", js),
            store_third_party!("iframeResizer.js", js),
            store_third_party!("react-dom.development.js", js),
            store_third_party!("react-dom.production.min.js", js),
            store_third_party!("react-router-dom.min.js", js),
            store_third_party!("react.development.js", js),
            store_third_party!("react.production.min.js", js),
            store_third_party!("semantic-ui-react.min.js", js),
            store_third_party!("useLocalStorageState.js", js),
        ];

        let mut account_sys_files = vec![];
        fill_dir(
            &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/AccountSys/ui/dist"),
            &mut account_sys_files,
            account!("r-account-sys"),
            account!("r-account-sys"),
        );

        let mut auth_ec_sys_files = vec![
            store!("r-ath-ec-sys", "/", html, "AuthEcSys/ui/index.html"),
            store!("r-ath-ec-sys", "/index.js", js, "AuthEcSys/ui/index.js"),
        ];

        let mut auth_sys_files = vec![
            store!("r-auth-sys", "/", html, "AuthSys/ui/index.html"),
            store!("r-auth-sys", "/index.js", js, "AuthSys/ui/index.js"),
        ];

        let mut explore_sys_files = vec![];
        fill_dir(
            &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/ExploreSys/ui/dist"),
            &mut explore_sys_files,
            account!("explore-sys"),
            account!("explore-sys"),
        );

        let mut token_sys_files = vec![];
        fill_dir(
            &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/TokenSys/ui/dist"),
            &mut token_sys_files,
            account!("r-tok-sys"),
            account!("r-tok-sys"),
        );

        let mut psispace_sys_files = vec![];
        fill_dir(
            &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/PsiSpaceSys/ui/dist"),
            &mut psispace_sys_files,
            psispace_sys::SERVICE,
            psispace_sys::SERVICE,
        );

        let mut invite_sys_files = vec![];
        fill_dir(
            &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/InviteSys/ui/dist"),
            &mut invite_sys_files,
            account!("invite-sys"),
            account!("invite-sys"),
        );

        actions.append(&mut reg_actions);
        actions.append(&mut common_sys_files);
        actions.append(&mut common_sys_3rd_party_files);
        actions.append(&mut account_sys_files);
        actions.append(&mut auth_ec_sys_files);
        actions.append(&mut auth_sys_files);
        actions.append(&mut explore_sys_files);
        actions.append(&mut token_sys_files);
        actions.append(&mut psispace_sys_files);
        actions.append(&mut invite_sys_files);
    }

    let mut supervisor_actions = vec![
        new_account_action(account_sys::SERVICE, account!("supervisor-sys")), //
    ];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/SupervisorSys"),
        &mut supervisor_actions,
        account!("supervisor-sys"),
        psispace_sys::SERVICE,
    );
    actions.append(&mut supervisor_actions);

    let mut doc_actions = vec![
        new_account_action(account_sys::SERVICE, account!("doc-sys")), //
    ];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/doc/html"),
        &mut doc_actions,
        account!("doc-sys"),
        psispace_sys::SERVICE,
    );
    actions.append(&mut doc_actions);

    if install_token_users {
        #[allow(clippy::inconsistent_digit_grouping)]
        let mut create_and_fund_example_users = vec![
            new_account_action(account_sys::SERVICE, account!("alice")),
            new_account_action(account_sys::SERVICE, account!("bob")),
            Action {
                sender: account!("symbol-sys"),
                service: account!("token-sys"),
                method: method!("setTokenConf"),
                rawData: (1u32, method!("untradeable"), false).packed().into(),
            },
            Action {
                sender: account!("symbol-sys"),
                service: account!("token-sys"),
                method: method!("mint"),
                rawData: (1u32, (1_000_000_00000000_u64,), "memo").packed().into(),
            },
            Action {
                sender: account!("symbol-sys"),
                service: account!("token-sys"),
                method: method!("credit"),
                rawData: (1u32, account!("alice"), (1_000_00000000_u64,), "memo")
                    .packed()
                    .into(),
            },
            Action {
                sender: account!("symbol-sys"),
                service: account!("token-sys"),
                method: method!("credit"),
                rawData: (1u32, account!("bob"), (1_000_00000000_u64,), "memo")
                    .packed()
                    .into(),
            },
        ];
        actions.append(&mut create_and_fund_example_users);
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

    if let Some(k) = initial_key {
        for s in &service_packages[..] {
            for account in s.get_accounts() {
                actions.push(set_key_action(*account, k));
                actions.push(set_auth_service_action(*account, k.auth_service()));
            }
        }
    }

    if has_package_sys {
        for s in &mut service_packages[..] {
            s.commit_install(&mut actions)?;
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
    let now_plus_30secs = chrono::Utc::now() + chrono::Duration::seconds(30);
    let expiration = TimePointSec {
        seconds: now_plus_30secs.timestamp() as u32,
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
