use anyhow::{anyhow, Context};
use chrono::{Duration, Utc};
use clap::{Args, FromArgMatches, Parser, Subcommand};
use fracpack::Pack;
use futures::future::{join_all, try_join_all};
use hmac::{Hmac, Mac};
use hyper::service::Service as _;
use indicatif::{ProgressBar, ProgressStyle};
use jwt::SignWithKey;
use psibase::services::{accounts, auth_delegate, packages, sites, staged_tx, transact};
use psibase::{
    account, apply_proxy, as_json, compress_content, create_boot_transactions,
    get_accounts_to_create, get_installed_manifest, get_manifest, get_package_sources,
    get_tapos_for_head, login_action, new_account_action, push_transaction,
    push_transaction_optimistic, push_transactions, reg_server, set_auth_service_action,
    set_code_action, set_key_action, sign_transaction, AccountNumber, Action, AnyPrivateKey,
    AnyPublicKey, AutoAbort, ChainUrl, Checksum256, DirectoryRegistry, ExactAccountNumber,
    FileSetRegistry, HTTPRegistry, JointRegistry, Meta, PackageDataFile, PackageList, PackageOp,
    PackageOrigin, PackagePreference, PackageRef, PackageRegistry, PackagedService, PrettyAction,
    SchemaMap, ServiceInfo, SignedTransaction, StagedUpload, Tapos, TaposRefBlock, TimePointSec,
    TraceFormat, Transaction, TransactionBuilder, TransactionTrace, Version,
};
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cell::Cell;
use std::cmp::Ordering;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs::{metadata, read_dir, File};
use std::io::{BufReader, Read, Seek};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

mod cli;
use cli::config::{handle_cli_config_cmd, read_host_url, ConfigCommand};

/// Basic commands
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct BasicArgs {
    /// Print help
    #[clap(short = 'h', long, num_args=0.., value_name="COMMAND")]
    help: Option<Vec<OsString>>,

    #[clap(subcommand)]
    command: Option<Command>,
}
/// Interact with a running psinode
#[derive(Args, Debug)]
#[clap(long_about = None)]
struct NodeArgs {
    /// API Endpoint URL (ie https://psibase-api.example.com) or a Host Alias (ie prod, dev). See `psibase config --help` for more details.
    #[clap(
        short = 'a',
        long,
        value_name = "URL_OR_HOST_ALIAS",
        env = "PSINODE_URL",
        default_value = "http://psibase.localhost:8080/",
        value_parser = parse_api_endpoint
    )]
    api: Url,

    /// HTTP proxy
    #[clap(long, value_name = "URL")]
    proxy: Option<Url>,
}

/// transaction-related Args
#[derive(Args, Debug)]
#[clap(long_about = None)]
struct TxArgs {
    /// Controls how transaction traces are reported. Possible values are
    /// error, stack, full, or json
    #[clap(long, value_name = "FORMAT", default_value = "stack")]
    trace: TraceFormat,

    /// Controls whether the transaction's console output is shown
    #[clap(long, action=clap::ArgAction::Set, num_args=0..=1, require_equals=true, default_value="true", default_missing_value="true")]
    console: bool,
}

/// transaction-related Args
#[derive(Args, Debug)]
#[clap(long_about = None)]
struct SigArgs {
    /// Sign with this key (repeatable)
    #[clap(short = 's', long, value_name = "KEY")]
    sign: Vec<AnyPrivateKey>,

    /// Stages transactions instead of executing them immediately
    #[clap(long, value_name = "ACCOUNT")]
    proposer: Option<ExactAccountNumber>,
}

#[derive(Args, Debug)]

struct BootArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    tx_args: TxArgs,

    /// Sets the producer account to use this key for transaction authentication
    #[clap(short = 'k', long, value_name = "KEY")]
    account_key: Option<AnyPublicKey>,

    /// Sets the producer's block signing key
    #[clap(long, value_name = "BLOCK_KEY")]
    block_key: Option<AnyPublicKey>,

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
}

#[derive(Args, Debug)]
struct PushArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

    /// Actions to push
    actions: Vec<PathBuf>,
}

#[derive(Args, Debug)]
struct CreateArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

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
}

#[derive(Args, Debug)]
struct ModifyArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

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
}

#[derive(Args, Debug)]
struct DeployArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

    /// Account to deploy service on
    account: ExactAccountNumber,

    /// Filename containing the service
    filename: String,

    /// Filename containing the schema
    schema: PathBuf,

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
}

#[derive(Args, Debug)]
struct UploadArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

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

    /// Sender to use (required). Files are uploaded to this account's subdomain.
    #[clap(short = 'S', long, value_name = "SENDER", required = true)]
    sender: ExactAccountNumber,

    /// Configure compression level
    /// (1=fastest, 11=most compression)
    #[clap(short = 'z', long, value_name = "LEVEL", default_value = "4", value_parser = clap::value_parser!(u32).range(1..=11))]
    compression_level: u32,
}

#[derive(Args, Debug)]
struct PublishArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

    /// Package files to publish
    packages: Vec<PathBuf>,

    /// Sender to use (required). Files are uploaded to this account's subdomain.
    #[clap(short = 'S', long, value_name = "SENDER", required = true)]
    sender: ExactAccountNumber,
}

#[derive(Args, Debug)]
struct InstallArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

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
}

#[derive(Args, Debug)]
struct UpgradeArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

    /// Packages to update
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

    /// Install the latest version
    #[clap(long)]
    latest: bool,

    /// Configure compression level to use for uploaded files
    /// (1=fastest, 11=most compression)
    #[clap(short = 'z', long, value_name = "LEVEL", default_value = "4", value_parser = clap::value_parser!(u32).range(1..=11))]
    compression_level: u32,
}

#[derive(Args, Debug)]
struct ListArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    /// List all apps
    #[clap(long)]
    all: bool,
    /// List apps that are available in the repository, but not currently installed
    #[clap(long)]
    available: bool,
    /// List installed apps
    #[clap(long)]
    installed: bool,
    /// List installed apps that have updates available
    #[clap(long)]
    updates: bool,

    /// A URL or path to a package repository (repeatable)
    #[clap(long, value_name = "URL")]
    package_source: Vec<String>,

    /// Account that would install the packages
    #[clap(short = 'S', long, value_name = "SENDER", default_value = "root")]
    sender: ExactAccountNumber,
}

#[derive(Args, Debug)]
struct SearchArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    /// Regular expressions to search for in package names and descriptions
    #[clap(required = true)]
    patterns: Vec<String>,

    /// A URL or path to a package repository (repeatable)
    #[clap(long, value_name = "URL")]
    package_source: Vec<String>,

    /// Account that would install the packages
    #[clap(short = 'S', long, value_name = "SENDER", default_value = "root")]
    sender: ExactAccountNumber,
}

#[derive(Args, Debug)]
struct InfoArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    /// Packages to show
    #[clap(required = true)]
    packages: Vec<OsString>,

    /// A URL or path to a package repository (repeatable)
    #[clap(long, value_name = "URL")]
    package_source: Vec<String>,

    /// Account that would install the packages
    #[clap(short = 'S', long, value_name = "SENDER", default_value = "root")]
    sender: ExactAccountNumber,
}

#[derive(Args, Debug)]
struct CreateTokenArgs {
    #[command(flatten)]
    sig_args: SigArgs,

    #[command(flatten)]
    tx_args: TxArgs,

    /// The lifetime of the new token
    #[clap(short = 'e', long, default_value = "3600", value_name = "SECONDS")]
    expires_after: i64,

    /// The access mode: "r" or "rw"
    #[clap(short = 'm', long, default_value = "rw")]
    mode: String,
}

#[derive(Args, Debug)]
struct LoginArgs {
    #[command(flatten)]
    node_args: NodeArgs,

    #[command(flatten)]
    sig_args: SigArgs,

    /// The account logging in
    user: ExactAccountNumber,

    /// The app to log in to
    app: ExactAccountNumber,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Boot a development chain
    Boot(BootArgs),

    /// Push a transaction to the chain
    Push(PushArgs),

    /// Create or modify an account
    Create(CreateArgs),

    /// Modify an account
    Modify(ModifyArgs),

    /// Deploy a service
    Deploy(DeployArgs),

    /// Upload a file to a service
    Upload(UploadArgs),

    /// Publish a package
    Publish(PublishArgs),

    /// Install apps to the chain
    Install(InstallArgs),

    /// Upgrade apps
    Upgrade(UpgradeArgs),

    /// Prints a list of apps
    List(ListArgs),

    /// Find packages
    Search(SearchArgs),

    /// Shows package contents
    Info(InfoArgs),

    /// Create a bearer token that can be used to access a node
    CreateToken(CreateTokenArgs),

    /// Get a bearer token that can be used to access an app
    Login(LoginArgs),

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

fn with_tapos(
    tapos: &TaposRefBlock,
    mut actions: Vec<Action>,
    proposer: &Option<ExactAccountNumber>,
    auto_exec: bool,
) -> Transaction {
    let now_plus_10secs = Utc::now() + Duration::seconds(10);
    let expiration = TimePointSec::from(now_plus_10secs);
    if let Some(proposer) = proposer {
        actions =
            vec![staged_tx::Wrapper::pack_from((*proposer).into()).propose(actions, auto_exec)];
    }
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

fn make_spinner() -> ProgressBar {
    let progress = ProgressBar::new_spinner().with_style(
        ProgressStyle::with_template("{spinner}{msg}")
            .unwrap()
            .tick_strings(&["⏳ ", "⌛ ", ""]),
    );
    progress.enable_steady_tick(core::time::Duration::from_millis(500));
    progress
}

fn finish_progress(sig_args: &SigArgs, progress: ProgressBar, num_transactions: usize) {
    if sig_args.proposer.is_some() {
        progress.finish_with_message(format!(
            "Proposed {} transaction{}",
            num_transactions,
            if num_transactions == 1 { "" } else { "s" }
        ));
    } else {
        progress.finish_with_message("Ok");
    }
}

async fn push(mut args: PushArgs) -> Result<(), anyhow::Error> {
    let (client, _proxy) = build_client(&args.node_args.proxy).await?;
    let mut actions: Vec<PrettyAction> = Vec::new();

    if args.actions.is_empty() {
        args.actions.push("-".to_string().into());
    }

    for file in args.actions {
        let contents = if file.as_os_str() == "-" {
            std::io::read_to_string(std::io::stdin().lock())?
        } else {
            std::io::read_to_string(
                File::open(&file).with_context(|| format!("Cannot open {}", file.display()))?,
            )?
        };
        let mut new_actions: Vec<PrettyAction> = serde_json::from_str(&contents)?;
        actions.append(&mut new_actions);
    }

    let progress = make_spinner();
    progress.set_message("Preparing transaction");

    let mut schemas = SchemaMap::new();

    for action in &actions {
        if !schemas.contains_key(&action.service) {
            schemas.insert(
                action.service,
                crate::as_json(
                    client.get(
                        packages::SERVICE
                            .url(&args.node_args.api)?
                            .join(&format!("/schema?service={}", action.service))?,
                    ),
                )
                .await?,
            );
        }
    }

    let actions: Vec<Action> = actions
        .into_iter()
        .map(|act| act.into_action(&schemas))
        .collect::<Result<_, _>>()?;

    let trx = with_tapos(
        &get_tapos_for_head(&args.node_args.api, client.clone()).await?,
        actions,
        &args.sig_args.proposer,
        true,
    );

    progress.set_message("Pushing transaction");

    push_transaction(
        &args.node_args.api,
        client,
        sign_transaction(trx, &args.sig_args.sign)?.packed(),
        args.tx_args.trace,
        args.tx_args.console,
        Some(&progress),
    )
    .await?;

    finish_progress(&args.sig_args, progress, 1);
    Ok(())
}

async fn create(args: &CreateArgs) -> Result<(), anyhow::Error> {
    let (client, _proxy) = build_client(&args.node_args.proxy).await?;
    let mut actions: Vec<Action> = Vec::new();

    if args.key.is_some() && args.insecure {
        return Err(anyhow!("--key and --insecure cannot be used together"));
    }
    if args.key.is_none() && !args.insecure {
        return Err(anyhow!("either --key or --insecure must be used"));
    }

    actions.push(new_account_action(args.sender.into(), args.account.into()));

    if let Some(key) = &args.key {
        actions.push(set_key_action(args.account.into(), &key));
        actions.push(set_auth_service_action(
            args.account.into(),
            key.auth_service(),
        ));
    }

    let progress = make_spinner();
    progress.set_message("Preparing transaction");

    let trx = with_tapos(
        &get_tapos_for_head(&args.node_args.api, client.clone()).await?,
        actions,
        &args.sig_args.proposer,
        true,
    );

    progress.set_message(format!("Creating {}", args.account));

    push_transaction(
        &args.node_args.api,
        client,
        sign_transaction(trx, &args.sig_args.sign)?.packed(),
        args.tx_args.trace,
        args.tx_args.console,
        Some(&progress),
    )
    .await?;

    finish_progress(&args.sig_args, progress, 1);
    Ok(())
}

async fn modify(args: &ModifyArgs) -> Result<(), anyhow::Error> {
    let (client, _proxy) = build_client(&args.node_args.proxy).await?;
    let mut actions: Vec<Action> = Vec::new();

    if args.key.is_some() && args.insecure {
        return Err(anyhow!("--key and --insecure cannot be used together"));
    }
    if args.key.is_none() && !args.insecure {
        return Err(anyhow!("either --key or --insecure must be used"));
    }

    if let Some(key) = &args.key {
        actions.push(set_key_action(args.account.into(), &key));
        actions.push(set_auth_service_action(
            args.account.into(),
            key.auth_service(),
        ));
    }

    if args.insecure {
        actions.push(set_auth_service_action(
            args.account.into(),
            account!("auth-any"),
        ));
    }

    let progress = make_spinner();
    progress.set_message("Preparing transaction");

    let trx = with_tapos(
        &get_tapos_for_head(&args.node_args.api, client.clone()).await?,
        actions,
        &args.sig_args.proposer,
        true,
    );

    progress.set_message(format!("Setting auth for {}", args.account));

    push_transaction(
        &args.node_args.api,
        client,
        sign_transaction(trx, &args.sig_args.sign)?.packed(),
        args.tx_args.trace,
        args.tx_args.console,
        Some(&progress),
    )
    .await?;
    finish_progress(&args.sig_args, progress, 1);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn deploy(args: &DeployArgs) -> Result<(), anyhow::Error> {
    let (client, _proxy) = build_client(&args.node_args.proxy).await?;
    let wasm = std::fs::read(args.filename.clone())
        .with_context(|| format!("Can not read {}", args.filename))?;
    let schema: psibase::Schema = serde_json::from_slice(
        &std::fs::read(&args.schema)
            .with_context(|| format!("Can not read {}", args.schema.display()))?,
    )?;

    let mut actions: Vec<Action> = Vec::new();

    if args.create_account.is_some() && args.create_insecure_account {
        return Err(anyhow!(
            "--create-account and --create-insecure-account cannot be used together"
        ));
    }

    if args.create_account.is_some() || args.create_insecure_account {
        actions.push(new_account_action(args.sender.into(), args.account.into()));
    }

    // This happens before the set_code as a safety measure.
    // If the set_code was first, and the user didn't actually
    // have the matching private key, then the transaction would
    // lock out the user. Putting this before the set_code causes
    // the set_code to require the private key, failing the transaction
    // if the user doesn't have it.
    if let Some(key) = args.create_account.clone() {
        actions.push(set_key_action(args.account.into(), &key));
        actions.push(set_auth_service_action(
            args.account.into(),
            key.auth_service(),
        ));
    }

    actions.push(set_code_action(args.account.into(), wasm));
    actions.push(packages::Wrapper::pack_from(args.account.into()).setSchema(schema));

    if args.register_proxy {
        actions.push(reg_server(args.account.into(), args.account.into()));
    }

    let progress = make_spinner();
    progress.set_message("Preparing transaction");

    let trx = with_tapos(
        &get_tapos_for_head(&args.node_args.api, client.clone()).await?,
        actions,
        &args.sig_args.proposer,
        true,
    );
    push_transaction(
        &args.node_args.api,
        client,
        sign_transaction(trx, &args.sig_args.sign)?.packed(),
        args.tx_args.trace,
        args.tx_args.console,
        Some(&progress),
    )
    .await?;
    finish_progress(&args.sig_args, progress, 1);
    Ok(())
}

async fn upload(args: &UploadArgs) -> Result<(), anyhow::Error> {
    let (client, _proxy) = build_client(&args.node_args.proxy).await?;
    let deduced_content_type = match &args.content_type {
        Some(t) => t.clone(),
        None => {
            let guess = mime_guess::from_path(&args.source);
            let Some(t) = guess.first() else {
                return Err(anyhow!(format!("Unknown mime type: {}", args.source)));
            };
            t.essence_str().to_string()
        }
    };

    let progress = make_spinner();
    progress.set_message("Preparing transaction");

    let normalized_dest = if let Some(d) = &args.dest {
        if d.starts_with('/') {
            d.to_string()
        } else {
            "/".to_string() + d.as_str()
        }
    } else {
        "/".to_string()
            + Path::new(&args.source)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
    };

    let actions = vec![store_sys(
        args.sender.into(),
        &normalized_dest,
        &deduced_content_type,
        &std::fs::read(&args.source).with_context(|| format!("Can not read {}", args.source))?,
        args.compression_level,
    )];
    let trx = with_tapos(
        &get_tapos_for_head(&args.node_args.api, client.clone()).await?,
        actions,
        &args.sig_args.proposer,
        true,
    );

    push_transaction(
        &args.node_args.api,
        client,
        sign_transaction(trx, &args.sig_args.sign)?.packed(),
        args.tx_args.trace,
        args.tx_args.console,
        Some(&progress),
    )
    .await?;
    finish_progress(&args.sig_args, progress, 1);
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
            eprintln!("{} <=== {}   {}", dest, source, t.essence_str());
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
                eprintln!("Skip unknown mime type: {}", source);
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
            eprintln!("Skip {}", source);
        }
    }
    Ok(())
}

async fn monitor_trx(
    args: &UploadArgs,
    client: &reqwest::Client,
    files: Vec<String>,
    trx: SignedTransaction,
    progress: ProgressBar,
    n: u64,
) -> Result<(), anyhow::Error> {
    let result = push_transaction(
        &args.node_args.api,
        client.clone(),
        trx.packed(),
        args.tx_args.trace,
        args.tx_args.console,
        Some(&progress),
    )
    .await;
    if let Err(err) = result {
        progress.suspend(|| {
            eprintln!("=====\n{:?}", err);
            eprintln!("-----\nThese files were in this failed transaction:");
            for f in files {
                eprintln!("    {}", f);
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
    base_url: &reqwest::Url,
    account: Option<AccountNumber>,
    sources: &Vec<String>,
    mut client: reqwest::Client,
    result: &mut JointRegistry<BufReader<File>>,
) -> Result<(), anyhow::Error> {
    let chain_sources = if let Some(account) = account {
        handle_unbooted(get_package_sources(base_url, &mut client, account).await)?
    } else {
        Vec::new()
    };
    if sources.is_empty() && chain_sources.is_empty() {
        result.push(DirectoryRegistry::new(data_directory()?.join("packages")))?;
    } else {
        for source in sources {
            if source.starts_with("http:") || source.starts_with("https:") {
                result.push(HTTPRegistry::new(Url::parse(source)?, client.clone()).await?)?;
            } else if let Ok(owner) = AccountNumber::from_exact(&*source) {
                result.push(HTTPRegistry::with_account(base_url, owner, client.clone()).await?)?;
            } else {
                result.push(DirectoryRegistry::new(source.into()))?;
            }
        }
        for source in chain_sources {
            result.push(HTTPRegistry::with_source(base_url, source, client.clone()).await?)?;
        }
    }
    Ok(())
}

async fn get_package_registry(
    base_url: &reqwest::Url,
    account: Option<AccountNumber>,
    sources: &Vec<String>,
    client: reqwest::Client,
) -> Result<JointRegistry<BufReader<File>>, anyhow::Error> {
    let mut result = JointRegistry::new();
    add_package_registry(base_url, account, sources, client, &mut result).await?;
    Ok(result)
}

async fn boot(args: &BootArgs) -> Result<(), anyhow::Error> {
    let (client, _proxy) = build_client(&args.node_args.proxy).await?;
    let now_plus_120secs = Utc::now() + Duration::seconds(120);
    let expiration = TimePointSec::from(now_plus_120secs);
    let mut package_registry = JointRegistry::new();
    let package_names = if args.services.is_empty() {
        vec!["DevDefault".to_string()]
    } else {
        let (files, packages) = FileSetRegistry::from_files(&args.services)?;
        package_registry.push(files)?;
        packages
    };
    add_package_registry(
        &args.node_args.api,
        None,
        &args.package_source,
        client.clone(),
        &mut package_registry,
    )
    .await?;
    let mut packages = package_registry.resolve(&package_names).await?;
    let (boot_transactions, groups) = create_boot_transactions(
        &args.block_key,
        &args.account_key,
        args.producer.into(),
        true,
        expiration,
        &mut packages,
        args.compression_level,
    )?;

    let num_transactions: usize = groups.iter().map(|group| group.1.len()).sum();
    let progress = ProgressBar::new((num_transactions + boot_transactions.len()) as u64)
        .with_style(ProgressStyle::with_template(
            "{wide_bar} {pos}/{len}\n{msg}",
        )?);

    progress.set_message("Initializing chain");
    push_boot(args, &client, boot_transactions.packed(), &progress).await?;
    progress.inc(boot_transactions.len() as u64);
    for (label, transactions, _) in groups {
        progress.set_message(label);
        for trx in transactions {
            push_transaction_optimistic(
                &args.node_args.api,
                client.clone(),
                trx.packed(),
                args.tx_args.trace,
                args.tx_args.console,
                Some(&progress),
            )
            .await?;
            progress.inc(1)
        }
    }

    progress.finish_with_message(format!("Successfully booted {}", args.node_args.api));
    Ok(())
}

async fn push_boot(
    args: &BootArgs,
    client: &reqwest::Client,
    packed: Vec<u8>,
    progress: &ProgressBar,
) -> Result<(), anyhow::Error> {
    let trace: TransactionTrace = as_json(
        client
            .post(
                account!("x-admin")
                    .url(&args.node_args.api)?
                    .join("native/admin/push_boot")?,
            )
            .body(packed),
    )
    .await?;
    if args.tx_args.console {
        progress.suspend(|| print!("{}", trace.console()));
    }
    args.tx_args
        .trace
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

async fn upload_tree(args: &UploadArgs) -> Result<(), anyhow::Error> {
    let (client, _proxy) = build_client(&args.node_args.proxy).await?;
    let normalized_dest = normalize_upload_path(&args.dest);

    let mut actions = Vec::new();
    fill_tree(
        args.sender.into(),
        &mut actions,
        &normalized_dest,
        &args.source,
        true,
        args.compression_level,
    )?;

    let tapos = get_tapos_for_head(&args.node_args.api, client.clone()).await?;
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

        let trx = with_tapos(&tapos, selected_actions, &args.sig_args.proposer, true);
        running.push(monitor_trx(
            args,
            &client,
            selected_files,
            sign_transaction(trx, &args.sig_args.sign)?,
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

    finish_progress(&args.sig_args, progress, num_trx);
    Ok(())
}

async fn publish(args: &PublishArgs) -> Result<(), anyhow::Error> {
    let (mut client, _proxy) = build_client(&args.node_args.proxy).await?;

    // Read package metadata and determine which packages are already published
    let mut query_existing = "query {".to_string();

    let mut all_meta = Vec::new();

    for (i, path) in args.packages.iter().enumerate() {
        let f = File::open(path).with_context(|| format!("Cannot open {}", path.display()))?;
        let package = PackagedService::new(BufReader::new(f))?;
        let meta = package.meta();
        use std::fmt::Write;
        write!(
            &mut query_existing,
            " p{}: package(owner: {}, name: {}, version: {}) {{ sha256 }}",
            i,
            serde_json::to_string(&args.sender)?,
            serde_json::to_string(&meta.name)?,
            serde_json::to_string(&meta.version)?
        )?;
        all_meta.push(meta.clone());
    }

    query_existing += " }";

    let existing = psibase::gql_query::<serde_json::Value>(
        &args.node_args.api,
        &mut client,
        packages::SERVICE,
        query_existing,
    )
    .await?;
    let existing = existing.as_object().unwrap();
    let num_new = existing.values().filter(|p| p.is_null()).count();

    let progress = ProgressBar::new(num_new as u64).with_style(ProgressStyle::with_template(
        "{wide_bar} {pos}/{len}\n{msg}",
    )?);
    progress.set_message("Preparing transactions");

    let tapos = get_tapos_for_head(&args.node_args.api, client.clone()).await?;

    let action_limit: usize = 1024 * 1024;
    let mut builder = TransactionBuilder::new(
        action_limit,
        |actions: Vec<Action>| -> Result<SignedTransaction, anyhow::Error> {
            Ok(sign_transaction(
                with_tapos(&tapos, actions, &args.sig_args.proposer, false),
                &args.sig_args.sign,
            )?)
        },
    );

    for (i, path) in args.packages.iter().enumerate() {
        let mut f = File::open(path).with_context(|| format!("Cannot open {}", path.display()))?;
        // Read the file
        let mut content = Vec::new();
        f.read_to_end(&mut content)?;
        // Calculate the package hash
        let hash: [u8; 32] = Sha256::digest(&content).into();
        let existing_info = &existing[&format!("p{}", i)];
        let meta = &all_meta[i];
        if existing_info.is_null() {
            let dest = format!("/packages/{}-{}.psi", &meta.name, &meta.version);
            builder.set_label(format!("Publishing {}-{}", &meta.name, &meta.version));
            builder.push(vec![
                sites::Wrapper::pack_from(args.sender.into()).storeSys(
                    dest.clone(),
                    "application/zip".to_string(),
                    None,
                    content.into(),
                ),
                packages::Wrapper::pack_from(args.sender.into()).publish(
                    meta.clone(),
                    hash.into(),
                    dest,
                ),
            ])?;
            progress.inc(1);
        } else if &serde_json::from_value::<Checksum256>(existing_info["sha256"].clone())?.0
            != &hash
        {
            progress.suspend(|| {
                eprintln!(
                    "{}-{} has already been published",
                    &meta.name, &meta.version
                );
            })
        }
    }
    progress.reset();

    let transactions = builder.finish()?;
    let num_transactions: usize = transactions.iter().map(|group| group.1.len()).sum();

    let mut running = Vec::new();
    progress.set_message("Publishing packages");
    let mut n = 0;
    for (label, transactions, carry) in &transactions {
        if !transactions.is_empty() {
            let mut group = Vec::new();
            for trx in transactions {
                let prev = n;
                let progress = &progress;
                let client = client.clone();
                n = 0;
                group.push(async move {
                    push_transaction(
                        &args.node_args.api,
                        client,
                        trx.packed(),
                        args.tx_args.trace,
                        args.tx_args.console,
                        Some(progress),
                    )
                    .await
                    .with_context(|| label.to_string())?;
                    progress.inc(prev);
                    Ok::<(), anyhow::Error>(())
                });
            }
            // The groups can be merged, but not split.
            debug_assert!(!carry);
            debug_assert!(transactions.len() == 1);
            running.push(async {
                try_join_all(group).await?;
                progress.inc(1);
                Ok(())
            })
        } else {
            n += 1;
        }
    }
    let result: Result<_, anyhow::Error> = try_join_all(running).await;
    if result.is_ok() {
        progress.finish_and_clear();
    } else {
        progress.abandon();
    }
    result?;

    finish_progress(&args.sig_args, progress, num_transactions);
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

fn get_package_accounts(ops: &[PackageOp]) -> Vec<AccountNumber> {
    let mut accounts = Vec::new();
    for op in ops {
        match op {
            PackageOp::Install(info) => {
                accounts.extend_from_slice(&info.accounts);
            }
            PackageOp::Replace(_meta, info) => {
                accounts.extend_from_slice(&info.accounts);
            }
            PackageOp::Remove(_meta) => {}
        }
    }
    accounts
}

async fn apply_packages<
    R: PackageRegistry,
    F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>,
    G: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>,
>(
    base_url: &reqwest::Url,
    client: &mut reqwest::Client,
    reg: &R,
    ops: Vec<PackageOp>,
    mut uploader: StagedUpload,
    out: &mut TransactionBuilder<F>,
    files: &mut TransactionBuilder<G>,
    sender: AccountNumber,
    key: &Option<AnyPublicKey>,
    compression_level: u32,
) -> Result<(), anyhow::Error> {
    let mut schemas = SchemaMap::new();
    for op in ops {
        match op {
            PackageOp::Install(info) => {
                // TODO: verify ownership of existing accounts
                let mut package = reg.get_by_info(&info).await?;
                package.load_schemas(base_url, client, &mut schemas).await?;
                out.set_label(format!("Installing {}-{}", &info.name, &info.version));
                files.set_label(format!(
                    "Uploading files for {}-{}",
                    &info.name, &info.version
                ));
                let mut account_actions = vec![];
                package.install_accounts(&mut account_actions, Some(&mut uploader), sender, key)?;
                out.push_all(account_actions)?;
                let mut actions = vec![];
                package.install(
                    &mut actions,
                    Some(&mut uploader),
                    sender,
                    true,
                    compression_level,
                    &mut schemas,
                )?;
                out.push_all(actions)?;
                files.push_all(std::mem::take(&mut uploader.actions))?;
            }
            PackageOp::Replace(meta, info) => {
                let mut package = reg.get_by_info(&info).await?;
                package.load_schemas(base_url, client, &mut schemas).await?;
                // TODO: skip unmodified files (?)
                out.set_label(format!(
                    "Updating {}-{} -> {}-{}",
                    &meta.name, &meta.version, &info.name, &info.version
                ));
                files.set_label(format!(
                    "Uploading files for {}-{}",
                    &info.name, &info.version
                ));
                let old_manifest =
                    get_installed_manifest(base_url, client, &meta.name, sender).await?;
                old_manifest.upgrade(package.manifest(), out)?;
                // Install the new package
                let mut account_actions = vec![];
                package.install_accounts(&mut account_actions, Some(&mut uploader), sender, key)?;
                out.push_all(account_actions)?;
                let mut actions = vec![];
                package.install(
                    &mut actions,
                    Some(&mut uploader),
                    sender,
                    true,
                    compression_level,
                    &mut schemas,
                )?;
                out.push_all(actions)?;
                files.push_all(std::mem::take(&mut uploader.actions))?;
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

async fn do_install<T: Read + Seek>(
    mut client: reqwest::Client,
    package_registry: JointRegistry<T>,
    to_install: Vec<PackageOp>,
    sender: AccountNumber,
    node_args: &NodeArgs,
    sig_args: &SigArgs,
    tx_args: &TxArgs,
    key: &Option<AnyPublicKey>,
    compression_level: u32,
) -> Result<(), anyhow::Error> {
    let tapos = get_tapos_for_head(&node_args.api, client.clone()).await?;

    let mut id_bytes = <[u8; 8]>::default();
    getrandom::getrandom(&mut id_bytes)?;
    let id = u64::from_ne_bytes(id_bytes);

    let index_cell = Cell::new(0);

    let auto_exec_cell = Cell::new(false);

    let build_transaction = |mut actions: Vec<Action>| -> Result<SignedTransaction, anyhow::Error> {
        let index = index_cell.get();
        index_cell.set(index + 1);
        let auto_exec = auto_exec_cell.get();
        actions.insert(
            0,
            packages::Wrapper::pack_from(sender).checkOrder(id.clone(), index),
        );
        Ok(sign_transaction(
            with_tapos(&tapos, actions, &sig_args.proposer, auto_exec),
            &sig_args.sign,
        )?)
    };

    let action_limit: usize = 1024 * 1024;

    let mut trx_builder = TransactionBuilder::new(action_limit, build_transaction);
    let new_accounts = get_accounts_to_create(
        &node_args.api,
        &mut client,
        &get_package_accounts(&to_install),
        sender,
    )
    .await?;
    create_accounts(new_accounts, &mut trx_builder, sender)?;

    let uploader = StagedUpload::new(id.clone(), sig_args.proposer.map_or(sender, |s| s.into()));

    let mut upload_builder = TransactionBuilder::new(
        action_limit,
        |actions: Vec<Action>| -> Result<SignedTransaction, anyhow::Error> {
            Ok(sign_transaction(
                with_tapos(&tapos, actions, &None, false),
                &sig_args.sign,
            )?)
        },
    );
    apply_packages(
        &node_args.api,
        &mut client,
        &package_registry,
        to_install,
        uploader,
        &mut trx_builder,
        &mut upload_builder,
        sender,
        key,
        compression_level,
    )
    .await?;

    trx_builder.push(packages::Wrapper::pack_from(sender).removeOrder(id.clone()))?;

    let upload_transactions = upload_builder.finish()?;
    {
        let total_size = upload_transactions
            .iter()
            .map(|group| {
                group
                    .1
                    .iter()
                    .map(|trx| trx.transaction.len())
                    .sum::<usize>()
            })
            .sum::<usize>();
        let progress = ProgressBar::new(total_size as u64).with_style(
            ProgressStyle::with_template("{wide_bar} {bytes}/{total_bytes}\n{msg}")?,
        );
        let mut running = Vec::new();
        progress.set_message("Uploading files");
        for (_label, transactions, _carry) in &upload_transactions {
            for trx in transactions {
                running.push(async {
                    let len = trx.transaction.len() as u64;
                    push_transaction(
                        &node_args.api,
                        client.clone(),
                        trx.packed(),
                        tx_args.trace,
                        tx_args.console,
                        Some(&progress),
                    )
                    .await?;
                    progress.inc(len);
                    Ok(())
                })
            }
        }
        let result: Result<_, anyhow::Error> = try_join_all(running).await;
        if result.is_ok() {
            progress.finish_and_clear();
        } else {
            progress.abandon();
        }
        result?;
    }

    if trx_builder.num_transactions() == 1 {
        auto_exec_cell.set(true);
    }
    let transactions = trx_builder.finish()?;

    let progress = ProgressBar::new(transactions.len() as u64).with_style(
        ProgressStyle::with_template("{wide_bar} {pos}/{len} packages\n{msg}")?,
    );

    let num_transactions: usize = transactions.iter().map(|group| group.1.len()).sum();

    push_transactions(
        &node_args.api,
        client.clone(),
        transactions,
        tx_args.trace,
        tx_args.console,
        &progress,
    )
    .await?;

    finish_progress(sig_args, progress, num_transactions);

    Ok(())
}

async fn install(args: &InstallArgs) -> Result<(), anyhow::Error> {
    let (mut client, _proxy) = build_client(&args.node_args.proxy).await?;
    let installed = PackageList::installed(&args.node_args.api, &mut client).await?;
    let mut package_registry = JointRegistry::new();
    let (files, packages) = FileSetRegistry::from_files(&args.packages)?;
    package_registry.push(files)?;
    add_package_registry(
        &args.node_args.api,
        Some(args.sender.into()),
        &args.package_source,
        client.clone(),
        &mut package_registry,
    )
    .await?;
    let to_install = installed
        .resolve_changes(&package_registry, &packages, args.reinstall)
        .await?;

    do_install(
        client,
        package_registry,
        to_install,
        args.sender.into(),
        &args.node_args,
        &args.sig_args,
        &args.tx_args,
        &args.key,
        args.compression_level,
    )
    .await
}

async fn upgrade(args: &UpgradeArgs) -> Result<(), anyhow::Error> {
    let (mut client, _proxy) = build_client(&args.node_args.proxy).await?;
    let installed = PackageList::installed(&args.node_args.api, &mut client).await?;
    let mut package_registry = JointRegistry::new();

    let (files, packages) = FileSetRegistry::from_files(&args.packages)?;
    package_registry.push(files)?;
    add_package_registry(
        &args.node_args.api,
        Some(args.sender.into()),
        &args.package_source,
        client.clone(),
        &mut package_registry,
    )
    .await?;

    let to_install = installed
        .resolve_upgrade(
            &package_registry,
            &packages,
            if args.latest {
                PackagePreference::Latest
            } else {
                PackagePreference::Compatible
            },
        )
        .await?;

    do_install(
        client,
        package_registry,
        to_install,
        args.sender.into(),
        &args.node_args,
        &args.sig_args,
        &args.tx_args,
        &args.key,
        args.compression_level,
    )
    .await
}

async fn list(mut args: ListArgs) -> Result<(), anyhow::Error> {
    let (mut client, _proxy) = build_client(&args.node_args.proxy).await?;
    // Resolve selection shortcuts
    if args.all || (!args.installed && !args.available && !args.updates) {
        args.installed = true;
        args.available = true;
        args.updates = true;
    }
    // Load the lists of packages that we need
    let installed =
        handle_unbooted(PackageList::installed(&args.node_args.api, &mut client).await)?;
    let reglist = if args.updates || args.available {
        let package_registry = get_package_registry(
            &args.node_args.api,
            Some(args.sender.into()),
            &args.package_source,
            client.clone(),
        )
        .await?;
        PackageList::from_registry(&package_registry)?
    } else {
        PackageList::new()
    };

    // Show installed packages
    if args.installed || args.updates {
        for (name, version) in installed.max_versions()? {
            let updated = if args.updates {
                reglist.get_update(name, version)?
            } else {
                None
            };
            if let Some(next_version) = updated {
                println!("{} {}->{}", name, version, next_version);
            } else if args.installed {
                println!("{} {}", name, version);
            }
        }
    }

    // Show packages that are not installed
    if args.available {
        for (name, version) in reglist.max_versions()? {
            if !installed.contains_package(name) {
                println!("{} {}", name, version);
            }
        }
    }

    Ok(())
}

async fn search(args: &SearchArgs) -> Result<(), anyhow::Error> {
    let (mut client, _proxy) = build_client(&args.node_args.proxy).await?;
    let mut compiled = vec![];
    for pattern in &args.patterns {
        compiled.push(Regex::new(&("(?i)".to_string() + pattern))?);
    }
    let mut packages =
        handle_unbooted(PackageList::installed(&args.node_args.api, &mut client).await)?;
    let package_registry = get_package_registry(
        &args.node_args.api,
        Some(args.sender.into()),
        &args.package_source,
        client.clone(),
    )
    .await?;
    for info in package_registry.index()? {
        packages.insert_info(info)
    }
    let mut primary_matches = vec![];
    let mut secondary_matches = vec![];
    for (meta, _) in packages.into_info() {
        let mut name_matched = 0;
        let mut description_matched = 0;
        for re in &compiled[..] {
            if re.is_match(&meta.name) {
                name_matched += 1;
            } else if re.is_match(&meta.description) {
                description_matched += 1;
            } else {
                break;
            }
        }
        if name_matched == compiled.len() {
            primary_matches.push(meta);
        } else if name_matched + description_matched == compiled.len() {
            secondary_matches.push(meta);
        }
    }
    fn package_order(a: &Meta, b: &Meta) -> Ordering {
        a.name.cmp(&b.name).then_with(|| {
            Version::new(&b.version)
                .unwrap()
                .cmp(&Version::new(&a.version).unwrap())
        })
    }
    primary_matches.sort_unstable_by(package_order);
    primary_matches.dedup_by(|a, b| &a.name == &b.name);
    secondary_matches.sort_unstable_by(package_order);
    secondary_matches.dedup_by(|a, b| &a.name == &b.name);
    for result in primary_matches {
        println!("{} {}", result.name, result.version);
    }
    for result in secondary_matches {
        println!("{} {}", result.name, result.version);
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
    alt: Option<&(Meta, PackageOrigin)>,
) -> Result<(), anyhow::Error> {
    let mut manifest = get_manifest(reg, base_url, client, package, origin).await?;
    println!("name: {}-{}", &package.name, &package.version);
    let alt_version = if let Some((alt_package, _)) = alt {
        if &alt_package.version != &package.version {
            Some(&alt_package.version)
        } else {
            None
        }
    } else {
        None
    };
    match origin {
        PackageOrigin::Installed { .. } => {
            if let Some(alt_version) = alt_version {
                println!("status: upgrade to {} available", alt_version);
            } else {
                println!("status: installed");
            }
        }
        PackageOrigin::Repo { .. } => {
            if let Some(alt_version) = alt_version {
                println!("status: version {} installed", alt_version);
            } else {
                println!("status: not installed");
            }
        }
    }
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
fn handle_unbooted<T: Default>(list: Result<T, anyhow::Error>) -> Result<T, anyhow::Error> {
    if let Err(e) = &list {
        if e.root_cause()
            .to_string()
            .contains("Node is not connected to any psibase network.")
        {
            return Ok(T::default());
        }
    }
    list
}

async fn package_info(args: &InfoArgs) -> Result<(), anyhow::Error> {
    let (mut client, _proxy) = build_client(&args.node_args.proxy).await?;
    let installed =
        handle_unbooted(PackageList::installed(&args.node_args.api, &mut client).await)?;
    let mut package_registry = JointRegistry::new();
    let (files, packages) = FileSetRegistry::from_files(&args.packages)?;
    package_registry.push(files)?;
    add_package_registry(
        &args.node_args.api,
        Some(args.sender.into()),
        &args.package_source,
        client.clone(),
        &mut package_registry,
    )
    .await?;
    let reglist = PackageList::from_registry(&package_registry)?;

    for package in &packages {
        if let Some((meta, origin)) = installed.get_by_name(package)? {
            let alt = reglist.get_by_ref(&PackageRef {
                name: meta.name.clone(),
                version: format!(">{}", &meta.version),
            })?;
            show_package(
                &package_registry,
                &args.node_args.api,
                &mut client,
                meta,
                origin,
                alt,
            )
            .await?;
        } else if let Some((meta, origin)) = reglist.get_by_name(package)? {
            let alt = installed.get_by_ref(&PackageRef {
                name: meta.name.clone(),
                version: "*".to_string(),
            })?;
            show_package(
                &package_registry,
                &args.node_args.api,
                &mut client,
                meta,
                origin,
                alt,
            )
            .await?;
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

#[derive(Deserialize)]
struct LoginReply {
    access_token: String,
    token_type: String,
}

async fn handle_login(args: &LoginArgs) -> Result<(), anyhow::Error> {
    let (client, _proxy) = build_client(&args.node_args.proxy).await?;

    let root_host = args
        .node_args
        .api
        .domain()
        .expect("api must use a domain name");
    let actions = vec![login_action(args.user.into(), args.app.into(), root_host)];

    let expiration = TimePointSec::from(chrono::Utc::now() + chrono::Duration::seconds(10));
    let tapos = Tapos {
        expiration: expiration,
        refBlockSuffix: 0,
        flags: Tapos::DO_NOT_BROADCAST_FLAG,
        refBlockIndex: 0,
    };
    let trx = Transaction {
        tapos: tapos,
        actions,
        claims: vec![],
    };

    let reply: LoginReply = as_json(
        client
            .post(transact::SERVICE.url(&args.node_args.api)?.join("/login")?)
            .header("Content-Type", "application/octet-stream")
            .header("Accept", "application/json")
            .body(sign_transaction(trx, &args.sig_args.sign)?.packed()),
    )
    .await?;
    println!("{} {}", reply.token_type, reply.access_token);
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
        let mut command = BasicArgs::augment_args(command)
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
    let mut command = BasicArgs::augment_args(command);
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

fn parse_args() -> Result<BasicArgs, anyhow::Error> {
    let command = clap::Command::new("psibase");
    let mut command = BasicArgs::augment_args(command);
    command.build();
    command = command
        .disable_help_subcommand(true)
        .disable_help_flag(true);
    Ok(BasicArgs::from_arg_matches(&command.get_matches())?)
}

struct LocalhostResolver {
    resolver: hyper::client::connect::dns::GaiResolver,
}

impl LocalhostResolver {
    fn new() -> LocalhostResolver {
        LocalhostResolver {
            resolver: hyper::client::connect::dns::GaiResolver::new(),
        }
    }
}

async fn forward_resolve(
    mut resolver: hyper::client::connect::dns::GaiResolver,
    mut name: hyper::client::connect::dns::Name,
) -> Result<reqwest::dns::Addrs, Box<dyn core::error::Error + Send + Sync>> {
    if name.as_str().ends_with(".localhost") {
        name = "localhost".parse().map_err(|err| Box::new(err))?
    }
    match resolver.call(name).await {
        Ok(addrs) => Ok(Box::new(addrs)),
        Err(err) => Err(Box::new(err)),
    }
}

impl reqwest::dns::Resolve for LocalhostResolver {
    fn resolve(&self, name: hyper::client::connect::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(forward_resolve(self.resolver.clone(), name))
    }
}

async fn build_client(
    proxy: &Option<Url>,
) -> Result<(reqwest::Client, Option<AutoAbort>), anyhow::Error> {
    let (builder, result) = apply_proxy(reqwest::Client::builder(), proxy).await?;
    Ok((
        builder
            .gzip(true)
            .dns_resolver(Arc::new(LocalhostResolver::new()))
            .build()?,
        result,
    ))
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
    if let Some(help) = &args.help {
        return print_help(help);
    }
    let Some(command) = args.command else {
        return print_help(&[]);
    };
    match command {
        Command::Boot(args) => boot(&args).await?,
        Command::Push(args) => push(args).await?,
        Command::Create(args) => create(&args).await?,
        Command::Modify(args) => modify(&args).await?,
        Command::Deploy(args) => deploy(&args).await?,
        Command::Upload(args) => {
            if args.recursive {
                if args.content_type.is_some() {
                    return Err(anyhow!("--recursive is incompatible with --content-type"));
                }
                upload_tree(&args).await?
            } else {
                upload(&args).await?
            }
        }
        Command::Publish(args) => publish(&args).await?,
        Command::Install(args) => install(&args).await?,
        Command::Upgrade(args) => upgrade(&args).await?,
        Command::List(args) => list(args).await?,
        Command::Search(args) => search(&args).await?,
        Command::Info(args) => package_info(&args).await?,
        Command::CreateToken(args) => {
            create_token(Duration::seconds(args.expires_after), &args.mode)?
        }
        Command::Login(args) => handle_login(&args).await?,
        Command::Config(config) => handle_cli_config_cmd(&config)?,
        Command::Help { command } => print_help(&command)?,
        Command::External(argv) => handle_external(&argv)?,
    }

    Ok(())
}
