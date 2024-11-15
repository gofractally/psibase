use anyhow::{anyhow, Context};
use chrono::{Duration, Utc};
use clap::{Args as _, FromArgMatches, Parser, Subcommand};
use fracpack::Pack;
use futures::future::join_all;
use hmac::{Hmac, Mac};
use indicatif::{ProgressBar, ProgressStyle};
use jwt::SignWithKey;
use psibase::services::{accounts, auth_delegate, sites};
use psibase::{
    account, apply_proxy, as_json, compress_content, create_boot_transactions,
    get_accounts_to_create, get_installed_manifest, get_manifest, get_tapos_for_head, method,
    new_account_action, push_transaction, push_transactions, reg_server, set_auth_service_action,
    set_code_action, set_key_action, sign_transaction, AccountNumber, Action, AnyPrivateKey,
    AnyPublicKey, AutoAbort, DirectoryRegistry, ExactAccountNumber, FileSetRegistry, HTTPRegistry,
    JointRegistry, Meta, PackageDataFile, PackageList, PackageOp, PackageOrigin, PackageRegistry,
    ServiceInfo, SignedTransaction, Tapos, TaposRefBlock, TimePointSec, TraceFormat, Transaction,
    TransactionBuilder, TransactionTrace,
};
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs::{metadata, read_dir, File};
use std::io::BufReader;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};

mod cli;
use cli::config::{handle_cli_config_cmd, read_host_url, ConfigCommand};

/// Interact with a running psinode
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// API Endpoint URL (ie https://psibase-api.example.com) or a Host Alias (ie prod, dev). See `psibase config --help` for more details.
    #[clap(
        short = 'a',
        long,
        value_name = "URL_OR_HOST_ALIAS",
        env = "PSINODE_URL",
        default_value = "http://psibase.127.0.0.1.sslip.io:8080/",
        value_parser = parse_api_endpoint
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

    /// Controls how transaction traces are reported. Possible values are
    /// error, stack, full, or json
    #[clap(long, value_name = "FORMAT", default_value = "stack")]
    trace: TraceFormat,

    /// Controls whether the transaction's console output is shown
    #[clap(long, action=clap::ArgAction::Set, num_args=0..=1, require_equals=true, default_value="true", default_missing_value="true")]
    console: bool,

    /// Print help
    #[clap(short = 'h', long, num_args=0.., value_name="COMMAND")]
    help: Option<Vec<OsString>>,

    #[clap(subcommand)]
    command: Option<Command>,
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

        services: Vec<OsString>,

        /// Configure compression level for boot package file uploads
        /// (1=fastest, 11=most compression)
        #[clap(short = 'z', long, value_name = "LEVEL", default_value = "4", value_parser = clap::value_parser!(u32).range(1..=11))]
        compression_level: u32,
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
        #[clap(short = 'S', long, value_name = "SENDER", default_value = "accounts")]
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

        /// Register the service with HttpServer. This allows the service to host a
        /// website, serve RPC requests, and serve GraphQL requests.
        #[clap(short = 'p', long)]
        register_proxy: bool,

        /// Sender to use when creating the account.
        #[clap(short = 'S', long, value_name = "SENDER", default_value = "accounts")]
        sender: ExactAccountNumber,
    },

    /// Upload a file to a service
    Upload {
        /// Source filename to upload
        source: String,

        /// Destination path within service
        dest: Option<String>,

        /// Sender to use (required). Files are uploaded to this account's subdomain.
        #[clap(short = 'S', long, value_name = "SENDER", required = true)]
        sender: ExactAccountNumber,

        /// MIME content type of file
        #[clap(short = 't', long, value_name = "MIME-TYPE")]
        content_type: Option<String>,

        /// Upload a directory recursively
        #[clap(short = 'r', long)]
        recursive: bool,

        /// Configure compression level
        /// (1=fastest, 11=most compression)
        #[clap(short = 'z', long, value_name = "LEVEL", default_value = "4", value_parser = clap::value_parser!(u32).range(1..=11))]
        compression_level: u32,
    },

    /// Install apps to the chain
    Install {
        /// Packages to install
        #[clap(required = true)]
        packages: Vec<OsString>,

        /// Set all accounts to authenticate using this key
        #[clap(short = 'k', long, value_name = "KEY")]
        key: Option<AnyPublicKey>,

        /// A URL or path to a package repository (repeatable)
        #[clap(long, value_name = "URL")]
        package_source: Vec<String>,

        /// Sender to use for installing. The packages and all accounts
        /// that they create will be owned by this account.
        #[clap(short = 'S', long, value_name = "SENDER", default_value = "root")]
        sender: ExactAccountNumber,

        /// Install the package even if it is already installed
        #[clap(long)]
        reinstall: bool,

        /// Configure compression level to use for uploaded files
        /// (1=fastest, 11=most compression)
        #[clap(short = 'z', long, value_name = "LEVEL", default_value = "4", value_parser = clap::value_parser!(u32).range(1..=11))]
        compression_level: u32,
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

        /// A URL or path to a package repository (repeatable)
        #[clap(long, value_name = "URL")]
        package_source: Vec<String>,
    },

    /// Find packages
    Search {
        /// Regular expressions to search for in package names and descriptions
        #[clap(required = true)]
        patterns: Vec<String>,

        /// A URL or path to a package repository (repeatable)
        #[clap(long, value_name = "URL")]
        package_source: Vec<String>,
    },

    /// Shows package contents
    Info {
        /// Packages to show
        #[clap(required = true)]
        packages: Vec<OsString>,

        /// A URL or path to a package repository (repeatable)
        #[clap(long, value_name = "URL")]
        package_source: Vec<String>,
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

    /// Setup the psibase local config file
    #[command(subcommand)]
    Config(ConfigCommand),

    /// Print help for the subcommands
    Help { command: Vec<OsString> },

    #[command(external_subcommand)]
    External(Vec<OsString>),
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
    sender: AccountNumber,
    path: &str,
    content_type: &str,
    content: &[u8],
    compression_level: u32,
) -> Action {
    let (content, content_encoding) = compress_content(content, content_type, compression_level);

    sites::Wrapper::pack_from_to(sender, sites::SERVICE).storeSys(
        path.to_string(),
        content_type.to_string(),
        content_encoding,
        content.into(),
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
        args.trace,
        args.console,
        None,
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
        actions.push(set_auth_service_action(account, account!("auth-any")));
    }

    let trx = with_tapos(
        &get_tapos_for_head(&args.api, client.clone()).await?,
        actions,
    );
    push_transaction(
        &args.api,
        client,
        sign_transaction(trx, &args.sign)?.packed(),
        args.trace,
        args.console,
        None,
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
        args.trace,
        args.console,
        None,
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
    sender: ExactAccountNumber,
    dest: &Option<String>,
    content_type: &Option<String>,
    source: &str,
    compression_level: u32,
) -> Result<(), anyhow::Error> {
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
        sender.into(),
        &normalized_dest,
        &deduced_content_type,
        &std::fs::read(source).with_context(|| format!("Can not read {}", source))?,
        compression_level,
    )];
    let trx = with_tapos(
        &get_tapos_for_head(&args.api, client.clone()).await?,
        actions,
    );

    push_transaction(
        &args.api,
        client,
        sign_transaction(trx, &args.sign)?.packed(),
        args.trace,
        args.console,
        None,
    )
    .await?;
    if !args.suppress_ok {
        println!("Ok");
    }
    Ok(())
}

fn fill_tree(
    sender: AccountNumber,
    actions: &mut Vec<(String, Action)>,
    dest: &str,
    source: &str,
    top: bool,
    compression_level: u32,
) -> Result<(), anyhow::Error> {
    let md = metadata(source)?;
    if md.is_file() {
        let guess = mime_guess::from_path(source);
        if let Some(t) = guess.first() {
            println!("{} <=== {}   {}", dest, source, t.essence_str());
            actions.push((
                dest.to_owned(),
                store_sys(
                    sender,
                    dest,
                    t.essence_str(),
                    &std::fs::read(source).with_context(|| format!("Can not read {}", source))?,
                    compression_level,
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
                sender,
                actions,
                &d,
                path.path().to_str().unwrap(),
                false,
                compression_level,
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
    let result = push_transaction(
        &args.api,
        client.clone(),
        trx.packed(),
        args.trace,
        args.console,
        Some(&progress),
    )
    .await;
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

fn find_psitest() -> OsString {
    if let Ok(exe) = std::env::current_exe() {
        if let Ok(exe) = exe.canonicalize() {
            if let Some(parent) = exe.parent() {
                let psitest = format!("psitest{}", std::env::consts::EXE_SUFFIX);
                let sibling = parent.join(&psitest);
                if sibling.is_file() {
                    return sibling.into();
                }
                if parent.ends_with("rust/release") {
                    let in_build_dir = parent.parent().unwrap().parent().unwrap().join(psitest);
                    if in_build_dir.exists() {
                        return in_build_dir.into();
                    }
                }
            }
        }
    }
    "psitest".to_string().into()
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

async fn add_package_registry(
    sources: &Vec<String>,
    client: reqwest::Client,
    result: &mut JointRegistry<BufReader<File>>,
) -> Result<(), anyhow::Error> {
    if sources.is_empty() {
        result.push(DirectoryRegistry::new(data_directory()?.join("packages")))?;
    } else {
        for source in sources {
            if source.starts_with("http:") || source.starts_with("https:") {
                result.push(HTTPRegistry::new(Url::parse(source)?, client.clone()).await?)?;
            } else {
                result.push(DirectoryRegistry::new(source.into()))?;
            }
        }
    }
    Ok(())
}

async fn get_package_registry(
    sources: &Vec<String>,
    client: reqwest::Client,
) -> Result<JointRegistry<BufReader<File>>, anyhow::Error> {
    let mut result = JointRegistry::new();
    add_package_registry(sources, client, &mut result).await?;
    Ok(result)
}

async fn boot(
    args: &Args,
    client: reqwest::Client,
    key: &Option<AnyPublicKey>,
    producer: ExactAccountNumber,
    package_source: &Vec<String>,
    services: &Vec<OsString>,
    compression_level: u32,
) -> Result<(), anyhow::Error> {
    let now_plus_120secs = Utc::now() + Duration::seconds(120);
    let expiration = TimePointSec {
        seconds: now_plus_120secs.timestamp() as u32,
    };
    let mut package_registry = JointRegistry::new();
    let package_names = if services.is_empty() {
        vec!["DevDefault".to_string()]
    } else {
        let (files, packages) = FileSetRegistry::from_files(services)?;
        package_registry.push(files)?;
        packages
    };
    add_package_registry(package_source, client.clone(), &mut package_registry).await?;
    let mut packages = package_registry.resolve(&package_names).await?;

    let (boot_transactions, transactions) = create_boot_transactions(
        key,
        producer.into(),
        true,
        expiration,
        &mut packages,
        compression_level,
    )?;

    let progress = ProgressBar::new((transactions.len() + 1) as u64)
        .with_style(ProgressStyle::with_template("{wide_bar} {pos}/{len}")?);

    push_boot(args, &client, boot_transactions.packed(), &progress).await?;
    progress.inc(1);
    for transaction in transactions {
        push_transaction(
            &args.api,
            client.clone(),
            transaction.packed(),
            args.trace,
            args.console,
            Some(&progress),
        )
        .await?;
        progress.inc(1)
    }
    if !args.suppress_ok {
        println!("Ok");
    }
    Ok(())
}

async fn push_boot(
    args: &Args,
    client: &reqwest::Client,
    packed: Vec<u8>,
    progress: &ProgressBar,
) -> Result<(), anyhow::Error> {
    let trace: TransactionTrace =
        as_json(client.post(args.api.join("native/push_boot")?).body(packed)).await?;
    if args.console {
        progress.suspend(|| print!("{}", trace.console()));
    }
    args.trace
        .error_for_trace(trace, Some(progress))
        .context("Failed to boot")
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
    sender: ExactAccountNumber,
    dest: &Option<String>,
    source: &str,
    compression_level: u32,
) -> Result<(), anyhow::Error> {
    let normalized_dest = normalize_upload_path(dest);

    let mut actions = Vec::new();
    fill_tree(
        sender.into(),
        &mut actions,
        &normalized_dest,
        source,
        true,
        compression_level,
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

fn create_accounts<F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>>(
    accounts: Vec<AccountNumber>,
    out: &mut TransactionBuilder<F>,
    sender: AccountNumber,
) -> Result<(), anyhow::Error> {
    for account in accounts {
        out.set_label(format!("Creating {}", account));
        let group = vec![
            accounts::Wrapper::pack().newAccount(account, account!("auth-any"), true),
            auth_delegate::Wrapper::pack_from(account).setOwner(sender),
            set_auth_service_action(account, auth_delegate::SERVICE),
        ];
        out.push(group)?;
    }
    Ok(())
}

async fn apply_packages<
    R: PackageRegistry,
    F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>,
>(
    base_url: &reqwest::Url,
    client: &mut reqwest::Client,
    reg: &R,
    ops: Vec<PackageOp>,
    accounts: &mut Vec<AccountNumber>,
    out: &mut TransactionBuilder<F>,
    sender: AccountNumber,
    key: &Option<AnyPublicKey>,
    compression_level: u32,
) -> Result<(), anyhow::Error> {
    for op in ops {
        match op {
            PackageOp::Install(info) => {
                // TODO: verify ownership of existing accounts
                let mut package = reg.get_by_info(&info).await?;
                accounts.extend_from_slice(package.get_accounts());
                out.set_label(format!("Installing {}-{}", &info.name, &info.version));
                let mut account_actions = vec![];
                package.install_accounts(&mut account_actions, sender, key)?;
                out.push_all(account_actions)?;
                let mut actions = vec![];
                package.install(&mut actions, sender, true, compression_level)?;
                out.push_all(actions)?;
            }
            PackageOp::Replace(meta, info) => {
                let mut package = reg.get_by_info(&info).await?;
                accounts.extend_from_slice(package.get_accounts());
                // TODO: skip unmodified files (?)
                out.set_label(format!(
                    "Updating {}-{} -> {}-{}",
                    &meta.name, &meta.version, &info.name, &info.version
                ));
                // Remove out-dated files. This needs to happen before installing
                // new files, to handle the case where a service that stores
                // data files is replaced by a service that does not provide
                // removeSys.
                let old_manifest =
                    get_installed_manifest(base_url, client, &meta.name, sender).await?;
                old_manifest.upgrade(package.manifest(), out)?;
                // Install the new package
                let mut account_actions = vec![];
                package.install_accounts(&mut account_actions, sender, key)?;
                out.push_all(account_actions)?;
                let mut actions = vec![];
                package.install(&mut actions, sender, true, compression_level)?;
                out.push_all(actions)?;
            }
            PackageOp::Remove(meta) => {
                out.set_label(format!("Removing {}", &meta.name));
                let old_manifest =
                    get_installed_manifest(base_url, client, &meta.name, sender).await?;
                old_manifest.remove(out)?;
            }
        }
    }
    Ok(())
}

async fn install(
    args: &Args,
    mut client: reqwest::Client,
    packages: &[OsString],
    sender: AccountNumber,
    key: &Option<AnyPublicKey>,
    sources: &Vec<String>,
    reinstall: bool,
    compression_level: u32,
) -> Result<(), anyhow::Error> {
    let installed = PackageList::installed(&args.api, &mut client).await?;
    let mut package_registry = JointRegistry::new();
    let (files, packages) = FileSetRegistry::from_files(packages)?;
    package_registry.push(files)?;
    add_package_registry(sources, client.clone(), &mut package_registry).await?;
    let to_install = installed
        .resolve_changes(&package_registry, &packages, reinstall)
        .await?;

    let tapos = get_tapos_for_head(&args.api, client.clone()).await?;

    let build_transaction = |mut actions: Vec<Action>| -> Result<SignedTransaction, anyhow::Error> {
        if actions.first().unwrap().sender != sender {
            actions.insert(
                0,
                Action {
                    sender,
                    service: account!("nop"),
                    method: method!("nop"),
                    rawData: Default::default(),
                },
            );
        }
        Ok(sign_transaction(with_tapos(&tapos, actions), &args.sign)?)
    };

    let action_limit: usize = 64 * 1024;

    let mut account_builder = TransactionBuilder::new(action_limit, build_transaction);
    let mut new_accounts = vec![];

    let mut trx_builder = TransactionBuilder::new(action_limit, build_transaction);
    apply_packages(
        &args.api,
        &mut client,
        &package_registry,
        to_install,
        &mut new_accounts,
        &mut trx_builder,
        sender,
        key,
        compression_level,
    )
    .await?;

    new_accounts = get_accounts_to_create(&args.api, &mut client, &new_accounts, sender).await?;
    create_accounts(new_accounts, &mut account_builder, sender)?;

    let account_transactions = account_builder.finish()?;
    let transactions = trx_builder.finish()?;

    {
        let progress = ProgressBar::new(account_transactions.len() as u64).with_style(
            ProgressStyle::with_template("{wide_bar} {pos}/{len} accounts\n{msg}")?,
        );
        push_transactions(
            &args.api,
            client.clone(),
            account_transactions,
            args.trace,
            args.console,
            &progress,
        )
        .await?;
        progress.finish_and_clear();
    }

    let progress = ProgressBar::new(transactions.len() as u64).with_style(
        ProgressStyle::with_template("{wide_bar} {pos}/{len} packages\n{msg}")?,
    );

    push_transactions(
        &args.api,
        client.clone(),
        transactions,
        args.trace,
        args.console,
        &progress,
    )
    .await?;

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
    sources: &Vec<String>,
) -> Result<(), anyhow::Error> {
    if all || (installed && available) || (!all & !installed && !available) {
        let installed = handle_unbooted(PackageList::installed(&args.api, &mut client).await)?;
        let package_registry = get_package_registry(sources, client.clone()).await?;
        let reglist = PackageList::from_registry(&package_registry)?;
        for name in installed.union(reglist).into_vec() {
            println!("{}", name);
        }
    } else if installed {
        let installed = handle_unbooted(PackageList::installed(&args.api, &mut client).await)?;
        for name in installed.into_vec() {
            println!("{}", name);
        }
    } else if available {
        let installed = handle_unbooted(PackageList::installed(&args.api, &mut client).await)?;
        let package_registry = get_package_registry(sources, client.clone()).await?;
        let reglist = PackageList::from_registry(&package_registry)?;
        for name in reglist.difference(installed).into_vec() {
            println!("{}", name);
        }
    }
    Ok(())
}

async fn search(
    _args: &Args,
    client: reqwest::Client,
    patterns: &Vec<String>,
    sources: &Vec<String>,
) -> Result<(), anyhow::Error> {
    let mut compiled = vec![];
    for pattern in patterns {
        compiled.push(Regex::new(&("(?i)".to_string() + pattern))?);
    }
    // TODO: search installed packages as well
    let package_registry = get_package_registry(sources, client.clone()).await?;
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

struct ServicePrinter<'a> {
    service: AccountNumber,
    info: Option<&'a ServiceInfo>,
    data: &'a [PackageDataFile],
}

impl fmt::Display for ServicePrinter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(info) = &self.info {
            writeln!(f, "service: {}", self.service)?;
            if !info.flags.is_empty() {
                write!(f, "  flags:")?;
                for flag in &info.flags {
                    write!(f, " {}", flag)?;
                }
                writeln!(f, "")?;
            }
            if let Some(server) = &info.server {
                writeln!(f, "  server: {}", server)?;
            }
        } else {
            writeln!(f, "account: {}", self.service)?;
        }
        if !self.data.is_empty() {
            writeln!(f, "  files:")?;
            for file in self.data {
                writeln!(f, "    {}", &file.filename)?;
            }
        }
        Ok(())
    }
}

fn get_service_data(s: &[PackageDataFile], account: AccountNumber) -> &[PackageDataFile] {
    let key = account.to_string();
    let lower = s.partition_point(|file| &file.account.to_string() < &key);
    let upper = s.partition_point(|file| &file.account.to_string() <= &key);
    &s[lower..upper]
}

async fn show_package<T: PackageRegistry + ?Sized>(
    reg: &T,
    base_url: &reqwest::Url,
    client: &mut reqwest::Client,
    package: &Meta,
    origin: &PackageOrigin,
) -> Result<(), anyhow::Error> {
    let mut manifest = get_manifest(reg, base_url, client, package, origin).await?;
    println!("name: {}-{}", &package.name, &package.version);
    println!("description: {}", &package.description);
    let mut services: Vec<_> = manifest.services.into_iter().collect();
    services.sort_by(|lhs, rhs| lhs.0.to_string().cmp(&rhs.0.to_string()));
    manifest.data.sort_by(|lhs, rhs| {
        (
            lhs.account.to_string(),
            lhs.service.to_string(),
            &lhs.filename,
        )
            .cmp(&(
                rhs.account.to_string(),
                rhs.service.to_string(),
                &rhs.filename,
            ))
    });

    for account in &package.accounts {
        let info = services
            .binary_search_by(|service| service.0.to_string().cmp(&account.to_string()))
            .map_or(None, |idx| Some(&services[idx].1));
        print!(
            "{}",
            &ServicePrinter {
                service: *account,
                info,
                data: get_service_data(&manifest.data, *account)
            }
        );
    }
    Ok(())
}

// an unbooted chain has no packages installed
fn handle_unbooted(list: Result<PackageList, anyhow::Error>) -> Result<PackageList, anyhow::Error> {
    if let Err(e) = &list {
        if e.root_cause()
            .to_string()
            .contains("Need genesis block; use 'psibase boot' to boot chain")
        {
            return Ok(PackageList::new());
        }
    }
    list
}

async fn package_info(
    args: &Args,
    mut client: reqwest::Client,
    packages: &Vec<OsString>,
    sources: &Vec<String>,
) -> Result<(), anyhow::Error> {
    let installed = handle_unbooted(PackageList::installed(&args.api, &mut client).await)?;
    let mut package_registry = JointRegistry::new();
    let (files, packages) = FileSetRegistry::from_files(packages)?;
    package_registry.push(files)?;
    add_package_registry(sources, client.clone(), &mut package_registry).await?;
    let reglist = PackageList::from_registry(&package_registry)?;

    for package in &packages {
        if let Some((meta, origin)) = installed.get_by_name(package)? {
            show_package(&package_registry, &args.api, &mut client, meta, origin).await?;
        } else if let Some((meta, origin)) = reglist.get_by_name(package)? {
            show_package(&package_registry, &args.api, &mut client, meta, origin).await?;
        } else {
            eprintln!("Package {} not found", package);
        }
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

fn get_external(name: &OsString) -> Option<&str> {
    name.to_str()?
        .strip_prefix("psibase-")?
        .strip_suffix(".wasm")
}

fn list_external() -> Result<Vec<String>, anyhow::Error> {
    let command_path = data_directory()?.join("wasm");
    let mut result = Vec::new();
    for dir in command_path.read_dir()? {
        if let Some(name) = get_external(&dir?.file_name()) {
            result.push(name.to_string())
        }
    }
    Ok(result)
}

fn unrecognized_subcommand(command: &mut clap::Command, name: &OsString) -> ! {
    let mut command = std::mem::take(command)
        .disable_help_subcommand(false)
        .disable_help_flag(false);
    let mut err = clap::Error::new(clap::error::ErrorKind::InvalidSubcommand).with_cmd(&command);
    err.insert(
        clap::error::ContextKind::InvalidSubcommand,
        clap::error::ContextValue::String(name.to_string_lossy().to_string()),
    );
    err.insert(
        clap::error::ContextKind::Usage,
        clap::error::ContextValue::StyledStr(command.render_usage()),
    );
    err.exit();
}

fn handle_external(args: &Vec<OsString>) -> Result<(), anyhow::Error> {
    let psitest = find_psitest();
    let command_path = data_directory()?.join("wasm");
    let mut filename: OsString = "psibase-".to_string().into();
    filename.push(&args[0]);
    filename.push(".wasm");
    let wasm_file = command_path.join(filename);
    if !wasm_file.is_file() {
        let command = clap::Command::new("psibase");
        let mut command = Args::augment_args(command)
            .disable_help_subcommand(true)
            .disable_help_flag(true);
        command.build();
        unrecognized_subcommand(&mut command, &args[0]);
    }
    Err(std::process::Command::new(psitest)
        .arg(wasm_file)
        .args(&args[1..])
        .exec())?
}

fn print_subcommand_help<'a, I: Iterator<Item = &'a OsString>>(
    mut iter: I,
    command: &mut clap::Command,
) {
    if let Some(name) = iter.next() {
        if let Some(subcommand) = command.find_subcommand_mut(name) {
            print_subcommand_help(iter, subcommand)
        } else {
            unrecognized_subcommand(command, name);
        }
    } else {
        command.print_help().unwrap();
    }
}

fn print_help(subcommand: &[OsString]) -> Result<(), anyhow::Error> {
    let command = clap::Command::new("psibase");
    let mut command = Args::augment_args(command);
    if !subcommand.is_empty() {
        command.build();
        let mut iter = subcommand.iter();
        if let Some(command) = command.find_subcommand_mut(iter.next().unwrap()) {
            print_subcommand_help(iter, command);
        } else {
            let mut subcommand: Vec<_> = subcommand.iter().cloned().collect();
            subcommand.push(OsStr::new("--help").to_os_string());
            handle_external(&subcommand)?;
        }
    } else {
        command = command
            .disable_help_subcommand(true)
            .disable_help_flag(true);
        if let Ok(subcommands) = list_external() {
            for sub in subcommands {
                command = command.subcommand(clap::Command::new(sub));
            }
        }
        command.build();
        command.print_help()?;
    }
    Ok(())
}

fn parse_args() -> Result<Args, anyhow::Error> {
    let command = clap::Command::new("psibase");
    let mut command = Args::augment_args(command);
    command.build();
    command = command
        .disable_help_subcommand(true)
        .disable_help_flag(true);
    Ok(Args::from_arg_matches(&command.get_matches())?)
}

async fn build_client(args: &Args) -> Result<(reqwest::Client, Option<AutoAbort>), anyhow::Error> {
    let (builder, result) = apply_proxy(reqwest::Client::builder(), &args.proxy).await?;
    Ok((builder.gzip(true).build()?, result))
}

pub fn parse_api_endpoint(api_str: &str) -> Result<Url, anyhow::Error> {
    if let Ok(api_url) = Url::parse(api_str) {
        Ok(api_url)
    } else {
        let host_url = read_host_url(api_str)?;
        Ok(Url::parse(&host_url)?)
    }
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = parse_args()?;
    let (client, _proxy) = build_client(&args).await?;
    if let Some(help) = &args.help {
        return print_help(help);
    }
    let Some(command) = &args.command else {
        return print_help(&[]);
    };
    match command {
        Command::Boot {
            key,
            producer,
            package_source,
            services,
            compression_level,
        } => {
            boot(
                &args,
                client,
                key,
                *producer,
                package_source,
                services,
                *compression_level,
            )
            .await?
        }
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
            source,
            dest,
            content_type,
            recursive,
            sender,
            compression_level,
        } => {
            if *recursive {
                if content_type.is_some() {
                    return Err(anyhow!("--recursive is incompatible with --content-type"));
                }
                upload_tree(&args, client, *sender, dest, source, *compression_level).await?
            } else {
                upload(
                    &args,
                    client,
                    *sender,
                    dest,
                    content_type,
                    source,
                    *compression_level,
                )
                .await?
            }
        }
        Command::Install {
            packages,
            key,
            package_source,
            sender,
            reinstall,
            compression_level,
        } => {
            install(
                &args,
                client,
                packages,
                (*sender).into(),
                key,
                package_source,
                *reinstall,
                *compression_level,
            )
            .await?
        }
        Command::List {
            all,
            available,
            installed,
            package_source,
        } => list(&args, client, *all, *available, *installed, package_source).await?,
        Command::Search {
            patterns,
            package_source,
        } => search(&args, client, patterns, package_source).await?,
        Command::Info {
            packages,
            package_source,
        } => package_info(&args, client, packages, package_source).await?,
        Command::CreateToken {
            expires_after,
            mode,
        } => create_token(Duration::seconds(*expires_after), mode)?,
        Command::Config(config) => handle_cli_config_cmd(config)?,
        Command::Help { command } => print_help(command)?,
        Command::External(argv) => handle_external(argv)?,
    }

    Ok(())
}
