use std::str::FromStr;

use crate::{bridge::ffi::pack_signed_transaction, *};

use chrono::DateTime;
use fracpack::Packable;
use libpsibase::{
    AccountNumber, Action, GenesisActionData, GenesisContract, MethodNumber, SignedTransaction,
    Tapos, TimePointSec, Transaction,
};
use psi_macros::Fracpack;

#[derive(Fracpack)]
struct Startup {
    existing_accounts: Vec<AccountNumber>,
}

// TODO: replace
fn genesis_contract_json(
    contract: &str,
    auth_contract: &str,
    flags: u64,
    code: &str,
) -> Result<String, anyhow::Error> {
    Ok(format!(
        r#"{{
            "contract": {},
            "authContract": {},
            "flags": {},
            "vmType": 0,
            "vmVersion": 0,
            "code": {}
        }}"#,
        serde_json::to_string(contract)?,
        serde_json::to_string(auth_contract)?,
        serde_json::to_string(&flags.to_string())?,
        serde_json::to_string(code)?
    ))
}

// TODO: replace with struct
fn genesis_action_data_json(contracts: &[String]) -> String {
    to_hex(
        bridge::ffi::pack_genesis_action_data(&format!(
            r#"{{
                "memo": "",
                "contracts": [{}]
            }}"#,
            contracts.join(",")
        ))
        .as_slice(),
    )
}

// TODO: replace with struct
fn startup() -> Result<String, anyhow::Error> {
    let data = Startup {
        existing_accounts: vec![],
    };

    Ok(to_hex(&data.packed_bytes()[..]))
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

fn boot_trx(expiration: &DateTime<Utc>) -> Result<String, anyhow::Error> {
    signed_transaction_json(&transaction_json(
        &expiration.to_rfc3339_opts(SecondsFormat::Millis, true),
        &[action_json(
            "",
            "",
            "boot",
            &genesis_action_data_json(&[
                genesis_contract_json(
                    "transact-sys",
                    "auth-fake-sys",
                    3, // TODO
                    &to_hex(include_bytes!("../../../build/transaction_sys.wasm")),
                )?,
                genesis_contract_json(
                    "account-sys",
                    "auth-fake-sys",
                    2, // TODO
                    &to_hex(include_bytes!("../../../build/account_sys.wasm")),
                )?,
                genesis_contract_json(
                    "proxy-sys",
                    "auth-fake-sys",
                    0,
                    &to_hex(include_bytes!("../../../build/proxy_sys.wasm")),
                )?,
                genesis_contract_json(
                    "auth-fake-sys",
                    "auth-fake-sys",
                    0,
                    &to_hex(include_bytes!("../../../build/auth_fake_sys.wasm")),
                )?,
                genesis_contract_json(
                    "auth-ec-sys",
                    "auth-fake-sys",
                    0,
                    &to_hex(include_bytes!("../../../build/auth_ec_sys.wasm")),
                )?,
                genesis_contract_json(
                    "verifyec-sys",
                    "auth-fake-sys",
                    0,
                    &to_hex(include_bytes!("../../../build/verify_ec_sys.wasm")),
                )?,
                genesis_contract_json(
                    "common-sys",
                    "auth-fake-sys",
                    0,
                    &to_hex(include_bytes!("../../../build/common_sys.wasm")),
                )?,
                genesis_contract_json(
                    "account-rpc", // TODO: need -sys suffix
                    "auth-fake-sys",
                    0,
                    &to_hex(include_bytes!("../../../build/rpc_account_sys.wasm")),
                )?,
                genesis_contract_json(
                    "explore-sys",
                    "auth-fake-sys",
                    0,
                    &to_hex(include_bytes!("../../../build/explore_sys.wasm")),
                )?,
            ]),
        )?],
    )?)
} // boot_trx

fn boot_trx2(expiration: &DateTime<Utc>) -> Result<SignedTransaction, anyhow::Error> {
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

    Ok(SignedTransaction {
        transaction: Transaction {
            tapos: Tapos {
                expiration: TimePointSec {
                    seconds: expiration.timestamp() as u32,
                },
                flags: 0,
                ref_block_prefix: 0,
                ref_block_num: 0,
            },
            actions: vec![Action {
                sender: AccountNumber { value: 0 },
                contract: AccountNumber { value: 0 },
                method: MethodNumber::from_str("boot")?,
                raw_data: genesis_action_data.packed_bytes(),
            }],
            claims: vec![],
        },
        proofs: vec![],
    })
} // boot_trx2

#[allow(clippy::vec_init_then_push)]
pub(super) async fn boot(args: &Args, client: reqwest::Client) -> Result<(), anyhow::Error> {
    let mut signed_transactions: Vec<String> = Vec::new();

    let expiration = Utc::now() + Duration::seconds(10);

    let bt = boot_trx(&expiration)?;
    let old_bt_packed = pack_signed_transaction(&bt);
    let old = to_hex(old_bt_packed.as_slice());

    let new_bt = boot_trx2(&expiration)?;
    let new_bt_packed = new_bt.packed_bytes();
    let new = to_hex(new_bt_packed.as_slice());

    if old != new {
        panic!("old boot genesis contracts bytes differs from new boot fracpack bytes");
    } else {
        println!("boot genesis comparison ok!");
    }

    signed_transactions.push(bt);

    let expiration = Utc::now() + Duration::seconds(10);

    signed_transactions.push(signed_transaction_json(&transaction_json(
        &expiration.to_rfc3339_opts(SecondsFormat::Millis, true),
        &[
            action_json("account-sys", "account-sys", "startup", &startup()?)?,
            // common-sys
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
            // account-sys
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
            // explore-sys
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
        ],
    )?)?);

    let mut signed_transactions_json: String = "[".to_owned();
    signed_transactions_json.push_str(&signed_transactions.join(","));
    signed_transactions_json.push(']');
    let packed_signed_transactions =
        bridge::ffi::pack_signed_transactions(&signed_transactions_json);

    // >>> USING NEW RUST FRACPACK
    let startup_data = Startup {
        existing_accounts: vec![],
    };
    let startup_action = Action {
        sender: AccountNumber::from_str("account-sys")?,
        contract: AccountNumber::from_str("account-sys")?,
        method: MethodNumber::from_str("startup")?,
        raw_data: startup_data.packed_bytes(),
    };

    let new_signed_transactions: Vec<SignedTransaction> = vec![
        new_bt,
        SignedTransaction {
            transaction: Transaction {
                tapos: Tapos {
                    expiration: TimePointSec {
                        seconds: expiration.timestamp() as u32,
                    },
                    flags: 0,
                    ref_block_prefix: 0,
                    ref_block_num: 0,
                },
                actions: vec![
                    startup_action,
                    reg_rpc2("common-sys", "common-sys")?,
                    store_sys2(
                        "common-sys",
                        "/",
                        "text/html",
                        include_bytes!("../../../contracts/user/common_sys/ui/index.html"),
                    )?,
                    store_sys2(
                        "common-sys",
                        "/common/rpc.mjs",
                        "text/javascript",
                        include_bytes!("../../../contracts/user/common_sys/common/rpc.mjs"),
                    )?,
                    store_sys2(
                        "common-sys",
                        "/common/useGraphQLQuery.mjs",
                        "text/javascript",
                        include_bytes!(
                            "../../../contracts/user/common_sys/common/useGraphQLQuery.mjs"
                        ),
                    )?,
                    store_sys2(
                        "common-sys",
                        "/common/SimpleUI.mjs",
                        "text/javascript",
                        include_bytes!("../../../contracts/user/common_sys/common/SimpleUI.mjs"),
                    )?,
                    store_sys2(
                        "common-sys",
                        "/ui/index.js",
                        "text/javascript",
                        include_bytes!("../../../contracts/user/common_sys/ui/index.js"),
                    )?,
                    reg_rpc2("account-sys", "account-rpc")?,
                    store_sys2(
                        "account-rpc",
                        "/",
                        "text/html",
                        include_bytes!("../../../contracts/system/rpc_account_sys/ui/index.html"),
                    )?,
                    store_sys2(
                        "account-rpc",
                        "/ui/index.js",
                        "text/javascript",
                        include_bytes!("../../../contracts/system/rpc_account_sys/ui/index.js"),
                    )?,
                    reg_rpc2("explore-sys", "explore-sys")?,
                    store_sys2(
                        "explore-sys",
                        "/",
                        "text/html",
                        include_bytes!("../../../contracts/user/explore_sys/ui/index.html"),
                    )?,
                    store_sys2(
                        "explore-sys",
                        "/ui/index.js",
                        "text/javascript",
                        include_bytes!("../../../contracts/user/explore_sys/ui/index.js"),
                    )?,
                ],
                claims: vec![],
            },
            proofs: vec![],
        },
    ];

    let mut new_packed_signed_transactions: Vec<u8> = vec![];
    new_signed_transactions.pack(&mut new_packed_signed_transactions);

    let old_boot = to_hex(packed_signed_transactions.as_slice());
    let new_boot = to_hex(new_packed_signed_transactions.as_slice());
    if old_boot != new_boot {
        panic!("old boot bytes differs from new boot bytes");
    } else {
        println!("boot comparison ok!");
    }

    push_boot(
        args,
        client,
        new_packed_signed_transactions.as_slice().into(),
    )
    .await?;
    println!("Ok");
    Ok(())
}
