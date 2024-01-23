use anyhow::{anyhow, Context};
use chrono::{Duration, Utc};
use clap::{Parser, Subcommand};
use fracpack::Pack;
use futures::future::join_all;
use hmac::{Hmac, Mac};
use indicatif::{ProgressBar, ProgressStyle};
use jwt::SignWithKey;
use psibase::services::psispace_sys;
use psibase::{
    account, apply_proxy, create_boot_transactions, get_tapos_for_head, new_account_action,
    push_transaction, reg_server, set_auth_service_action, set_code_action, set_key_action,
    sign_transaction, AccountNumber, Action, AnyPrivateKey, AnyPublicKey, AutoAbort,
    DirectoryRegistry, ExactAccountNumber, HTTPRegistry, PackageList, PackageRegistry,
    SignedTransaction, Tapos, TaposRefBlock, TimePointSec, Transaction,
};
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::fs::{metadata, read_dir};
use std::path::{Path, PathBuf};

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

        /// A URL or path to a package repository (repeatable)
        #[clap(long, value_name = "URL")]
        package_source: Vec<String>,

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
        dest: Option<String>,

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

    /// Install apps to the chain
    Install {
        /// Packages to install
        packages: Vec<String>,

        /// Set all accounts to authenticate using this key
        #[clap(short = 'k', long, value_name = "KEY")]
        key: Option<AnyPublicKey>,
    },

    /// Prints a list of apps
    List {
        /// List all apps
        #[clap(long)]
        all: bool,
        /// List apps that are available in the repository, but not currently installed
        #[clap(long)]
        available: bool,
        /// List installed apps
        #[clap(long)]
        installed: bool,
    },

    /// Find packages
    Search {
        /// Regular expressions to search for in package names and descriptions
        patterns: Vec<String>,
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
    dest: &Option<String>,
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

    let normalized_dest = if let Some(d) = dest {
        if d.starts_with('/') {
            d.to_string()
        } else {
            "/".to_string() + d
        }
    } else {
        "/".to_string() + Path::new(source).file_name().unwrap().to_str().unwrap()
    };

    let actions = vec![store_sys(
        service,
        sender,
        &normalized_dest,
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
    _package_source: &Vec<String>,
    services: &Vec<String>,
) -> Result<(), anyhow::Error> {
    let now_plus_30secs = Utc::now() + Duration::seconds(30);
    let expiration = TimePointSec {
        seconds: now_plus_30secs.timestamp() as u32,
    };
    let default_services = vec!["Default".to_string()];
    // let package_registry = DirectoryRegistry::new(data_directory()?.join("packages"));
    let package_registry = HTTPRegistry::new(
        Path::new("/tmp/psibase"),
        Url::parse("http://localhost:8080/packages/")?,
        client.clone(),
    )
    .await?;
    let mut packages = package_registry
        .resolve(if services.is_empty() {
            &default_services[..]
        } else {
            &services[..]
        })
        .await?;
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

fn normalize_upload_path(path: &Option<String>) -> String {
    let mut result = String::new();
    if let Some(s) = path {
        if !s.starts_with('/') {
            result.push('/');
        }
        result.push_str(s);
        while result.ends_with('/') {
            result.pop();
        }
    }
    result
}

async fn upload_tree(
    args: &Args,
    client: reqwest::Client,
    service: AccountNumber,
    sender: Option<ExactAccountNumber>,
    dest: &Option<String>,
    source: &str,
) -> Result<(), anyhow::Error> {
    let sender = if let Some(s) = sender {
        s.into()
    } else {
        service
    };

    let normalized_dest = normalize_upload_path(dest);

    let mut actions = Vec::new();
    fill_tree(
        service,
        sender,
        &mut actions,
        &normalized_dest,
        source,
        true,
    )?;

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

async fn monitor_install_trx(
    args: &Args,
    client: &reqwest::Client,
    tapos: &TaposRefBlock,
    actions: Vec<Action>,
    progress: ProgressBar,
    n: u64,
) -> Result<(), anyhow::Error> {
    let trx = with_tapos(tapos, actions);

    let result = push_transaction(
        &args.api,
        client.clone(),
        sign_transaction(trx, &args.sign)?.packed(),
    )
    .await;

    if let Err(err) = result {
        progress.abandon_with_message(format!("{}: {:?}", progress.message(), err));
        return Err(err);
    }
    progress.inc(n);
    Ok(())
}

async fn install(
    args: &Args,
    mut client: reqwest::Client,
    packages: &[String],
    key: &Option<AnyPublicKey>,
) -> Result<(), anyhow::Error> {
    let installed = PackageList::installed(&args.api, &mut client).await?;
    let package_registry = DirectoryRegistry::new(data_directory()?.join("packages"));
    let to_install = installed.resolve_new(&package_registry, packages).await?;

    let mut all_account_actions = vec![];
    let mut all_init_actions = vec![];
    for mut package in to_install {
        let mut account_actions = vec![];
        package.install_accounts(&mut account_actions, key)?;
        all_account_actions.push((account_actions, package.name().to_string()));
        let mut actions = vec![];
        package.install(&mut actions, true)?;
        all_init_actions.push((actions, package.name().to_string()));
    }

    let tapos = get_tapos_for_head(&args.api, client.clone()).await?;
    let progress = ProgressBar::new(all_account_actions.len() as u64).with_style(
        ProgressStyle::with_template("{wide_bar} {pos}/{len} packages\n{msg}")?,
    );

    let action_limit: usize = 64 * 1024;

    // create all accounts
    {
        let mut n: u64 = 0;
        let mut size: usize = 0;
        let mut trx_actions = vec![];
        for (actions, name) in all_account_actions {
            progress.set_message("Deploying ".to_string() + &name);
            for group in actions {
                if size >= action_limit {
                    monitor_install_trx(
                        args,
                        &client,
                        &tapos,
                        trx_actions.drain(..).collect(),
                        progress.clone(),
                        n,
                    )
                    .await?;
                    n = 0;
                    size = 0;
                }
                for act in group {
                    size += act.rawData.len();
                    trx_actions.push(act);
                }
            }
            n += 1;
        }
        if !trx_actions.is_empty() {
            monitor_install_trx(args, &client, &tapos, trx_actions, progress.clone(), n).await?;
        }
    }

    // Wait for a new block after the accounts are created, so the
    // first auth check doesn't fail
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    progress.set_position(0);

    {
        let mut n: u64 = 0;
        let mut size: usize = 0;
        let mut trx_actions = vec![];
        for (actions, name) in all_init_actions {
            progress.set_message("Initializing ".to_string() + &name);
            for act in actions {
                if size >= action_limit {
                    monitor_install_trx(
                        args,
                        &client,
                        &tapos,
                        trx_actions.drain(..).collect(),
                        progress.clone(),
                        n,
                    )
                    .await?;
                    n = 0;
                    size = 0;
                }

                size += act.rawData.len();
                trx_actions.push(act);
            }
            n += 1;
        }
        if !trx_actions.is_empty() {
            monitor_install_trx(args, &client, &tapos, trx_actions, progress.clone(), n).await?;
        }
    }
    if !args.suppress_ok {
        progress.finish_with_message("Ok");
    } else {
        progress.finish_and_clear();
    }

    Ok(())
}

async fn list(
    args: &Args,
    mut client: reqwest::Client,
    all: bool,
    available: bool,
    installed: bool,
) -> Result<(), anyhow::Error> {
    if all || (installed && available) || (!all & !installed && !available) {
        let installed = PackageList::installed(&args.api, &mut client).await?;
        let package_registry = DirectoryRegistry::new(data_directory()?.join("packages"));
        let reglist = PackageList::from_registry(&package_registry)?;
        for name in installed.union(reglist).into_vec() {
            println!("{}", name);
        }
    } else if installed {
        let installed = PackageList::installed(&args.api, &mut client).await?;
        for name in installed.into_vec() {
            println!("{}", name);
        }
    } else if available {
        let installed = PackageList::installed(&args.api, &mut client).await?;
        let package_registry = DirectoryRegistry::new(data_directory()?.join("packages"));
        let reglist = PackageList::from_registry(&package_registry)?;
        for name in reglist.difference(installed).into_vec() {
            println!("{}", name);
        }
    }
    Ok(())
}

async fn search(
    _args: &Args,
    _client: reqwest::Client,
    patterns: &Vec<String>,
) -> Result<(), anyhow::Error> {
    let mut compiled = vec![];
    for pattern in patterns {
        compiled.push(Regex::new(&("(?i)".to_string() + pattern))?);
    }
    // TODO: search installed packages as well
    let package_registry = DirectoryRegistry::new(data_directory()?.join("packages"));
    let mut primary_matches = vec![];
    let mut secondary_matches = vec![];
    for info in package_registry.index()? {
        let mut name_matched = 0;
        let mut description_matched = 0;
        for re in &compiled[..] {
            if re.is_match(&info.name) {
                name_matched += 1;
            } else if re.is_match(&info.description) {
                description_matched += 1;
            } else {
                break;
            }
        }
        if name_matched == compiled.len() {
            primary_matches.push(info);
        } else if name_matched + description_matched == compiled.len() {
            secondary_matches.push(info);
        }
    }
    primary_matches.sort_unstable_by(|a, b| a.name.cmp(&b.name));
    secondary_matches.sort_unstable_by(|a, b| a.name.cmp(&b.name));
    for result in primary_matches {
        println!("{}", result.name);
    }
    for result in secondary_matches {
        println!("{}", result.name);
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
            package_source,
            services,
        } => boot(&args, client, key, *producer, package_source, services).await?,
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
        Command::Install { packages, key } => install(&args, client, packages, key).await?,
        Command::List {
            all,
            available,
            installed,
        } => list(&args, client, *all, *available, *installed).await?,
        Command::Search { patterns } => search(&args, client, patterns).await?,
        Command::CreateToken {
            expires_after,
            mode,
        } => create_token(Duration::seconds(*expires_after), mode)?,
    }

    Ok(())
}
