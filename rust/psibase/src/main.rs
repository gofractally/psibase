use anyhow::{Context, Result};
use chrono::{Duration, SecondsFormat, Utc};
use clap::{Parser, Subcommand};
use custom_error::custom_error;
use reqwest::Url;
use serde_json::Value;

mod boot;
mod bridge;

custom_error! { Error
    BadResponseFormat   = "Invalid response format from server",
    Msg{s:String}       = "{s}",
}

/// Interact with a running psinode
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// API Endpoint
    #[clap(
        short = 'a',
        long,
        default_value = "http://psibase.127.0.0.1.sslip.io:8080/"
    )]
    api: String,

    #[clap(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Boot a development chain
    Boot {},

    /// Install a contract
    Install {
        /// Account to install contract on
        account: String,

        /// Filename containing the contract
        filename: String,

        /// Create the account if it doesn't exist. The account won't be secured;
        /// anyone can authorize as this account without signing. Caution: this option
        /// should not be used on production or public chains.
        #[clap(short = 'i', long)]
        create_insecure_account: bool,

        /// Register the contract with proxy_sys. This allows the contract to host a
        /// website, serve RPC requests, and serve GraphQL requests.
        #[clap(short = 'p', long)]
        register_proxy: bool,
    },

    /// Upload a file to a contract
    Upload {
        /// Contract to upload to
        contract: String,

        /// Path to store within contract
        path: String,

        /// MIME content type of file
        content_type: String,

        /// Filename to upload
        filename: String,
    },
}

// TODO: move to lib
fn to_hex(bytes: &[u8]) -> String {
    let mut result: Vec<u8> = Vec::with_capacity(bytes.len() * 2);
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize]);
        result.push(DIGITS[(byte & 0x0f) as usize]);
    }
    String::from_utf8(result).unwrap()
}

// TODO: replace
fn new_account(
    account: &str,
    auth_contract: &str,
    require_new: bool,
) -> Result<String, anyhow::Error> {
    Ok(to_hex(
        bridge::ffi::pack_new_account(&format!(
            r#"{{
                "account": {},
                "authContract": {},
                "require_new": {}
            }}"#,
            serde_json::to_string(account)?,
            serde_json::to_string(auth_contract)?,
            if require_new { "true" } else { "false" }
        ))
        .as_slice(),
    ))
}

// TODO: replace
fn set_code(contract: &str, code: &str) -> Result<String, anyhow::Error> {
    Ok(to_hex(
        bridge::ffi::pack_set_code(&format!(
            r#"{{
                "contract": {},
                "vmType": 0,
                "vmVersion": 0,
                "code": {}
            }}"#,
            serde_json::to_string(contract)?,
            serde_json::to_string(code)?
        ))
        .as_slice(),
    ))
}

// TODO: replace with struct
fn action_json(
    sender: &str,
    contract: &str,
    method: &str,
    raw_data: &str,
) -> Result<String, anyhow::Error> {
    Ok(format!(
        r#"{{
            "sender": {},
            "contract": {},
            "method": {},
            "rawData": {}
        }}"#,
        serde_json::to_string(sender)?,
        serde_json::to_string(contract)?,
        serde_json::to_string(method)?,
        serde_json::to_string(raw_data)?
    ))
}

// TODO: replace with struct
fn transaction_json(expiration: &str, actions: &[String]) -> Result<String, anyhow::Error> {
    Ok(format!(
        r#"{{
            "tapos": {{
                "expiration": {}
            }},
            "actions": [{}]
        }}"#,
        serde_json::to_string(expiration)?,
        actions.join(",")
    ))
}

// TODO: replace with struct
fn signed_transaction_json(trx: &str) -> Result<String, anyhow::Error> {
    Ok(format!(
        r#"{{
            "transaction": {}
        }}"#,
        trx
    ))
}

fn reg_rpc(contract: &str, rpc_contract: &str) -> Result<String, anyhow::Error> {
    action_json(
        contract,
        "proxy-sys",
        "registerServer",
        &to_hex(
            bridge::ffi::pack_register_server(&format!(
                r#"{{
                    "contract": {},
                    "rpc_contract": {}
                }}"#,
                serde_json::to_string(contract)?,
                serde_json::to_string(rpc_contract)?,
            ))
            .as_slice(),
        ),
    )
}

async fn push_transaction_impl(
    args: &Args,
    client: reqwest::Client,
    packed: Vec<u8>,
) -> Result<(), anyhow::Error> {
    let mut response = client
        .post(Url::parse(&args.api)?.join("native/push_transaction")?)
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

async fn push_transaction(
    args: &Args,
    client: reqwest::Client,
    packed: Vec<u8>,
) -> Result<(), anyhow::Error> {
    push_transaction_impl(args, client, packed)
        .await
        .context("Failed to push transaction")?;
    Ok(())
}

fn store_sys(
    contract: &str,
    path: &str,
    content_type: &str,
    content: &[u8],
) -> Result<String, anyhow::Error> {
    action_json(
        contract,
        contract,
        "storeSys",
        &to_hex(
            bridge::ffi::pack_upload_sys(&format!(
                r#"{{
                    "path": {},
                    "contentType": {},
                    "content": {}
                }}"#,
                serde_json::to_string(path)?,
                serde_json::to_string(content_type)?,
                serde_json::to_string(&to_hex(content))?
            ))
            .as_slice(),
        ),
    )
}

async fn install(
    args: &Args,
    client: reqwest::Client,
    account: &str,
    filename: &str,
    create_insecure_account: bool,
    register_proxy: bool,
) -> Result<(), anyhow::Error> {
    let wasm = std::fs::read(filename).with_context(|| format!("Can not read {}", filename))?;
    let mut actions: Vec<String> = Vec::new();
    if create_insecure_account {
        actions.push(action_json(
            "account-sys",
            "account-sys",
            "newAccount",
            &new_account(account, "auth-fake-sys", false)?,
        )?);
    }
    actions.push(action_json(
        account,
        "transact-sys",
        "setCode",
        &set_code(account, &to_hex(&wasm))?,
    )?);
    if register_proxy {
        actions.push(reg_rpc(account, account)?);
    }
    let signed_json = signed_transaction_json(&transaction_json(
        &(Utc::now() + Duration::seconds(10)).to_rfc3339_opts(SecondsFormat::Millis, true),
        &actions,
    )?)?;
    // println!("{}", signed_json);
    let packed_signed = bridge::ffi::pack_signed_transaction(&signed_json);
    // println!("{}", to_hex(packed_signed.as_slice()));
    push_transaction(args, client, packed_signed.as_slice().into()).await?;
    println!("Ok");
    Ok(())
}

async fn upload(
    args: &Args,
    client: reqwest::Client,
    contract: &str,
    path: &str,
    content_type: &str,
    filename: &str,
) -> Result<(), anyhow::Error> {
    let signed_json = signed_transaction_json(&transaction_json(
        &(Utc::now() + Duration::seconds(10)).to_rfc3339_opts(SecondsFormat::Millis, true),
        &[store_sys(
            contract,
            path,
            content_type,
            &std::fs::read(filename).with_context(|| format!("Can not read {}", filename))?,
        )?],
    )?)?;
    let packed_signed = bridge::ffi::pack_signed_transaction(&signed_json);
    push_transaction(args, client, packed_signed.as_slice().into()).await?;
    println!("Ok");
    Ok(())
}

/// Upload a file to a contract

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = Args::parse();
    let client = reqwest::Client::new();
    // TODO: environment variable for url
    match &args.command {
        Commands::Boot {} => boot::boot(&args, client).await?,
        Commands::Install {
            account,
            filename,
            create_insecure_account,
            register_proxy,
        } => {
            install(
                &args,
                client,
                account,
                filename,
                *create_insecure_account,
                *register_proxy,
            )
            .await?
        }
        Commands::Upload {
            contract,
            path,
            content_type,
            filename,
        } => upload(&args, client, contract, path, content_type, filename).await?,
    }

    Ok(())
}
