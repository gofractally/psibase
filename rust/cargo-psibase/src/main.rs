use anyhow::Error;
use anyhow::{anyhow, Context};
use cargo_metadata::semver::Version;
use cargo_metadata::Message;
use cargo_metadata::{DepKindInfo, DependencyKind, Metadata, NodeDep, PackageId};
use clap::{Parser, Subcommand};
use console::style;
use psibase::{ExactAccountNumber, PackageInfo};
use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fs::{read, write, File, OpenOptions};
use std::path::Path;
use std::path::PathBuf;
use std::process::{exit, ExitCode, Stdio};
use std::{env, fs};
use tokio::io::AsyncBufReadExt;
use walrus::Module;
use wasm_opt::OptimizationOptions;

mod link;
use link::link_module;
mod package;
use package::*;

/// The version of the cargo-psibase crate at compile time
const CARGO_PSIBASE_VERSION: &str = env!("CARGO_PKG_VERSION");

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
    /// Sign with this key (repeatable)
    #[clap(short = 's', long, value_name = "KEY")]
    sign: Vec<String>,

    /// Path to Cargo.toml
    #[clap(long, global = true, value_name = "PATH")]
    manifest_path: Option<PathBuf>,

    /// Directory for all generated artifacts
    #[clap(long, global = true, value_name = "DIRECTORY")]
    target_dir: Option<PathBuf>,

    #[clap(subcommand)]
    command: Command,
}

#[derive(Parser, Debug)]
struct DeployCommand {
    /// API Endpoint URL (ie https://psibase-api.example.com) or a Host Alias (ie prod, dev). See `psibase config --help` for more details.
    #[clap(
        short = 'a',
        long,
        value_name = "URL_OR_HOST_ALIAS",
        env = "PSINODE_URL"
    )]
    api: Option<String>,

    /// Account to deploy service on
    account: Option<ExactAccountNumber>,

    /// Create the account if it doesn't exist. Also set the account to
    /// authenticate using this key, even if the account already existed.
    #[clap(short = 'c', long, value_name = "KEY")]
    create_account: Option<String>,

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

#[derive(Parser, Debug)]
struct InstallCommand {
    /// API Endpoint URL (ie https://psibase-api.example.com) or a Host Alias (ie prod, dev). See `psibase config --help` for more details.
    #[clap(
        short = 'a',
        long,
        value_name = "URL_OR_HOST_ALIAS",
        env = "PSINODE_URL"
    )]
    api: Option<String>,

    /// Sender to use for installing. The packages and all accounts
    /// that they create will be owned by this account.
    #[clap(short = 'S', long, value_name = "SENDER")]
    sender: Option<ExactAccountNumber>,

    /// Configure compression level for package file uploads
    /// (1=fastest, 11=most compression)
    #[clap(short = 'z', long, value_name = "LEVEL")]
    compression_level: Option<u32>,

    /// Reinstall the package
    #[clap(short = 'r', long)]
    reinstall: bool,
}

#[derive(Parser, Debug)]
struct TestCommand {
    /// Path to psitest executable
    #[clap(long, default_value = "psitest")]
    psitest: PathBuf,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Build a service
    Build {},

    /// Build a psibase package
    Package {},

    /// Build and run tests
    Test(TestCommand),

    /// Build and deploy a service
    Deploy(DeployCommand),

    /// Build and install a psibase package
    Install(InstallCommand),
}

fn pretty(label: &str, message: &str) {
    println!("{:>12} {}", style(label).bold().green(), message);
}

fn warn(label: &str, message: &str) {
    println!(
        "{}: {} {}",
        style("warning").bold().yellow(),
        style(label).bold().yellow(),
        message
    );
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

fn get_manifest_path(args: &Args) -> Vec<&OsStr> {
    if let Some(mpath) = &args.manifest_path {
        vec![OsStr::new("--manifest-path"), mpath.as_os_str()]
    } else {
        vec![]
    }
}

fn get_target_dir(args: &Args) -> Vec<&OsStr> {
    if let Some(tdir) = &args.target_dir {
        vec![OsStr::new("--target-dir"), tdir.as_os_str()]
    } else {
        vec![]
    }
}

fn get_metadata(args: &Args) -> Result<Metadata, Error> {
    let output = std::process::Command::new(get_cargo())
        .arg("metadata")
        .arg("--format-version=1")
        .args(get_manifest_path(args))
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()?;
    if !output.status.success() {
        exit(output.status.code().unwrap());
    }
    Ok(serde_json::from_slice::<Metadata>(&output.stdout)?)
}

/// Check the psibase dependency version against cargo-psibase
fn check_psibase_version(metadata: &Metadata) {
    let psibase_version = &metadata
        .packages
        .iter()
        .find(|pkg| pkg.name == "psibase")
        .expect("psibase dependency not found")
        .version;

    let cargo_psibase_version = Version::parse(CARGO_PSIBASE_VERSION).unwrap();

    if *psibase_version != cargo_psibase_version {
        let version_mismatch_msg = format!(
            "The version of `cargo-psibase` used (v{}) and the version of `psibase` on which your service depends (v{}) should match",
            CARGO_PSIBASE_VERSION, psibase_version
        );
        warn("Version Mismatch", &version_mismatch_msg);
    }
}

async fn build(
    args: &Args,
    packages: &[&str],
    envs: Vec<(&str, &str)>,
    extra_args: &[&str],
    poly: Option<&[u8]>,
) -> Result<Vec<PathBuf>, Error> {
    let mut command = tokio::process::Command::new(get_cargo())
        .envs(envs)
        .arg("rustc")
        .args(extra_args)
        .arg("--release")
        .arg("--target=wasm32-wasip1")
        .args(get_manifest_path(args))
        .args(get_target_dir(args))
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

async fn build_plugin(
    args: &Args,
    packages: &[&str],
    extra_args: &[&str],
) -> Result<Vec<PathBuf>, Error> {
    let mut command = tokio::process::Command::new(get_cargo())
        .arg("component")
        .arg("build")
        .args(extra_args)
        .arg("--release")
        .arg("--target=wasm32-wasip1")
        .args(get_manifest_path(args))
        .args(get_target_dir(args))
        .arg("--message-format=json-render-diagnostics")
        .arg("--color=always")
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

    Ok(files?)
}

async fn build_package_root(args: &Args, package: &str) -> Result<(), Error> {
    let mut command = tokio::process::Command::new(get_cargo())
        .arg("rustc")
        .args(&["-p", package])
        .arg("--release")
        .arg("--lib")
        .arg("--target=wasm32-wasi")
        .args(get_manifest_path(args))
        .args(get_target_dir(args))
        .arg("--color=always")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;

    let status = command.wait().await?;

    if !status.success() {
        exit(status.code().unwrap());
    }

    Ok(())
}

fn is_wasm32_wasi(dep: &DepKindInfo) -> bool {
    if let Some(platform) = &dep.target {
        if platform.matches("wasm32-wasip1", &[]) {
            true
        } else {
            false
        }
    } else {
        true
    }
}

fn is_test_dependency(dep: &NodeDep) -> bool {
    for kind in &dep.dep_kinds {
        if matches!(
            kind.kind,
            DependencyKind::Normal | DependencyKind::Development
        ) && is_wasm32_wasi(kind)
        {
            return true;
        }
    }
    false
}

fn is_normal_dependency(dep: &NodeDep) -> bool {
    for kind in &dep.dep_kinds {
        if matches!(kind.kind, DependencyKind::Normal) && is_wasm32_wasi(kind) {
            return true;
        }
    }
    false
}

struct PackageSet<'a> {
    packages: Vec<&'a PackageId>,
    visited: HashSet<&'a PackageId>,
    metadata: &'a MetadataIndex<'a>,
}

impl<'a> PackageSet<'a> {
    fn new(metadata: &'a MetadataIndex) -> Self {
        PackageSet {
            packages: Vec::new(),
            visited: HashSet::new(),
            metadata,
        }
    }
    fn try_insert(&mut self, id: &'a PackageId) -> Result<bool, anyhow::Error> {
        if package::get_metadata(self.metadata.packages.get(id.repr.as_str()).unwrap())?
            .is_package()
        {
            if self.visited.insert(id) {
                self.packages.push(id);
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn resolve_dependencies(&mut self) -> Result<(), anyhow::Error> {
        for i in 0.. {
            if i == self.packages.len() {
                break;
            }
            let id = &self.packages[i];
            let node = self.metadata.resolved.get(&id.repr.as_str()).unwrap();
            for dep in &node.deps {
                if is_normal_dependency(dep) {
                    self.try_insert(&dep.pkg)?;
                }
            }
        }
        Ok(())
    }
    async fn build(&self, args: &Args) -> Result<Vec<PackageInfo>, Error> {
        pretty(
            "Packages",
            &self
                .packages
                .iter()
                .map(|item| {
                    self.metadata
                        .packages
                        .get(&item.repr.as_str())
                        .unwrap()
                        .name
                        .to_string()
                })
                .reduce(|acc, item| acc + ", " + &item)
                .unwrap_or_default(),
        );

        let mut index = Vec::new();

        for p in &self.packages {
            index.push(build_package(args, self.metadata, Some(&p.repr)).await?);
        }
        Ok(index)
    }
}

fn get_test_packages<'a>(
    metadata: &'a MetadataIndex,
    root: &str,
) -> Result<PackageSet<'a>, anyhow::Error> {
    let node = metadata.resolved.get(root).unwrap();
    let mut packages = PackageSet::new(metadata);
    let root = &metadata.packages.get(root).unwrap().id;
    packages.try_insert(root)?;
    // get packages that are dependencies and dev-dependencies of the root package
    for dep in &node.deps {
        if is_test_dependency(dep) {
            packages.try_insert(&dep.pkg)?;
        }
    }
    packages.resolve_dependencies()?;
    Ok(packages)
}

async fn test(
    args: &Args,
    opts: &TestCommand,
    metadata: &MetadataIndex<'_>,
    root: &str,
) -> Result<(), Error> {
    //
    let packages = get_test_packages(metadata, root)?;
    pretty("Packages", "building dependencies...");
    let index = packages.build(args).await?;

    // Write a package index specific to the crate
    let target_dir = args.target_dir.as_ref().map_or_else(
        || metadata.metadata.target_directory.as_std_path(),
        |p| p.as_path(),
    );
    let out_dir = target_dir.join("wasm32-wasip1/release/packages");
    let index_file =
        out_dir.join(metadata.packages.get(root).unwrap().name.clone() + "-index.json");
    serde_json::to_writer(File::create(&index_file)?, &index)?;

    pretty("Test", "building unit tests...");

    let tests = build(
        args,
        &[root],
        vec![
            ("CARGO_PSIBASE_TEST", ""),
            (
                "CARGO_PSIBASE_PACKAGE_PATH",
                index_file.canonicalize()?.to_str().unwrap(),
            ),
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
        if !std::process::Command::new(&opts.psitest)
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

async fn deploy(args: &Args, opts: &DeployCommand, root: &str) -> Result<(), Error> {
    let files = build(args, &[root], vec![], SERVICE_ARGS, Some(SERVICE_POLYFILL)).await?;
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

    let mut args = vec!["deploy".into()];
    if let Some(api) = &opts.api {
        args.push("--api".into());
        args.push(api.to_string());
    }
    args.push("--suppress-ok".into());
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

async fn install(
    args: &Args,
    opts: &InstallCommand,
    metadata: &MetadataIndex<'_>,
    root: &str,
) -> Result<(), Error> {
    let root = &metadata.packages.get(root).unwrap().id;

    let mut packages = PackageSet::new(metadata);
    let root = &metadata.packages.get(&root.repr.as_str()).unwrap().id;
    if !packages.try_insert(root)? {
        Err(anyhow!(
            "{} is not a psibase package",
            &metadata.packages.get(&root.repr.as_str()).unwrap().name
        ))?
    }
    packages.resolve_dependencies()?;
    let index = packages.build(args).await?;

    let mut command = std::process::Command::new("psibase");

    command.arg("install");
    if let Some(api) = &opts.api {
        command.args(["--api", api.as_str()]);
    }
    command.arg("--suppress-ok");
    if let Some(sender) = &opts.sender {
        command.args(["--sender", &sender.to_string()]);
    }

    if opts.reinstall {
        command.args(["--reinstall"]);
    }

    if let Some(compression_level) = opts.compression_level {
        command.args(["--compression-level", &compression_level.to_string()]);
    }

    // Get package files
    let out_dir = get_package_dir(args, metadata);
    for info in index {
        command.arg(out_dir.join(&info.file));
    }

    let msg = format!("Failed running: {:?}", command);
    if !command.status().context(msg.clone())?.success() {
        Err(anyhow! {msg})?;
    }
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

    let metadata = get_metadata(&args)?;
    let root = metadata
        .resolve
        .as_ref()
        .unwrap()
        .root
        .as_ref()
        .map(|r| r.repr.as_str());
    check_psibase_version(&metadata);

    match &args.command {
        Command::Build {} => {
            let Some(root) = root else {
                Err(anyhow!("Don't know how to build workspace"))?
            };
            build(&args, &[root], vec![], SERVICE_ARGS, Some(SERVICE_POLYFILL)).await?;
            pretty("Done", "");
        }
        Command::Package {} => {
            build_package(&args, &MetadataIndex::new(&metadata), root).await?;
            pretty("Done", "");
        }
        Command::Test(opts) => {
            let Some(root) = root else {
                Err(anyhow!("Don't know how to test workspace"))?
            };
            test(&args, opts, &MetadataIndex::new(&metadata), root).await?;
            pretty("Done", "All tests passed");
        }
        Command::Deploy(opts) => {
            let Some(root) = root else {
                Err(anyhow!("Don't know how to deploy workspace"))?
            };
            deploy(&args, opts, root).await?;
        }
        Command::Install(opts) => {
            let Some(root) = root else {
                Err(anyhow!("Don't know how to install workspace"))?
            };
            install(&args, opts, &MetadataIndex::new(&metadata), root).await?;
        }
    };

    Ok(())
}

fn main() -> ExitCode {
    if let Err(e) = main2() {
        println!("{:}: {:?}", style("error").bold().red(), e);
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
