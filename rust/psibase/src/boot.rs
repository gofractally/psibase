use std::str::FromStr;

use crate::*;

use fracpack::Packable;
use libpsibase::{
    AccountNumber, Action, GenesisActionData, GenesisContract, MethodNumber, SignedTransaction,
};
use psi_macros::Fracpack;

#[derive(Fracpack)]
struct Startup {
    existing_accounts: Vec<AccountNumber>,
}

pub(super) async fn boot(args: &Args, client: reqwest::Client) -> Result<(), anyhow::Error> {
    let new_signed_transactions: Vec<SignedTransaction> = vec![boot_trx()?, common_startup_trx()?];
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
        .post(Url::parse(&args.api)?.join("native/push_boot")?)
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

fn boot_trx() -> Result<SignedTransaction, anyhow::Error> {
    let contracts = vec![
        GenesisContract {
            contract: AccountNumber::from_str("transact-sys")?,
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 3, // TODO: ?
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/transaction_sys.wasm").to_vec(),
        },
        GenesisContract {
            contract: AccountNumber::from_str("account-sys")?,
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 2, // TODO: ?
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/account_sys.wasm").to_vec(),
        },
        GenesisContract {
            contract: AccountNumber::from_str("proxy-sys")?,
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/proxy_sys.wasm").to_vec(),
        },
        GenesisContract {
            contract: AccountNumber::from_str("auth-fake-sys")?,
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/auth_fake_sys.wasm").to_vec(),
        },
        GenesisContract {
            contract: AccountNumber::from_str("auth-ec-sys")?,
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/auth_ec_sys.wasm").to_vec(),
        },
        GenesisContract {
            contract: AccountNumber::from_str("verifyec-sys")?,
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/verify_ec_sys.wasm").to_vec(),
        },
        GenesisContract {
            contract: AccountNumber::from_str("common-sys")?,
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/common_sys.wasm").to_vec(),
        },
        GenesisContract {
            contract: AccountNumber::from_str("account-rpc")?, // TODO: need -sys suffix
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/rpc_account_sys.wasm").to_vec(),
        },
        GenesisContract {
            contract: AccountNumber::from_str("explore-sys")?, // TODO: need -sys suffix
            auth_contract: AccountNumber::from_str("auth-fake-sys")?,
            flags: 0,
            vm_type: 0,
            vm_version: 0,
            code: include_bytes!("../../../build/explore_sys.wasm").to_vec(),
        },
    ];

    let genesis_action_data = GenesisActionData {
        memo: "".to_string(),
        contracts,
    };

    let actions = vec![Action {
        sender: AccountNumber { value: 0 },
        contract: AccountNumber { value: 0 },
        method: MethodNumber::from_str("boot")?,
        raw_data: genesis_action_data.packed_bytes(),
    }];

    Ok(wrap_basic_trx(actions))
}

fn common_startup_trx() -> Result<SignedTransaction, anyhow::Error> {
    let startup_data = Startup {
        existing_accounts: vec![],
    };
    let startup_action = Action {
        sender: AccountNumber::from_str("account-sys")?,
        contract: AccountNumber::from_str("account-sys")?,
        method: MethodNumber::from_str("startup")?,
        raw_data: startup_data.packed_bytes(),
    };

    let actions = vec![
        startup_action,
        reg_rpc("common-sys", "common-sys")?,
        store_sys(
            "common-sys",
            "/",
            "text/html",
            include_bytes!("../../../contracts/user/common_sys/ui/index.html"),
        )?,
        store_sys(
            "common-sys",
            "/common/rpc.mjs",
            "text/javascript",
            include_bytes!("../../../contracts/user/common_sys/common/rpc.mjs"),
        )?,
        store_sys(
            "common-sys",
            "/common/useGraphQLQuery.mjs",
            "text/javascript",
            include_bytes!("../../../contracts/user/common_sys/common/useGraphQLQuery.mjs"),
        )?,
        store_sys(
            "common-sys",
            "/common/SimpleUI.mjs",
            "text/javascript",
            include_bytes!("../../../contracts/user/common_sys/common/SimpleUI.mjs"),
        )?,
        store_sys(
            "common-sys",
            "/ui/index.js",
            "text/javascript",
            include_bytes!("../../../contracts/user/common_sys/ui/index.js"),
        )?,
        reg_rpc("account-sys", "account-rpc")?,
        store_sys(
            "account-rpc",
            "/",
            "text/html",
            include_bytes!("../../../contracts/system/rpc_account_sys/ui/index.html"),
        )?,
        store_sys(
            "account-rpc",
            "/ui/index.js",
            "text/javascript",
            include_bytes!("../../../contracts/system/rpc_account_sys/ui/index.js"),
        )?,
        reg_rpc("explore-sys", "explore-sys")?,
        store_sys(
            "explore-sys",
            "/",
            "text/html",
            include_bytes!("../../../contracts/user/explore_sys/ui/index.html"),
        )?,
        store_sys(
            "explore-sys",
            "/ui/index.js",
            "text/javascript",
            include_bytes!("../../../contracts/user/explore_sys/ui/index.js"),
        )?,
    ];

    Ok(wrap_basic_trx(actions))
}
