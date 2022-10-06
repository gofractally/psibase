mod link;

use anyhow::Error;
use anyhow::{anyhow, Context};
use binaryen::{CodegenConfig, Module};
use cargo_metadata::Message;
use cargo_metadata::Metadata;
use clap::{Parser, Subcommand};
use console::style;
use psibase::{ExactAccountNumber, PrivateKey, PublicKey};
use std::env;
use std::ffi::OsString;
use std::fs::{read, write};
use std::path::Path;
use std::path::PathBuf;
use std::process::{exit, Stdio};
use tokio::io::AsyncBufReadExt;
use url::Url;

const SERVICE_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/service_wasi_polyfill.wasm"));
const TESTER_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/tester_wasi_polyfill.wasm"));

/// Build, test, and deploy psibase services
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None, bin_name = "cargo")]
struct CargoSubcommandArgs {
    #[clap(subcommand)]
    command: PsibaseCommand,
}

#[derive(Subcommand, Debug)]
enum PsibaseCommand {
    Psibase(Args),
}

/// Build, test, and deploy psibase services
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    // TODO: load default from environment variable
    /// API Endpoint
    #[clap(
        short = 'a',
        long,
        value_name = "URL",
        default_value = "http://psibase.127.0.0.1.sslip.io:8080/"
    )]
    api: Url,

    /// Sign with this key (repeatable)
    #[clap(short = 's', long, value_name = "KEY")]
    sign: Vec<PrivateKey>,

    #[clap(subcommand)]
    command: Command,
}

#[derive(Parser, Debug)]
struct DeployCommand {
    /// Account to deploy service on
    account: Option<ExactAccountNumber>,

    /// Create the account if it doesn't exist. Also set the account to
    /// authenticate using this key, even if the account already existed.
    #[clap(short = 'c', long, value_name = "KEY")]
    create_account: Option<PublicKey>,

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
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Build a service
    Build {},

    /// Build and run tests
    Test {},

    /// Build and deploy a service
    Deploy(DeployCommand),
}

fn pretty(label: &str, message: &str) {
    println!("{:>12} {}", style(label).bold().green(), message);
}

fn status(label: &str, filename: &Path) {
    pretty(label, &filename.file_name().unwrap().to_string_lossy());
}

fn optimize(filename: &Path, code: &[u8]) -> Result<Vec<u8>, Error> {
    status("Reoptimizing", filename);
    let mut module = Module::read(code)
        .map_err(|_| anyhow!("Binaryen failed to parse {}", filename.to_string_lossy()))?;
    module.optimize(&CodegenConfig {
        shrink_level: 1,
        optimization_level: 2,
        debug_info: false,
    });
    Ok(module.write())
}

fn process(filename: &PathBuf, polyfill: &[u8]) -> Result<(), Error> {
    let code = &read(filename)
        .with_context(|| format!("Failed to read {}", filename.to_string_lossy()))?;
    status("Polyfilling", filename);
    let code = link::link(filename, code, polyfill)?;
    let code = optimize(filename, &code)?;
    write(filename, code)
        .with_context(|| format!("Failed to write {}", filename.to_string_lossy()))?;
    Ok(())
}

async fn get_files(
    packages: &[&str],
    mut lines: tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>,
) -> Result<Vec<PathBuf>, Error> {
    let mut result = Vec::new();
    while let Some(line) = lines.next_line().await? {
        match serde_json::from_str::<cargo_metadata::Message>(&line)? {
            Message::CompilerMessage(msg) => {
                print!("{}", msg.message.rendered.unwrap());
            }
            Message::CompilerArtifact(artifact) => {
                if packages.contains(&artifact.package_id.repr.as_str()) {
                    result.extend(
                        artifact
                            .filenames
                            .iter()
                            .map(|p| p.clone().into_std_path_buf())
                            .filter(|p| p.as_path().extension().unwrap_or_default() == "wasm"),
                    );
                }
            }
            _ => (),
        }
    }
    Ok(result)
}

async fn print_messages(
    mut lines: tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStderr>>,
) -> Result<(), Error> {
    while let Some(line) = lines.next_line().await? {
        eprintln!("{}", line);
    }
    Ok(())
}

fn get_cargo() -> OsString {
    env::var_os("CARGO").unwrap_or_else(|| "cargo".into())
}

fn get_metadata() -> Result<Metadata, Error> {
    let output = std::process::Command::new(get_cargo())
        .arg("metadata")
        .arg("--format-version=1")
        .arg("--no-deps")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()?;
    if !output.status.success() {
        exit(output.status.code().unwrap());
    }
    Ok(serde_json::from_slice::<Metadata>(&output.stdout)?)
}

async fn build(
    metadata: &Metadata,
    envs: Vec<(&str, &str)>,
    args: &[&str],
    poly: &[u8],
) -> Result<Vec<PathBuf>, Error> {
    let packages: Vec<_> = metadata
        .packages
        .iter()
        .map(|p| p.id.repr.as_str())
        .collect();

    let mut command = tokio::process::Command::new(get_cargo())
        .envs(envs)
        .arg("rustc")
        .args(args)
        .arg("--release")
        .arg("--target=wasm32-wasi")
        .arg("--message-format=json-diagnostic-rendered-ansi")
        .arg("--color=always")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = tokio::io::BufReader::new(command.stdout.take().unwrap()).lines();
    let stderr = tokio::io::BufReader::new(command.stderr.take().unwrap()).lines();
    let status = command.wait();
    let (status, files, _) =
        tokio::join!(status, get_files(&packages, stdout), print_messages(stderr),);

    let status = status?;
    if !status.success() {
        exit(status.code().unwrap());
    }

    let files = files?;
    for f in &files {
        process(f, poly)?
    }

    Ok(files)
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut is_cargo_subcommand = false;
    if let Some(arg) = env::args().nth(1) {
        is_cargo_subcommand = arg == "psibase";
    }
    let args = if is_cargo_subcommand {
        match CargoSubcommandArgs::parse().command {
            PsibaseCommand::Psibase(args) => args,
        }
    } else {
        Args::parse()
    };

    let metadata = get_metadata()?;
    let service_args = &["--lib", "--crate-type=cdylib"];
    let test_args = &["--tests"];

    match args.command {
        Command::Build {} => {
            build(&metadata, vec![], service_args, SERVICE_POLYFILL).await?;
        }
        Command::Test {} => {
            build(&metadata, vec![], service_args, SERVICE_POLYFILL).await?;
            let tests = build(
                &metadata,
                vec![("CARGO_PSIBASE_TEST", "")],
                test_args,
                TESTER_POLYFILL,
            )
            .await?;
            println!("\n{:?}\n", tests);
            todo!()
        }
        Command::Deploy(_args) => {
            let files = build(&metadata, vec![], service_args, SERVICE_POLYFILL).await?;
            if files.is_empty() {
                Err(anyhow!("Nothing found to deploy"))?
            }
            if files.len() > 1 {
                Err(anyhow!("Expected a single library"))?
            }
            todo!()
        }
    };

    pretty("Done", "");
    Ok(())
}
