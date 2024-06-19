use anyhow::Error;
use anyhow::{anyhow, Context};
use cargo_metadata::Message;
use cargo_metadata::Metadata;
use clap::{Parser, Subcommand};
use console::style;
use psibase::{ExactAccountNumber, PrivateKey, PublicKey};
use regex::Regex;
use std::ffi::OsString;
use std::fs::{read, write, OpenOptions};
use std::path::Path;
use std::path::PathBuf;
use std::process::{exit, Stdio};
use std::{env, fs};
use tokio::io::AsyncBufReadExt;
use url::Url;
use walrus::Module;
use wasm_opt::OptimizationOptions;

mod link;
use link::link_module;

const SERVICE_ARGS: &[&str] = &["--lib", "--crate-type=cdylib"];
const SERVICE_ARGS_RUSTC: &[&str] = &["--", "-C", "target-feature=+simd128,+bulk-memory,+sign-ext"];

const SERVICE_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/service_wasi_polyfill.wasm"));

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

    /// Register the service with HttpServer. This allows the service to host a
    /// website, serve RPC requests, and serve GraphQL requests.
    #[clap(short = 'p', long)]
    register_proxy: bool,

    /// Sender to use when creating the account.
    #[clap(short = 'S', long, value_name = "SENDER", default_value = "accounts")]
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

fn pretty_path(label: &str, filename: &Path) {
    pretty(label, &filename.file_name().unwrap().to_string_lossy());
}

fn optimize(code: &mut Module) -> Result<(), Error> {
    let file = tempfile::NamedTempFile::new()?;
    code.emit_wasm_file(file.path())?;

    let debug_build = false;
    OptimizationOptions::new_opt_level_2()
        .shrink_level(wasm_opt::ShrinkLevel::Level1)
        .enable_feature(wasm_opt::Feature::BulkMemory)
        .enable_feature(wasm_opt::Feature::SignExt)
        .enable_feature(wasm_opt::Feature::Simd)
        .debug_info(debug_build)
        .run(file.path(), file.path())?;

    let mut config = walrus::ModuleConfig::new();
    config.generate_name_section(false);
    config.generate_producers_section(false);
    *code = config.parse_file(file.path().to_path_buf())?;

    Ok(())
}

fn process(filename: &PathBuf, polyfill: Option<&[u8]>) -> Result<(), Error> {
    let timestamp_file = filename.to_string_lossy().to_string() + ".cargo_psibase";
    let md = fs::metadata(filename)
        .with_context(|| format!("Failed to get metadata for {}", filename.to_string_lossy()))?;
    if let Ok(md2) = fs::metadata::<PathBuf>(timestamp_file.as_str().into()) {
        if md2.modified().unwrap() >= md.modified().unwrap() {
            return Ok(());
        }
    }

    let code = &read(filename)
        .with_context(|| format!("Failed to read {}", filename.to_string_lossy()))?;

    let debug_build = false;
    let mut config = walrus::ModuleConfig::new();
    config.generate_name_section(debug_build);
    config.generate_producers_section(false);
    let mut dest_module = config.parse(code)?;

    if let Some(polyfill) = polyfill {
        let polyfill_source_module = config.parse(polyfill)?;
        pretty_path("Polyfilling", filename);
        link_module(&polyfill_source_module, &mut dest_module)?;
    } else {
        pretty("Polyfilling", "SKIPPED! No polyfill functions found");
    }

    pretty_path("Reoptimizing", filename);
    optimize(&mut dest_module)?;

    write(filename, dest_module.emit_wasm())
        .with_context(|| format!("Failed to write {}", filename.to_string_lossy()))?;

    OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(timestamp_file)?;

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
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()?;
    if !output.status.success() {
        exit(output.status.code().unwrap());
    }
    Ok(serde_json::from_slice::<Metadata>(&output.stdout)?)
}

async fn build(
    packages: &[&str],
    envs: Vec<(&str, &str)>,
    args: &[&str],
    poly: Option<&[u8]>,
) -> Result<Vec<PathBuf>, Error> {
    let mut command = tokio::process::Command::new(get_cargo())
        .envs(envs)
        .arg("rustc")
        .args(args)
        .arg("--release")
        .arg("--target=wasm32-wasi")
        .arg("--message-format=json-diagnostic-rendered-ansi")
        .arg("--color=always")
        .args(SERVICE_ARGS_RUSTC)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = tokio::io::BufReader::new(command.stdout.take().unwrap()).lines();
    let stderr = tokio::io::BufReader::new(command.stderr.take().unwrap()).lines();
    let status = command.wait();
    let (status, files, _) =
        tokio::join!(status, get_files(packages, stdout), print_messages(stderr),);

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

async fn get_test_services() -> Result<Vec<(String, String)>, Error> {
    let mut command: tokio::process::Child = tokio::process::Command::new(get_cargo())
        .arg("test")
        .arg("--color=always")
        .arg("--")
        .arg("--show-output")
        .arg("_psibase_test_get_needed_services")
        .stdout(Stdio::piped())
        .spawn()?;

    let mut stdout = tokio::io::BufReader::new(command.stdout.take().unwrap()).lines();
    let status = command.wait();

    let (status, lines) = tokio::join!(
        status, //
        async {
            let mut lines = Vec::new();
            while let Some(line) = stdout.next_line().await? {
                lines.push(line);
            }
            Ok::<_, Error>(lines)
        },
    );

    let status = status?;
    if !status.success() {
        exit(status.code().unwrap());
    }

    let re = Regex::new(r"^psibase-test-need-service +([^ ]+) +([^ ]+)$").unwrap();
    Ok(lines?
        .iter()
        .filter_map(|line| re.captures(line))
        .map(|cap| (cap[1].to_owned(), cap[2].to_owned()))
        .collect())
}

async fn test(metadata: &Metadata, root: &str) -> Result<(), Error> {
    let mut services = get_test_services().await?;
    services.sort();
    services.dedup();

    pretty(
        "Services",
        &services
            .iter()
            .map(|(s, _)| s.to_owned())
            .reduce(|acc, item| acc + ", " + &item)
            .unwrap_or_default(),
    );

    let mut service_wasms = String::new();
    for (service, src) in services {
        pretty("Service", &format!("{} needed by {}", service, src));
        let mut id = None;
        for package in &metadata.packages {
            if package.name == service {
                // TODO: detect multiple versions
                id = Some(&package.id.repr);
            }
        }
        if id.is_none() {
            return Err(anyhow!(
                "can not find package {service}; try: cargo add {service}"
            ));
        }

        let wasms = build(
            &[id.unwrap()],
            vec![],
            &["--lib", "--crate-type=cdylib", "-p", &service],
            Some(SERVICE_POLYFILL),
        )
        .await?;
        if wasms.is_empty() {
            return Err(anyhow!("Service {} produced no wasm targets", service));
        }
        if wasms.len() > 1 {
            return Err(anyhow!(
                "Service {} produced multiple wasm targets",
                service
            ));
        }
        if !service_wasms.is_empty() {
            service_wasms += ";";
        }
        service_wasms += &(service + ";" + &wasms.into_iter().next().unwrap().to_string_lossy());
    }

    // println!("CARGO_PSIBASE_SERVICE_LOCATIONS={:?}", service_wasms);
    let tests = build(
        &[root],
        vec![
            ("CARGO_PSIBASE_TEST", ""),
            ("CARGO_PSIBASE_SERVICE_LOCATIONS", &service_wasms),
        ],
        &["--tests"],
        None,
    )
    .await?;
    if tests.is_empty() {
        return Err(anyhow!("No tests found"));
    }

    for test in tests {
        pretty_path("Running", &test);
        let args = [test.to_str().unwrap(), "--nocapture"];
        let msg = format!("Failed running: psitest {}", args.join(" "));
        if !std::process::Command::new("psitest")
            .args(args)
            .status()
            .context(msg.clone())?
            .success()
        {
            return Err(anyhow! {msg});
        }
    }

    Ok(())
}

async fn deploy(opts: &DeployCommand, root: &str) -> Result<(), Error> {
    let files = build(&[root], vec![], SERVICE_ARGS, Some(SERVICE_POLYFILL)).await?;
    if files.is_empty() {
        Err(anyhow!("Nothing found to deploy"))?
    }
    if files.len() > 1 {
        Err(anyhow!("Expected a single library"))?
    }

    let account = if let Some(account) = opts.account {
        account.to_string()
    } else {
        files[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .replace('_', "-")
            .replace(".wasm", "")
    };

    let mut args = vec!["--suppress-ok".into(), "deploy".into()];
    if let Some(key) = &opts.create_account {
        args.append(&mut vec!["--create-account".into(), key.to_string()]);
    }
    if opts.create_insecure_account {
        args.push("--create-insecure-account".into());
    }
    if opts.register_proxy {
        args.push("--register-proxy".into());
    }
    args.append(&mut vec!["--sender".into(), opts.sender.to_string()]);
    args.push(account.clone());
    args.push(files[0].to_string_lossy().into());

    let msg = format!("Failed running: psibase {}", args.join(" "));
    if !std::process::Command::new("psibase")
        .args(args)
        .status()
        .context(msg.clone())?
        .success()
    {
        Err(anyhow! {msg})?;
    }

    pretty("Deployed", &account);

    Ok(())
}

#[tokio::main]
async fn main2() -> Result<(), Error> {
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
    let root = &metadata
        .resolve
        .as_ref()
        .unwrap()
        .root
        .as_ref()
        .unwrap()
        .repr;

    match args.command {
        Command::Build {} => {
            build(&[root], vec![], SERVICE_ARGS, Some(SERVICE_POLYFILL)).await?;
            pretty("Done", "");
        }
        Command::Test {} => {
            test(&metadata, root).await?;
            pretty("Done", "All tests passed");
        }
        Command::Deploy(args) => {
            deploy(&args, root).await?;
        }
    };

    Ok(())
}

fn main() {
    if let Err(e) = main2() {
        println!("{:}: {:?}", style("error").bold().red(), e);
    }
}
