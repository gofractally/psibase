use anyhow::{anyhow, Context};
use chrono::{Duration, Utc};
use clap::{Parser, Subcommand};
use fracpack::{Pack, Unpack};
use futures::future::join_all;
use hmac::{Hmac, Mac};
use indicatif::{ProgressBar, ProgressStyle};
use jwt::SignWithKey;
use psibase::services::{account_sys, auth_ec_sys, auth_sys, proxy_sys, psispace_sys, setcode_sys};
use psibase::{
    account, apply_proxy, create_boot_transactions, get_tapos_for_head, push_transaction,
    sign_transaction, AccountNumber, Action, AnyPrivateKey, AnyPublicKey, AutoAbort,
    DirectoryRegistry, ExactAccountNumber, PackageRegistry, PublicKey, SignedTransaction, Tapos,
    TaposRefBlock, TimePointSec, Transaction,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::fs::{metadata, read_dir};
use std::path::PathBuf;

/// Interact with a running psinode
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// API Endpoint
    #[clap(
        short = 'a',
        long,
        value_name = "URL",
        env = "PSINODE_URL",
        default_value = "http://psibase.127.0.0.1.sslip.io:8080/"
    )]
    api: Url,

    /// HTTP proxy
    #[clap(long, value_name = "URL")]
    proxy: Option<Url>,

    /// Sign with this key (repeatable)
    #[clap(short = 's', long, value_name = "KEY")]
    sign: Vec<AnyPrivateKey>,

    /// Suppress "Ok" message
    #[clap(long)]
    suppress_ok: bool,

    #[clap(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Boot a development chain
    Boot {
        /// Set all accounts to authenticate using this key
        #[clap(short = 'k', long, value_name = "KEY")]
        key: Option<AnyPublicKey>,

        /// Sets the name of the block producer
        #[clap(short = 'p', long, value_name = "PRODUCER")]
        producer: ExactAccountNumber,

        services: Vec<String>,
    },

    /// Create or modify an account
    Create {
        /// Account to create
        account: ExactAccountNumber,

        /// Set the account to authenticate using this key. Also works
        /// if the account already exists.
        #[clap(short = 'k', long, value_name = "KEY")]
        key: Option<AnyPublicKey>,

        /// The account won't be secured; anyone can authorize as this
        /// account without signing. This option does nothing if the
        /// account already exists. Caution: this option should not
        /// be used on production or public chains.
        #[clap(short = 'i', long)]
        insecure: bool,

        /// Sender to use when creating the account.
        #[clap(
            short = 'S',
            long,
            value_name = "SENDER",
            default_value = "account-sys"
        )]
        sender: ExactAccountNumber,
    },

    /// Modify an account
    Modify {
        /// Account to modify
        account: ExactAccountNumber,

        /// Set the account to authenticate using this key
        #[clap(short = 'k', long, value_name = "KEY")]
        key: Option<AnyPublicKey>,

        /// Make the account insecure, even if it has been previously
        /// secured. Anyone will be able to authorize as this account
        /// without signing. Caution: this option should not be used
        /// on production or public chains.
        #[clap(short = 'i', long)]
        insecure: bool,
    },

    /// Deploy a service
    Deploy {
        /// Account to deploy service on
        account: ExactAccountNumber,

        /// Filename containing the service
        filename: String,

        /// Create the account if it doesn't exist. Also set the account to
        /// authenticate using this key, even if the account already existed.
        #[clap(short = 'c', long, value_name = "KEY")]
        create_account: Option<AnyPublicKey>,

        /// Create the account if it doesn't exist. The account won't be secured;
        /// anyone can authorize as this account without signing. Caution: this option
        /// should not be used on production or public chains.
        #[clap(short = 'i', long)]
        create_insecure_account: bool,

        /// Register the service with ProxySys. This allows the service to host a
        /// website, serve RPC requests, and serve GraphQL requests.
        #[clap(short = 'p', long)]
        register_proxy: bool,

        /// Sender to use when creating the account.
        #[clap(
            short = 'S',
            long,
            value_name = "SENDER",
            default_value = "account-sys"
        )]
        sender: ExactAccountNumber,
    },

    /// Upload a file to a service
    Upload {
        /// Service to upload to
        service: ExactAccountNumber,

        /// Source filename to upload
        source: String,

        /// Destination path within service
        dest: String,

        /// MIME content type of file
        #[clap(short = 't', long, value_name = "MIME-TYPE")]
        content_type: Option<String>,

        /// Upload a directory recursively
        #[clap(short = 'r', long)]
        recursive: bool,

        /// Sender to use; defaults to <SERVICE>
        #[clap(short = 'S', long, value_name = "SENDER")]
        sender: Option<ExactAccountNumber>,
    },

    /// Create a bearer token that can be used to access a node
    CreateToken {
        /// The lifetime of the new token
        #[clap(short = 'e', long, default_value = "3600", value_name = "SECONDS")]
        expires_after: i64,

        /// The access mode: "r" or "rw"
        #[clap(short = 'm', long, default_value = "rw")]
        mode: String,
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

#[derive(Serialize, Deserialize, Pack, Unpack)]
struct NewAccountAction {
    account: AccountNumber,
    auth_service: AccountNumber,
    require_new: bool,
}

fn new_account_action(sender: AccountNumber, account: AccountNumber) -> Action {
    account_sys::Wrapper::pack_from(sender).newAccount(account, account!("auth-any-sys"), false)
}

fn set_key_action(account: AccountNumber, key: &AnyPublicKey) -> Action {
    if key.key.service == account!("verifyec-sys") {
        auth_ec_sys::Wrapper::pack_from(account)
            .setKey(PublicKey::unpacked(&key.key.rawData).unwrap())
    } else if key.key.service == account!("verify-sys") {
        auth_sys::Wrapper::pack_from(account).setKey(key.key.rawData.to_vec())
    } else {
        panic!("unknown account service");
    }
}

fn set_auth_service_action(account: AccountNumber, auth_service: AccountNumber) -> Action {
    account_sys::Wrapper::pack_from(account).setAuthServ(auth_service)
}

#[derive(Serialize, Deserialize, Pack, Unpack)]
struct SetCodeAction {
    service: AccountNumber,
    vm_type: i8,
    vm_version: i8,
    code: Vec<u8>,
}

fn set_code_action(account: AccountNumber, wasm: Vec<u8>) -> Action {
    setcode_sys::Wrapper::pack_from(account).setCode(account, 0, 0, wasm.into())
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

fn with_tapos(tapos: &TaposRefBlock, actions: Vec<Action>) -> Transaction {
    let now_plus_10secs = Utc::now() + Duration::seconds(10);
    let expiration = TimePointSec {
        seconds: now_plus_10secs.timestamp() as u32,
    };
    Transaction {
        tapos: Tapos {
            expiration,
            refBlockSuffix: tapos.ref_block_suffix,
            flags: 0,
            refBlockIndex: tapos.ref_block_index,
        },
        actions,
        claims: vec![],
    }
}

async fn create(
    args: &Args,
    client: reqwest::Client,
    sender: AccountNumber,
    account: AccountNumber,
    key: &Option<AnyPublicKey>,
    insecure: bool,
) -> Result<(), anyhow::Error> {
    let mut actions: Vec<Action> = Vec::new();

    if key.is_some() && insecure {
        return Err(anyhow!("--key and --insecure cannot be used together"));
    }
    if key.is_none() && !insecure {
        return Err(anyhow!("either --key or --insecure must be used"));
    }

    actions.push(new_account_action(sender, account));

    if let Some(key) = key {
        actions.push(set_key_action(account, key));
        actions.push(set_auth_service_action(account, key.auth_service()));
    }

    let trx = with_tapos(
        &get_tapos_for_head(&args.api, client.clone()).await?,
        actions,
    );
    push_transaction(
        &args.api,
        client,
        sign_transaction(trx, &args.sign)?.packed(),
    )
    .await?;
    if !args.suppress_ok {
        println!("Ok");
    }
    Ok(())
}

async fn modify(
    args: &Args,
    client: reqwest::Client,
    account: AccountNumber,
    key: &Option<AnyPublicKey>,
    insecure: bool,
) -> Result<(), anyhow::Error> {
    let mut actions: Vec<Action> = Vec::new();

    if key.is_some() && insecure {
        return Err(anyhow!("--key and --insecure cannot be used together"));
    }
    if key.is_none() && !insecure {
        return Err(anyhow!("either --key or --insecure must be used"));
    }

    if let Some(key) = key {
        actions.push(set_key_action(account, key));
        actions.push(set_auth_service_action(account, key.auth_service()));
    }

    if insecure {
        actions.push(set_auth_service_action(account, account!("auth-any-sys")));
    }

    let trx = with_tapos(
        &get_tapos_for_head(&args.api, client.clone()).await?,
        actions,
    );
    push_transaction(
        &args.api,
        client,
        sign_transaction(trx, &args.sign)?.packed(),
    )
    .await?;
    if !args.suppress_ok {
        println!("Ok");
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn deploy(
    args: &Args,
    client: reqwest::Client,
    sender: AccountNumber,
    account: AccountNumber,
    filename: &str,
    create_account: &Option<AnyPublicKey>,
    create_insecure_account: bool,
    register_proxy: bool,
) -> Result<(), anyhow::Error> {
    let wasm = std::fs::read(filename).with_context(|| format!("Can not read {}", filename))?;

    let mut actions: Vec<Action> = Vec::new();

    if create_account.is_some() && create_insecure_account {
        return Err(anyhow!(
            "--create-account and --create-insecure-account cannot be used together"
        ));
    }

    if create_account.is_some() || create_insecure_account {
        actions.push(new_account_action(sender, account));
    }

    // This happens before the set_code as a safety measure.
    // If the set_code was first, and the user didn't actually
    // have the matching private key, then the transaction would
    // lock out the user. Putting this before the set_code causes
    // the set_code to require the private key, failing the transaction
    // if the user doesn't have it.
    if let Some(key) = create_account {
        actions.push(set_key_action(account, key));
        actions.push(set_auth_service_action(account, key.auth_service()));
    }

    actions.push(set_code_action(account, wasm));

    if register_proxy {
        actions.push(reg_server(account, account));
    }

    let trx = with_tapos(
        &get_tapos_for_head(&args.api, client.clone()).await?,
        actions,
    );
    push_transaction(
        &args.api,
        client,
        sign_transaction(trx, &args.sign)?.packed(),
    )
    .await?;
    if !args.suppress_ok {
        println!("Ok");
    }
    Ok(())
}

async fn upload(
    args: &Args,
    client: reqwest::Client,
    service: AccountNumber,
    sender: Option<ExactAccountNumber>,
    dest: &str,
    content_type: &Option<String>,
    source: &str,
) -> Result<(), anyhow::Error> {
    let sender = if let Some(s) = sender {
        s.into()
    } else {
        service
    };

    let deduced_content_type = match content_type {
        Some(t) => t.clone(),
        None => {
            let guess = mime_guess::from_path(source);
            let Some(t) = guess.first() else {
                return Err(anyhow!(format!("Unknown mime type: {}", source)));
            };
            t.essence_str().to_string()
        }
    };

    let actions = vec![store_sys(
        service,
        sender,
        dest,
        &deduced_content_type,
        &std::fs::read(source).with_context(|| format!("Can not read {}", source))?,
    )];
    let trx = with_tapos(
        &get_tapos_for_head(&args.api, client.clone()).await?,
        actions,
    );

    push_transaction(
        &args.api,
        client,
        sign_transaction(trx, &args.sign)?.packed(),
    )
    .await?;
    if !args.suppress_ok {
        println!("Ok");
    }
    Ok(())
}

fn fill_tree(
    service: AccountNumber,
    sender: AccountNumber,
    actions: &mut Vec<(String, Action)>,
    dest: &str,
    source: &str,
    top: bool,
) -> Result<(), anyhow::Error> {
    let md = metadata(source)?;
    if md.is_file() {
        let guess = mime_guess::from_path(source);
        if let Some(t) = guess.first() {
            println!("{} <=== {}   {}", dest, source, t.essence_str());
            actions.push((
                dest.to_owned(),
                store_sys(
                    service,
                    sender,
                    dest,
                    t.essence_str(),
                    &std::fs::read(source).with_context(|| format!("Can not read {}", source))?,
                ),
            ));
        } else {
            if top {
                return Err(anyhow!("Unknown mime type: {}", source));
            } else {
                println!("Skip unknown mime type: {}", source);
            }
        }
    } else if md.is_dir() {
        for path in read_dir(source)? {
            let path = path?;
            let d = dest.to_owned() + "/" + path.file_name().to_str().unwrap();
            fill_tree(
                service,
                sender,
                actions,
                &d,
                path.path().to_str().unwrap(),
                false,
            )?;
        }
    } else {
        if top {
            return Err(anyhow!("{} is not a file or directory", source));
        } else {
            println!("Skip {}", source);
        }
    }
    Ok(())
}

async fn monitor_trx(
    args: &Args,
    client: &reqwest::Client,
    files: Vec<String>,
    trx: SignedTransaction,
    progress: ProgressBar,
    n: u64,
) -> Result<(), anyhow::Error> {
    let result = push_transaction(&args.api, client.clone(), trx.packed()).await;
    if let Err(err) = result {
        progress.suspend(|| {
            println!("=====\n{:?}", err);
            println!("-----\nThese files were in this failed transaction:");
            for f in files {
                println!("    {}", f);
            }
        });
        return Err(err);
    } else {
        progress.inc(n);
    }
    Ok(())
}

fn data_directory() -> Result<PathBuf, anyhow::Error> {
    let exe = std::env::current_exe()?.canonicalize()?;
    let Some(parent) = exe.parent() else {
        return Err(anyhow!("Parent not found"));
    };
    let base = if parent.ends_with("bin") {
        parent.parent().unwrap()
    } else if parent.ends_with("rust/release") {
        parent.parent().unwrap().parent().unwrap()
    } else {
        parent
    };
    Ok(base.join("share/psibase"))
}

async fn boot(
    args: &Args,
    client: reqwest::Client,
    key: &Option<AnyPublicKey>,
    producer: ExactAccountNumber,
    services: &Vec<String>,
) -> Result<(), anyhow::Error> {
    let now_plus_30secs = Utc::now() + Duration::seconds(30);
    let expiration = TimePointSec {
        seconds: now_plus_30secs.timestamp() as u32,
    };
    let default_services = vec!["Default".to_string()];
    let package_registry = DirectoryRegistry::new(data_directory()?.join("packages"));
    let mut packages = package_registry.resolve(if services.is_empty() {
        &default_services[..]
    } else {
        &services[..]
    })?;
    let (boot_transactions, transactions) =
        create_boot_transactions(key, producer.into(), true, expiration, &mut packages)?;

    let progress = ProgressBar::new((transactions.len() + 1) as u64)
        .with_style(ProgressStyle::with_template("{wide_bar} {pos}/{len}")?);
    push_boot(args, &client, boot_transactions.packed()).await?;
    progress.inc(1);
    for transaction in transactions {
        push_transaction(&args.api, client.clone(), transaction.packed()).await?;
        progress.inc(1)
    }
    if !args.suppress_ok {
        println!("Ok");
    }
    Ok(())
}

async fn push_boot_impl(
    args: &Args,
    client: &reqwest::Client,
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
        return Err(anyhow!("{}", response.text().await?));
    }
    let text = response.text().await?;
    let json: Value = serde_json::de::from_str(&text)?;
    // println!("{:#?}", json);
    let err = json.get("error").and_then(|v| v.as_str());
    if let Some(e) = err {
        if !e.is_empty() {
            return Err(anyhow!("{}", e));
        }
    }
    Ok(())
}

async fn push_boot(
    args: &Args,
    client: &reqwest::Client,
    packed: Vec<u8>,
) -> Result<(), anyhow::Error> {
    push_boot_impl(args, client, packed)
        .await
        .context("Failed to boot")?;
    Ok(())
}

async fn upload_tree(
    args: &Args,
    client: reqwest::Client,
    service: AccountNumber,
    sender: Option<ExactAccountNumber>,
    mut dest: &str,
    source: &str,
) -> Result<(), anyhow::Error> {
    let sender = if let Some(s) = sender {
        s.into()
    } else {
        service
    };

    while !dest.is_empty() && dest.ends_with('/') {
        dest = &dest[0..dest.len() - 1];
    }

    let mut actions = Vec::new();
    fill_tree(service, sender, &mut actions, dest, source, true)?;

    let tapos = get_tapos_for_head(&args.api, client.clone()).await?;
    let mut running = Vec::new();
    let progress = ProgressBar::new(actions.len() as u64).with_style(ProgressStyle::with_template(
        "{wide_bar} {pos}/{len} files",
    )?);

    while !actions.is_empty() {
        let mut n = 0;
        let mut size = 0;
        while n < actions.len() && n < 10 && size < 64 * 1024 {
            size += actions[n].1.rawData.len();
            n += 1;
        }

        let (selected_files, selected_actions) = actions.drain(..n).unzip();
        let trx = with_tapos(&tapos, selected_actions);
        running.push(monitor_trx(
            args,
            &client,
            selected_files,
            sign_transaction(trx, &args.sign)?,
            progress.clone(),
            n as u64,
        ));
    }

    let num_trx = running.len();
    let num_failed = join_all(running)
        .await
        .iter()
        .filter(|x| x.is_err())
        .count();
    if num_failed > 0 {
        progress.abandon();
        return Err(anyhow!("{}/{} failed transactions", num_failed, num_trx));
    }

    if !args.suppress_ok {
        println!("Ok");
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct TokenData<'a> {
    exp: i64,
    mode: &'a str,
}

fn create_token(expires_after: Duration, mode: &str) -> Result<(), anyhow::Error> {
    let key_text = rpassword::prompt_password("Enter Key: ")?;
    let claims = TokenData {
        exp: (Utc::now() + expires_after).timestamp(),
        mode: mode,
    };
    let key: Hmac<Sha256> = Hmac::new_from_slice(key_text.as_bytes())?;
    let token = claims.sign_with_key(&key)?;
    println!("{}", token);
    Ok(())
}

async fn build_client(args: &Args) -> Result<(reqwest::Client, Option<AutoAbort>), anyhow::Error> {
    let (builder, result) = apply_proxy(reqwest::Client::builder(), &args.proxy).await?;
    Ok((builder.build()?, result))
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = Args::parse();
    let (client, _proxy) = build_client(&args).await?;
    match &args.command {
        Command::Boot {
            key,
            producer,
            services,
        } => boot(&args, client, key, *producer, services).await?,
        Command::Create {
            account,
            key,
            insecure,
            sender,
        } => {
            create(
                &args,
                client,
                (*sender).into(),
                (*account).into(),
                key,
                *insecure,
            )
            .await?
        }
        Command::Modify {
            account,
            key,
            insecure,
        } => modify(&args, client, (*account).into(), key, *insecure).await?,
        Command::Deploy {
            account,
            filename,
            create_account,
            create_insecure_account,
            register_proxy,
            sender,
        } => {
            deploy(
                &args,
                client,
                (*sender).into(),
                (*account).into(),
                filename,
                create_account,
                *create_insecure_account,
                *register_proxy,
            )
            .await?
        }
        Command::Upload {
            service,
            source,
            dest,
            content_type,
            recursive,
            sender,
        } => {
            if *recursive {
                if content_type.is_some() {
                    return Err(anyhow!("--recursive is incompatible with --content-type"));
                }
                upload_tree(&args, client, (*service).into(), *sender, dest, source).await?
            } else {
                upload(
                    &args,
                    client,
                    (*service).into(),
                    *sender,
                    dest,
                    content_type,
                    source,
                )
                .await?
            }
        }
        Command::CreateToken {
            expires_after,
            mode,
        } => create_token(Duration::seconds(*expires_after), mode)?,
    }

    Ok(())
}
