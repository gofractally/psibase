use crate::services::{
    account_sys, auth_ec_sys, common_sys, nft_sys, producer_sys, proxy_sys, psispace_sys,
    setcode_sys, transaction_sys,
};
use crate::{
    method_raw, AccountNumber, Action, Claim, MethodNumber, ProducerConfigRow, PublicKey,
    SharedGenesisActionData, SharedGenesisService, SignedTransaction, Tapos, TimePointSec,
    Transaction,
};
use chrono::{Duration, Utc};
use fracpack::Packable;
use include_dir::{include_dir, Dir};
use psibase_macros::account_raw;

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

const ACCOUNTS: [AccountNumber; 22] = [
    account_sys::service::SERVICE,
    account!("alice"),
    auth_ec_sys::service::SERVICE,
    account!("auth-any-sys"),
    account!("bob"),
    common_sys::service::SERVICE,
    account!("doc-sys"),
    account!("explore-sys"),
    nft_sys::service::SERVICE,
    producer_sys::service::SERVICE,
    proxy_sys::service::SERVICE,
    psispace_sys::service::SERVICE,
    account!("r-account-sys"),
    account!("r-ath-ec-sys"),
    account!("r-prod-sys"),
    account!("r-proxy-sys"),
    account!("r-tok-sys"),
    setcode_sys::service::SERVICE,
    account!("symbol-sys"),
    account!("token-sys"),
    transaction_sys::service::SERVICE,
    account!("verifyec-sys"),
];

macro_rules! sgc {
    ($acc:literal, $flags:expr, $wasm:literal) => {
        SharedGenesisService {
            service: account!($acc),
            flags: $flags,
            vmType: 0,
            vmVersion: 0,
            code: include_bytes!(concat!("../boot-image/", $wasm)),
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
            include_bytes!(concat!("../boot-image/", $src)),
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
        rawData: key.packed(),
    }
}

fn new_account_action(sender: AccountNumber, account: AccountNumber) -> Action {
    account_sys::Wrapper::pack_from(sender).newAccount(account, account!("auth-any-sys"), false)
}

fn set_key_action(account: AccountNumber, key: &PublicKey) -> Action {
    auth_ec_sys::Wrapper::pack_from(account).setKey(key.clone())
}

fn set_auth_service_action(account: AccountNumber, auth_service: AccountNumber) -> Action {
    account_sys::Wrapper::pack_from(account).setAuthCntr(auth_service)
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
        content.to_vec(),
    )
}

fn without_tapos(actions: Vec<Action>) -> Transaction {
    let now_plus_10secs = Utc::now() + Duration::seconds(10);
    let expiration = TimePointSec {
        seconds: now_plus_10secs.timestamp() as u32,
    };
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

fn genesis_transaction() -> SignedTransaction {
    let services = vec![
        sgc!("account-sys", 0, "AccountSys.wasm"),
        sgc!("auth-ec-sys", 0, "AuthEcSys.wasm"),
        sgc!("auth-any-sys", 0, "AuthAnySys.wasm"),
        sgc!("common-sys", 0, "CommonSys.wasm"),
        sgc!("explore-sys", 0, "ExploreSys.wasm"),
        sgc!("nft-sys", 0, "NftSys.wasm"),
        sgc!("producer-sys", 2, "ProducerSys.wasm"),
        sgc!("proxy-sys", 0, "ProxySys.wasm"),
        sgc!("psispace-sys", 0, "PsiSpaceSys.wasm"),
        sgc!("r-account-sys", 0, "RAccountSys.wasm"),
        sgc!("r-ath-ec-sys", 0, "RAuthEcSys.wasm"),
        sgc!("r-prod-sys", 0, "RProducerSys.wasm"),
        sgc!("r-proxy-sys", 0, "RProxySys.wasm"),
        sgc!("r-tok-sys", 0, "RTokenSys.wasm"),
        sgc!("setcode-sys", 2, "SetCodeSys.wasm"), // TODO: flags
        sgc!("symbol-sys", 0, "SymbolSys.wasm"),
        sgc!("token-sys", 0, "TokenSys.wasm"),
        sgc!("transact-sys", 3, "TransactionSys.wasm"), // TODO: flags
        sgc!("verifyec-sys", 0, "VerifyEcSys.wasm"),
    ];

    let genesis_action_data = SharedGenesisActionData {
        memo: "".to_string(),
        services,
    };

    let actions = vec![Action {
        sender: AccountNumber { value: 0 },
        service: AccountNumber { value: 0 },
        method: method!("boot"),
        rawData: genesis_action_data.packed(),
    }];

    SignedTransaction {
        transaction: without_tapos(actions).packed(),
        proofs: vec![],
    }
}

fn fill_dir(dir: &Dir, actions: &mut Vec<Action>, sender: AccountNumber, service: AccountNumber) {
    for e in dir.entries() {
        match e {
            include_dir::DirEntry::Dir(d) => fill_dir(d, actions, sender, service),
            include_dir::DirEntry::File(e) => {
                let path = e.path().to_str().unwrap();
                if let Some(t) = mime_guess::from_path(path).first() {
                    // println!(
                    //     "{} {} {} {}",
                    //     sender,
                    //     service,
                    //     &("/".to_owned() + path),
                    //     t.essence_str()
                    // );
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

/// Create boot transactions
///
/// This returns a set of transactions which boot a blockchain.
/// The first transaction, the genesis transaction, installs
/// a set of service WASMs. The remainder initialize the services
/// and install apps and documentation. All of these transactions
/// should go into the first block.
///
/// If `initial_key` is set, then this initializes all accounts to use
/// that key and sets the key the initial producer signs blocks with.
/// If it is not set, then this initializes all accounts to use
/// `auth-any-sys` (no keys required) and sets it up so producers
/// don't need to sign blocks.
///
/// The first block should contain this entire set of transactions.
/// You may optionally add additional transactions after the ones this
/// function returns.
///
/// The interface to this function doesn't support customization.
/// If you want a custom boot, then use `boot.rs` as a guide to
/// create your own.
pub fn create_boot_transactions(
    initial_key: &Option<PublicKey>,
    initial_producer: AccountNumber,
) -> Vec<SignedTransaction> {
    let mut transactions = vec![genesis_transaction()];
    let mut init_actions = vec![
        account_sys::Wrapper::pack().init(),
        transaction_sys::Wrapper::pack().init(),
        nft_sys::Wrapper::pack().init(),
        Action {
            sender: account!("token-sys"),
            service: account!("token-sys"),
            method: method!("init"),
            rawData: ().packed(),
        },
        Action {
            sender: account!("symbol-sys"),
            service: account!("symbol-sys"),
            method: method!("init"),
            rawData: ().packed(),
        },
    ];

    let html = "text/html";
    let js = "text/javascript";

    let mut reg_actions = vec![
        reg_server(account_sys::service::SERVICE, account!("r-account-sys")),
        reg_server(auth_ec_sys::service::SERVICE, account!("r-ath-ec-sys")),
        reg_server(common_sys::service::SERVICE, common_sys::service::SERVICE),
        reg_server(account!("explore-sys"), account!("explore-sys")),
        reg_server(producer_sys::service::SERVICE, account!("r-prod-sys")),
        reg_server(proxy_sys::service::SERVICE, account!("r-proxy-sys")),
        reg_server(
            psispace_sys::service::SERVICE,
            psispace_sys::service::SERVICE,
        ),
    ];

    let mut common_sys_files = vec![
        store!(
            "common-sys",
            "/ui/common.index.html",
            html,
            "CommonSys/ui/vanilla/common.index.html"
        ),
        store_common!("keyConversions.mjs", js),
        store_common!("rpc.mjs", js),
        store_common!("SimpleUI.mjs", js),
        store_common!("useGraphQLQuery.mjs", js),
        store_common!("useLocalStorage.mjs", js),
        store_common!("widgets.mjs", js),
    ];

    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/CommonSys/ui/dist"),
        &mut common_sys_files,
        common_sys::service::SERVICE,
        common_sys::service::SERVICE,
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

    let mut account_sys_files = vec![
        // store!(
        //     "r-account-sys",
        //     "/index.html",
        //     html,
        //     "AccountSys/ui/vanilla/index.html"
        // ),
        // store!(
        //     "r-account-sys",
        //     "/ui/index.js",
        //     js,
        //     "AccountSys/ui/vanilla/index.js"
        // ),
    ];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/AccountSys/ui/dist"),
        &mut account_sys_files,
        account!("r-account-sys"),
        account!("r-account-sys"),
    );

    let mut auth_ec_sys_files = vec![
        // store!("r-ath-ec-sys", "/", html, "AuthEcSys/ui/index.html"),
        // store!("r-ath-ec-sys", "/ui/index.js", js, "AuthEcSys/ui/index.js"),
    ];

    let mut explore_sys_files = vec![
        // store!(
        //    "explore-sys",
        //    "/ui/index.js",
        //    js,
        //    "ExploreSys/ui/index.js"
        // ),
    ];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/ExploreSys/ui/dist"),
        &mut explore_sys_files,
        account!("explore-sys"),
        account!("explore-sys"),
    );

    let mut token_sys_files = vec![
        // store!(
        //     "r-tok-sys",
        //     "/index.html",
        //     html,
        //     "CommonSys/ui/vanilla/common.index.html"
        // ),
        // store!(
        //     "r-tok-sys",
        //     "/ui/index.js",
        //     js,
        //     "TokenSys/ui/vanilla/index.js"
        // ),
    ];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/TokenSys/ui/dist"),
        &mut token_sys_files,
        account!("r-tok-sys"),
        account!("r-tok-sys"),
    );

    let mut psispace_sys_files = vec![];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/PsiSpaceSys/ui/dist"),
        &mut psispace_sys_files,
        psispace_sys::service::SERVICE,
        psispace_sys::service::SERVICE,
    );

    let mut doc_actions = vec![
        new_account_action(account_sys::service::SERVICE, account!("doc-sys")), //
    ];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/doc"),
        &mut doc_actions,
        account!("doc-sys"),
        psispace_sys::service::SERVICE,
    );

    // TODO: make this optional
    #[allow(clippy::inconsistent_digit_grouping)]
    let mut create_and_fund_example_users = vec![
        new_account_action(account_sys::service::SERVICE, account!("alice")),
        new_account_action(account_sys::service::SERVICE, account!("bob")),
        Action {
            sender: account!("symbol-sys"),
            service: account!("token-sys"),
            method: method!("setTokenConf"),
            rawData: (1u32, method!("untradeable"), false).packed(),
        },
        Action {
            sender: account!("symbol-sys"),
            service: account!("token-sys"),
            method: method!("mint"),
            rawData: (1u32, (1_000_000_00000000_u64,), ("memo",)).packed(),
        },
        Action {
            sender: account!("symbol-sys"),
            service: account!("token-sys"),
            method: method!("credit"),
            rawData: (1u32, account!("alice"), (1_000_00000000_u64,), ("memo",)).packed(),
        },
        Action {
            sender: account!("symbol-sys"),
            service: account!("token-sys"),
            method: method!("credit"),
            rawData: (1u32, account!("bob"), (1_000_00000000_u64,), ("memo",)).packed(),
        },
    ];

    let mut actions = Vec::new();
    actions.append(&mut init_actions);
    actions.append(&mut reg_actions);
    actions.append(&mut common_sys_files);
    actions.append(&mut common_sys_3rd_party_files);
    actions.append(&mut account_sys_files);
    actions.append(&mut auth_ec_sys_files);
    actions.append(&mut explore_sys_files);
    actions.append(&mut token_sys_files);
    actions.append(&mut psispace_sys_files);
    actions.append(&mut doc_actions);
    actions.append(&mut create_and_fund_example_users);

    actions.push(set_producers_action(
        initial_producer,
        match initial_key {
            Some(k) => to_claim(k),
            None => Claim {
                service: AccountNumber::new(0),
                rawData: vec![],
            },
        },
    ));

    if let Some(k) = initial_key {
        for account in ACCOUNTS {
            actions.push(set_key_action(account, k));
            actions.push(set_auth_service_action(
                account,
                auth_ec_sys::service::SERVICE,
            ));
        }
    }

    while !actions.is_empty() {
        let mut n = 0;
        let mut size = 0;
        while n < actions.len() && size < 1024 * 1024 {
            size += actions[n].rawData.len();
            n += 1;
        }
        transactions.push(SignedTransaction {
            transaction: without_tapos(actions.drain(..n).collect()).packed(),
            proofs: vec![],
        });
    }
    transactions
}
