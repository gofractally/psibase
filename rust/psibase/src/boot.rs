use crate::services::{
    account_sys, auth_ec_sys, common_sys, cpu_sys, nft_sys, producer_sys, proxy_sys, psispace_sys,
    setcode_sys, transaction_sys,
};
use crate::{
    method_raw, AccountNumber, Action, Claim, ExactAccountNumber, MethodNumber, ProducerConfigRow, PublicKey,
    SharedGenesisActionData, SharedGenesisService, SignedTransaction, Tapos, TimePointSec,
    Transaction,
};
use fracpack::Pack;
use include_dir::{include_dir, Dir};
use psibase_macros::account_raw;
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::str::FromStr;
use wasm_bindgen::prelude::*;


macro_rules! account {
    ($name:expr) => {
        AccountNumber::new(account_raw!($name))
    };
}

macro_rules! method {
    ($name:expr) => {
        MethodNumber::new(method_raw!($name))
    };
}

const ACCOUNTS: [AccountNumber; 30] = [
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

fn to_claim(key: &PublicKey) -> Claim {
    Claim {
        service: account!("verifyec-sys"),
        rawData: key.packed().into(),
    }
}

fn new_account_action(sender: AccountNumber, account: AccountNumber) -> Action {
    account_sys::Wrapper::pack_from(sender).newAccount(account, account!("auth-any-sys"), false)
}

fn set_key_action(account: AccountNumber, key: &PublicKey) -> Action {
    auth_ec_sys::Wrapper::pack_from(account).setKey(key.clone())
}

fn set_auth_service_action(account: AccountNumber, auth_service: AccountNumber) -> Action {
    account_sys::Wrapper::pack_from(account).setAuthServ(auth_service)
}

fn reg_server(service: AccountNumber, server_service: AccountNumber) -> Action {
    proxy_sys::Wrapper::pack_from(service).registerServer(server_service)
}

fn store_sys(
    service: AccountNumber,
    sender: AccountNumber,
    path: &str,
    content_type: &str,
    content: &[u8],
) -> Action {
    psispace_sys::Wrapper::pack_from_to(sender, service).storeSys(
        path.to_string(),
        content_type.to_string(),
        content.to_vec().into(),
    )
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

fn genesis_transaction(expiration: TimePointSec) -> SignedTransaction {
    let services = vec![
        sgc!("account-sys", 0, "AccountSys.wasm"),
        sgc!("auth-ec-sys", 0, "AuthEcSys.wasm"),
        sgc!("auth-sys", 0, "AuthSys.wasm"),
        sgc!("auth-any-sys", 0, "AuthAnySys.wasm"),
        sgc!("auth-inv-sys", 0, "AuthInviteSys.wasm"),
        sgc!("common-sys", 0, "CommonSys.wasm"),
        sgc!("core-frac-sys", 0, "CoreFractalSys.wasm"),
        sgc!("cpu-sys", 0b100100, "CpuSys.wasm"),
        sgc!("explore-sys", 0, "ExploreSys.wasm"),
        sgc!("fractal-sys", 0, "FractalSys.wasm"),
        sgc!("invite-sys", 0, "InviteSys.wasm"),
        sgc!("nft-sys", 0, "NftSys.wasm"),
        sgc!("producer-sys", 2, "ProducerSys.wasm"),
        sgc!("proxy-sys", 0, "ProxySys.wasm"),
        sgc!("psispace-sys", 0, "PsiSpaceSys.wasm"),
        sgc!("r-account-sys", 0, "RAccountSys.wasm"),
        sgc!("r-ath-ec-sys", 0, "RAuthEcSys.wasm"),
        sgc!("r-auth-sys", 0, "RAuthSys.wasm"),
        sgc!("r-prod-sys", 0, "RProducerSys.wasm"),
        sgc!("r-proxy-sys", 0, "RProxySys.wasm"),
        sgc!("r-tok-sys", 0, "RTokenSys.wasm"),
        sgc!("setcode-sys", 2, "SetCodeSys.wasm"), // TODO: flags
        sgc!("symbol-sys", 0, "SymbolSys.wasm"),
        sgc!("token-sys", 0, "TokenSys.wasm"),
        sgc!("transact-sys", 3, "TransactionSys.wasm"), // TODO: flags
        sgc!("verifyec-sys", 64, "VerifyEcSys.wasm"),
        sgc!("verify-sys", 64, "VerifySys.wasm"),
    ];

    let genesis_action_data = SharedGenesisActionData {
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

    SignedTransaction {
        transaction: without_tapos(actions, expiration).packed().into(),
        proofs: vec![],
    }
}

// Adds an action
fn fill_dir(dir: &Dir, actions: &mut Vec<Action>, sender: AccountNumber, service: AccountNumber) {
    for e in dir.entries() {
        match e {
            include_dir::DirEntry::Dir(d) => fill_dir(d, actions, sender, service),
            include_dir::DirEntry::File(e) => {
                let path = e.path().to_str().unwrap();
                if let Some(t) = mime_guess::from_path(path).first() {
                    actions.push(store_sys(
                        service,
                        sender,
                        &("/".to_owned() + path),
                        t.essence_str(),
                        e.contents(),
                    ));
                }
            }
        }
    }
}

/// Get initial actions
///
/// This returns all actions that need to be packed into the transactions pushed after the
/// boot block.
pub fn get_initial_actions(
    initial_key: &Option<PublicKey>,
    initial_producer: AccountNumber,
    install_ui: bool,
    install_token_users: bool)
    -> Vec<Action> {
    let mut init_actions = vec![
        account_sys::Wrapper::pack().init(),
        nft_sys::Wrapper::pack().init(),
        Action {
            sender: account!("token-sys"),
            service: account!("token-sys"),
            method: method!("init"),
            rawData: ().packed().into(),
        },
        Action {
            sender: account!("symbol-sys"),
            service: account!("symbol-sys"),
            method: method!("init"),
            rawData: ().packed().into(),
        },
        Action {
            sender: account!("invite-sys"),
            service: account!("invite-sys"),
            method: method!("init"),
            rawData: ().packed().into(),
        },
    ];
    let mut actions = Vec::new();
    actions.append(&mut init_actions);

    if install_ui {
        let html = "text/html";
        let js = "text/javascript";
        let css = "text/css";
        let ttf = "font/ttf";

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
            store_third_party!("iframeResizer.js", js)
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

    let mut doc_actions = vec![
        new_account_action(account_sys::SERVICE, account!("doc-sys")), //
    ];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/contents/doc"),
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
        for account in ACCOUNTS {
            actions.push(set_key_action(account, k));
            actions.push(set_auth_service_action(account, auth_ec_sys::SERVICE));
        }
    }

    actions.push(transaction_sys::Wrapper::pack().finishBoot());

    actions
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
///
/// The interface to this function doesn't support customization.
/// If you want a custom boot, then use `boot.rs` as a guide to
/// create your own.
// TODO: switch to builder pattern
// TODO: sometimes tries to set keys on non-existing accounts
pub fn create_boot_transactions(
    initial_key: &Option<PublicKey>,
    initial_producer: AccountNumber,
    install_ui: bool,
    install_token_users: bool,
    expiration: TimePointSec,
) -> (Vec<SignedTransaction>, Vec<SignedTransaction>) {
    let mut boot_transactions = vec![genesis_transaction(expiration)];
    let mut actions = get_initial_actions(initial_key, initial_producer, install_ui, install_token_users);
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
        transaction_ids.push(crate::Checksum256::from(
            <[u8; 32]>::from(Sha256::digest(&trx.transaction)),
        ))
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
    (boot_transactions, transactions)
}


/// Creates boot transactions.
/// This function reuses the same boot transaction construction as the psibase CLI, and
/// is used to generate a wasm that may be called from the browser to construct the boot
/// transactions when booting the chain from the GUI.
#[wasm_bindgen]
pub fn js_create_boot_transactions(producer: String) -> Result<JsValue, JsValue> {

    let now_plus_30secs = chrono::Utc::now() + chrono::Duration::seconds(30);
    let expiration = TimePointSec {
        seconds: now_plus_30secs.timestamp() as u32,
    };
    let prod = ExactAccountNumber::from_str(&producer)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let (boot_transactions, transactions) =
        create_boot_transactions(&None, prod.into(), true, true, expiration);

    let boot_transactions = boot_transactions.packed();
    let transactions : Vec<ByteBuf> = transactions
        .into_iter()
        .map(|tx| ByteBuf::from(tx.packed()))
        .collect();

    Ok(serde_wasm_bindgen::to_value(&(ByteBuf::from(boot_transactions), transactions))?)
}

/// Gets an unpacked view of the transactions committed to during boot.
#[wasm_bindgen]
pub fn js_get_initial_actions(producer: String) -> Result<JsValue, JsValue> {

    let prod = ExactAccountNumber::from_str(&producer)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let actions = get_initial_actions(&None, prod.into(), true, true);

    Ok(serde_wasm_bindgen::to_value(&actions)?)
}
