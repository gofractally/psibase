use crate::{
    new_account_action, reg_server, set_auth_contract_action, set_key_action, set_producers_action,
    store_sys, to_claim, without_tapos, Args, Error,
};
use anyhow::Context;
use fracpack::Packable;
use include_dir::{include_dir, Dir};
use libpsibase::{
    account, method, AccountNumber, Action, Claim, ExactAccountNumber, Fracpack, PublicKey,
    SharedGenesisActionData, SharedGenesisContract, SignedTransaction,
};
use serde_json::Value;

// TODO: support ().packed(). It should pack the same as
// a struct with no fields.
#[derive(Fracpack)]
struct Empty {}

const ACCOUNTS: [AccountNumber; 22] = [
    account!("account-sys"),
    account!("alice"),
    account!("auth-ec-sys"),
    account!("auth-any-sys"),
    account!("bob"),
    account!("common-sys"),
    account!("doc-sys"),
    account!("explore-sys"),
    account!("nft-sys"),
    account!("producer-sys"),
    account!("proxy-sys"),
    account!("psispace-sys"),
    account!("r-account-sys"),
    account!("r-ath-ec-sys"),
    account!("r-prod-sys"),
    account!("r-proxy-sys"),
    account!("r-tok-sys"),
    account!("setcode-sys"),
    account!("symbol-sys"),
    account!("token-sys"),
    account!("transact-sys"),
    account!("verifyec-sys"),
];

pub(super) async fn boot(
    args: &Args,
    client: reqwest::Client,
    key: &Option<PublicKey>,
    producer: &Option<ExactAccountNumber>,
) -> Result<(), anyhow::Error> {
    let mut transactions = vec![boot_trx()];
    add_startup_trx(&mut transactions, key, producer);
    push_boot(args, client, transactions.packed()).await?;
    println!("Ok");
    Ok(())
}

async fn push_boot_impl(
    args: &Args,
    client: reqwest::Client,
    packed: Vec<u8>,
) -> Result<(), anyhow::Error> {
    let mut response = client
        .post(args.api.join("native/push_boot")?)
        .body(packed)
        .send()
        .await?;
    if response.status().is_client_error() {
        response = response.error_for_status()?;
    }
    if response.status().is_server_error() {
        return Err(anyhow::Error::new(Error::Msg {
            s: response.text().await?,
        }));
    }
    let text = response.text().await?;
    let json: Value = serde_json::de::from_str(&text)?;
    // println!("{:#?}", json);
    let err = json.get("error").and_then(|v| v.as_str());
    if let Some(e) = err {
        if !e.is_empty() {
            return Err(Error::Msg { s: e.to_string() }.into());
        }
    }
    Ok(())
}

async fn push_boot(
    args: &Args,
    client: reqwest::Client,
    packed: Vec<u8>,
) -> Result<(), anyhow::Error> {
    push_boot_impl(args, client, packed)
        .await
        .context("Failed to boot")?;
    Ok(())
}

macro_rules! sgc {
    ($acc:literal, $flags:expr, $wasm:literal) => {
        SharedGenesisContract {
            contract: account!($acc),
            flags: $flags,
            vm_type: 0,
            vm_version: 0,
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

fn boot_trx() -> SignedTransaction {
    let contracts = vec![
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
        contracts,
    };

    let actions = vec![Action {
        sender: AccountNumber { value: 0 },
        contract: AccountNumber { value: 0 },
        method: method!("boot"),
        raw_data: genesis_action_data.packed(),
    }];

    SignedTransaction {
        transaction: without_tapos(actions).packed(),
        proofs: vec![],
    }
}

fn fill_dir(dir: &Dir, actions: &mut Vec<Action>, sender: AccountNumber, contract: AccountNumber) {
    for e in dir.entries() {
        match e {
            include_dir::DirEntry::Dir(d) => fill_dir(d, actions, sender, contract),
            include_dir::DirEntry::File(e) => {
                let path = e.path().to_str().unwrap();
                if let Some(t) = mime_guess::from_path(path).first() {
                    // println!(
                    //     "{} {} {} {}",
                    //     sender,
                    //     contract,
                    //     &("/".to_owned() + path),
                    //     t.essence_str()
                    // );
                    actions.push(store_sys(
                        contract,
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

fn add_startup_trx(
    transactions: &mut Vec<SignedTransaction>,
    key: &Option<PublicKey>,
    producer: &Option<ExactAccountNumber>,
) {
    let mut init_actions = vec![
        Action {
            sender: account!("account-sys"),
            contract: account!("account-sys"),
            method: method!("init"),
            raw_data: Empty {}.packed(),
        },
        Action {
            sender: account!("transact-sys"),
            contract: account!("transact-sys"),
            method: method!("init"),
            raw_data: Empty {}.packed(),
        },
        Action {
            sender: account!("nft-sys"),
            contract: account!("nft-sys"),
            method: method!("init"),
            raw_data: Empty {}.packed(),
        },
        Action {
            sender: account!("token-sys"),
            contract: account!("token-sys"),
            method: method!("init"),
            raw_data: Empty {}.packed(),
        },
        Action {
            sender: account!("symbol-sys"),
            contract: account!("symbol-sys"),
            method: method!("init"),
            raw_data: Empty {}.packed(),
        },
    ];

    let html = "text/html";
    let js = "text/javascript";

    let mut reg_actions = vec![
        reg_server(account!("account-sys"), account!("r-account-sys")),
        reg_server(account!("auth-ec-sys"), account!("r-ath-ec-sys")),
        reg_server(account!("common-sys"), account!("common-sys")),
        reg_server(account!("explore-sys"), account!("explore-sys")),
        reg_server(account!("producer-sys"), account!("r-prod-sys")),
        reg_server(account!("proxy-sys"), account!("r-proxy-sys")),
        reg_server(account!("psispace-sys"), account!("psispace-sys")),
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
        account!("common-sys"),
        account!("common-sys"),
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
        store!("r-ath-ec-sys", "/", html, "AuthEcSys/ui/index.html"),
        store!("r-ath-ec-sys", "/ui/index.js", js, "AuthEcSys/ui/index.js"),
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

    let mut doc_actions = vec![
        new_account_action(account!("account-sys"), account!("doc-sys")), //
    ];
    fill_dir(
        &include_dir!("$CARGO_MANIFEST_DIR/boot-image/doc"),
        &mut doc_actions,
        account!("doc-sys"),
        account!("psispace-sys"),
    );

    // TODO: make this optional
    #[allow(clippy::inconsistent_digit_grouping)]
    let mut create_and_fund_example_users = vec![
        new_account_action(account!("account-sys"), account!("alice")),
        new_account_action(account!("account-sys"), account!("bob")),
        Action {
            sender: account!("symbol-sys"),
            contract: account!("token-sys"),
            method: method!("setTokenConf"),
            raw_data: (1u32, method!("untradeable"), false).packed(),
        },
        Action {
            sender: account!("symbol-sys"),
            contract: account!("token-sys"),
            method: method!("mint"),
            raw_data: (1u32, (1_000_000_00000000_u64,), ("memo",)).packed(),
        },
        Action {
            sender: account!("symbol-sys"),
            contract: account!("token-sys"),
            method: method!("credit"),
            raw_data: (1u32, account!("alice"), (1_000_00000000_u64,), ("memo",)).packed(),
        },
        Action {
            sender: account!("symbol-sys"),
            contract: account!("token-sys"),
            method: method!("credit"),
            raw_data: (1u32, account!("bob"), (1_000_00000000_u64,), ("memo",)).packed(),
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
    actions.append(&mut doc_actions);
    actions.append(&mut create_and_fund_example_users);

    actions.push(set_producers_action(
        match producer {
            Some(p) => AccountNumber::from(*p),
            None => account!("psibase"),
        },
        match key {
            Some(k) => to_claim(k),
            None => Claim {
                contract: AccountNumber::new(0),
                raw_data: vec![],
            },
        },
    ));

    if let Some(k) = key {
        for account in ACCOUNTS {
            actions.push(set_key_action(account, k));
            actions.push(set_auth_contract_action(account, account!("auth-ec-sys")));
        }
    }

    while !actions.is_empty() {
        let mut n = 0;
        let mut size = 0;
        while n < actions.len() && size < 1024 * 1024 {
            size += actions[n].raw_data.len();
            n += 1;
        }
        transactions.push(SignedTransaction {
            transaction: without_tapos(actions.drain(..n).collect()).packed(),
            proofs: vec![],
        });
    }
}
