use crate::*;
use fracpack::Packable;
use libpsibase::{
    AccountNumber, Action, SharedGenesisActionData, SharedGenesisContract, SignedTransaction,
};
use psi_macros::{account, Fracpack};

#[derive(Fracpack)]
struct Startup {
    existing_accounts: Vec<AccountNumber>,
}

pub(super) async fn boot(args: &Args, client: reqwest::Client) -> Result<(), anyhow::Error> {
    let new_signed_transactions: Vec<SignedTransaction> = vec![boot_trx(), common_startup_trx()];
    push_boot(args, client, new_signed_transactions.packed_bytes()).await?;
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

fn boot_trx() -> SignedTransaction {
    let contracts = vec![
        SharedGenesisContract {
            contract: account!("transact-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 3, // TODO: ?
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/TransactionSys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("account-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 2, // TODO: ?
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/AccountSys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("proxy-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/ProxySys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("auth-fake-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/AuthFakeSys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("auth-ec-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/AuthEcSys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("verifyec-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/VerifyEcSys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("common-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/CommonSys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("r-account-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/RAccountSys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("r-ath-ec-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/RAuthEcSys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("r-proxy-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/RProxySys.wasm"),
        },
        SharedGenesisContract {
            contract: account!("explore-sys"),
            auth_contract: account!("auth-fake-sys"),
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/ExploreSys.wasm"),
        },
    ];

    let genesis_action_data = SharedGenesisActionData {
        memo: "".to_string(),
        contracts,
    };

    let actions = vec![Action {
        sender: AccountNumber { value: 0 },
        contract: AccountNumber { value: 0 },
        method: method!("boot"),
        raw_data: genesis_action_data.packed_bytes(),
    }];

    wrap_basic_trx(actions)
}

fn common_startup_trx() -> SignedTransaction {
    let startup_data = Startup {
        existing_accounts: vec![],
    };
    let startup_action = Action {
        sender: account!("account-sys"),
        contract: account!("account-sys"),
        method: method!("startup"),
        raw_data: startup_data.packed_bytes(),
    };

    let actions = vec![
        startup_action,
        reg_server(account!("common-sys"), account!("common-sys")),
        store_sys(
            account!("common-sys"),
            "/",
            "text/html",
            include_bytes!("../../../contracts/user/CommonSys/ui/index.html"),
        ),
        store_sys(
            account!("common-sys"),
            "/common/rpc.mjs",
            "text/javascript",
            include_bytes!("../../../contracts/user/CommonSys/common/rpc.mjs"),
        ),
        store_sys(
            account!("common-sys"),
            "/common/useGraphQLQuery.mjs",
            "text/javascript",
            include_bytes!("../../../contracts/user/CommonSys/common/useGraphQLQuery.mjs"),
        ),
        store_sys(
            account!("common-sys"),
            "/common/SimpleUI.mjs",
            "text/javascript",
            include_bytes!("../../../contracts/user/CommonSys/common/SimpleUI.mjs"),
        ),
        store_sys(
            account!("common-sys"),
            "/common/keyConversions.mjs",
            "text/javascript",
            include_bytes!("../../../contracts/user/CommonSys/common/keyConversions.mjs"),
        ),
        store_sys(
            account!("common-sys"),
            "/ui/index.js",
            "text/javascript",
            include_bytes!("../../../contracts/user/CommonSys/ui/index.js"),
        ),
        reg_server(account!("account-sys"), account!("r-account-sys")),
        store_sys(
            account!("r-account-sys"),
            "/",
            "text/html",
            include_bytes!("../../../contracts/system/AccountSys/ui/index.html"),
        ),
        store_sys(
            account!("r-account-sys"),
            "/ui/index.js",
            "text/javascript",
            include_bytes!("../../../contracts/system/AccountSys/ui/index.js"),
        ),
        reg_server(account!("auth-ec-sys"), account!("r-ath-ec-sys")),
        reg_server(account!("proxy-sys"), account!("r-proxy-sys")),
        reg_server(account!("explore-sys"), account!("explore-sys")),
        store_sys(
            account!("explore-sys"),
            "/",
            "text/html",
            include_bytes!("../../../contracts/user/ExploreSys/ui/index.html"),
        ),
        store_sys(
            account!("explore-sys"),
            "/ui/index.js",
            "text/javascript",
            include_bytes!("../../../contracts/user/ExploreSys/ui/index.js"),
        ),
    ];

    wrap_basic_trx(actions)
}
