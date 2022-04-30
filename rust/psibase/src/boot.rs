use crate::*;

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
            "auth_contract": {},
            "flags": {},
            "vm_type": 0,
            "vm_version": 0,
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
    Ok(to_hex(bridge::ffi::pack_startup("{}").as_slice()))
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

fn boot_trx() -> Result<String, anyhow::Error> {
    signed_transaction_json(&transaction_json(
        &(Utc::now() + Duration::seconds(10)).to_rfc3339_opts(SecondsFormat::Millis, true),
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

#[allow(clippy::vec_init_then_push)]
pub(super) async fn boot(args: &Args, client: reqwest::Client) -> Result<(), anyhow::Error> {
    let mut signed_transactions: Vec<String> = Vec::new();

    signed_transactions.push(boot_trx()?);

    signed_transactions.push(signed_transaction_json(&transaction_json(
        &(Utc::now() + Duration::seconds(10)).to_rfc3339_opts(SecondsFormat::Millis, true),
        &[
            action_json("account-sys", "account-sys", "startup", &startup()?)?,
            // common-sys
            reg_rpc("common-sys", "common-sys")?,
            upload_sys(
                "common-sys",
                "/",
                "text/html",
                include_bytes!("../../../contracts/user/common_sys/ui/index.html"),
            )?,
            upload_sys(
                "common-sys",
                "/common/rpc.mjs",
                "text/javascript",
                include_bytes!("../../../contracts/user/common_sys/common/rpc.mjs"),
            )?,
            upload_sys(
                "common-sys",
                "/common/useGraphQLQuery.mjs",
                "text/javascript",
                include_bytes!("../../../contracts/user/common_sys/common/useGraphQLQuery.mjs"),
            )?,
            upload_sys(
                "common-sys",
                "/common/SimpleUI.mjs",
                "text/javascript",
                include_bytes!("../../../contracts/user/common_sys/common/SimpleUI.mjs"),
            )?,
            upload_sys(
                "common-sys",
                "/ui/index.js",
                "text/javascript",
                include_bytes!("../../../contracts/user/common_sys/ui/index.js"),
            )?,
            // account-sys
            reg_rpc("account-sys", "account-rpc")?,
            upload_sys(
                "account-rpc",
                "/",
                "text/html",
                include_bytes!("../../../contracts/system/rpc_account_sys/ui/index.html"),
            )?,
            upload_sys(
                "account-rpc",
                "/ui/index.js",
                "text/javascript",
                include_bytes!("../../../contracts/system/rpc_account_sys/ui/index.js"),
            )?,
            // explore-sys
            reg_rpc("explore-sys", "explore-sys")?,
            upload_sys(
                "explore-sys",
                "/",
                "text/html",
                include_bytes!("../../../contracts/user/explore_sys/ui/index.html"),
            )?,
            upload_sys(
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
    push_boot(args, client, packed_signed_transactions.as_slice().into()).await?;
    println!("Ok");
    Ok(())
}
