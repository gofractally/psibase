use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use clap::{Parser, Subcommand};
use custom_error::custom_error;
use fracpack::Packable;
use libpsibase::{
    AccountNumber, Action, MethodNumber, SignedTransaction, Tapos, TimePointSec, Transaction,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;

mod boot;

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

#[allow(dead_code)] // TODO: move to lib if still needed
fn to_hex(bytes: &[u8]) -> String {
    let mut result: Vec<u8> = Vec::with_capacity(bytes.len() * 2);
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize]);
        result.push(DIGITS[(byte & 0x0f) as usize]);
    }
    String::from_utf8(result).unwrap()
}

#[derive(Serialize, Deserialize, psi_macros::Fracpack)]
pub struct NewAccountAction {
    pub account: AccountNumber,
    pub auth_contract: AccountNumber,
    pub require_new: bool,
}

fn new_account_action(account: &str) -> Result<Action, anyhow::Error> {
    let new_account_action = NewAccountAction {
        account: AccountNumber::from_str(account)?,
        auth_contract: AccountNumber::from_str("auth-fake-sys")?,
        require_new: false,
    };
    Ok(Action {
        sender: AccountNumber::from_str("account-sys")?,
        contract: AccountNumber::from_str("account-sys")?,
        method: MethodNumber::from_str("newAccount")?,
        raw_data: new_account_action.packed_bytes(),
    })
}

#[derive(Serialize, Deserialize, psi_macros::Fracpack)]
pub struct SetCodeAction {
    pub contract: AccountNumber,
    pub vm_type: i8,
    pub vm_version: i8,
    pub code: Vec<u8>,
}

fn set_code_action(account: &str, wasm: Vec<u8>) -> Result<Action, anyhow::Error> {
    let set_code_action = SetCodeAction {
        contract: AccountNumber::from_str(account)?,
        vm_type: 0,
        vm_version: 0,
        code: wasm,
    };
    Ok(Action {
        sender: AccountNumber::from_str(account)?,
        contract: AccountNumber::from_str("transact-sys")?,
        method: MethodNumber::from_str("setCode")?,
        raw_data: set_code_action.packed_bytes(),
    })
}

fn reg_rpc(contract: &str, rpc_contract: &str) -> Result<Action, anyhow::Error> {
    // todo: should we convert this action data to a proper struct?
    let data = (
        AccountNumber::from_str(contract)?,
        AccountNumber::from_str(rpc_contract)?,
    );

    Ok(Action {
        sender: AccountNumber::from_str(contract)?,
        contract: AccountNumber::from_str("proxy-sys")?,
        method: MethodNumber::from_str("registerServer")?,
        raw_data: data.packed_bytes(),
    })
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
) -> Result<Action, anyhow::Error> {
    // todo: should we convert this action data to a proper struct?
    let data = (path.to_string(), content_type.to_string(), content.to_vec());

    Ok(Action {
        sender: AccountNumber::from_str(contract)?,
        contract: AccountNumber::from_str(contract)?,
        method: MethodNumber::from_str("storeSys")?,
        raw_data: data.packed_bytes(),
    })
}

pub fn wrap_basic_trx(actions: Vec<Action>) -> SignedTransaction {
    let now_plus_10secs = Utc::now() + Duration::seconds(10);
    let expiration = TimePointSec {
        seconds: now_plus_10secs.timestamp() as u32,
    };

    SignedTransaction {
        transaction: Transaction {
            tapos: Tapos {
                expiration,
                flags: 0,
                ref_block_prefix: 0,
                ref_block_num: 0,
            },
            actions,
            claims: vec![],
        },
        proofs: vec![],
    }
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

    let mut actions: Vec<Action> = Vec::new();

    if create_insecure_account {
        actions.push(new_account_action(account)?);
    }

    actions.push(set_code_action(account, wasm)?);

    if register_proxy {
        actions.push(reg_rpc(account, account)?);
    }

    let trx = wrap_basic_trx(actions);
    push_transaction(args, client, trx.packed_bytes()).await?;
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
    let actions = vec![store_sys(
        contract,
        path,
        content_type,
        &std::fs::read(filename).with_context(|| format!("Can not read {}", filename))?,
    )?];
    let trx = wrap_basic_trx(actions);

    push_transaction(args, client, trx.packed_bytes()).await?;
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
