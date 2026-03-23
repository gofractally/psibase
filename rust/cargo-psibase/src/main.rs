use anyhow::Error;
use anyhow::{anyhow, Context};
use cargo_metadata::semver::Version;
use cargo_metadata::Message;
use cargo_metadata::{DepKindInfo, DependencyKind, Metadata, NodeDep, PackageId};
use clap::{Parser, Subcommand};
use console::style;
use futures::{
    stream::{pending, FuturesUnordered},
    StreamExt,
};
use psibase::{ExactAccountNumber, PackageInfo};
use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs::{read, write, File};
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::{exit, ExitCode, Stdio};
use std::time::SystemTime;
use std::{env, fs};
use tokio::io::AsyncBufReadExt;
use walrus::{ExportItem, Module};
use wasm_opt::OptimizationOptions;

mod link;
use link::link_module;
mod package;
use package::*;

/// The version of the cargo-psibase crate at compile time
const CARGO_PSIBASE_VERSION: &str = env!("CARGO_PKG_VERSION");

const SERVICE_ARGS: &[&str] = &["--lib"];

const SERVICE_POLYFILL: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/service_wasi_polyfill.wasm"));

const SERVICE_EXPORTS: &[&str] = &["start", "called", "verify", "serve", "recv", "close"];
const TESTER_EXPORTS: &[&str] = &["_start"];

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
    /// Sign transactions with one or more keys.
    /// Each KEY may be a PKCS #11 URI or a path to a PEM/DER-encoded private key file.
    #[clap(short = 's', long, value_name = "KEY")]
    sign: Vec<String>,

    /// Path to Cargo.toml
    #[clap(long, global = true, value_name = "PATH")]
    manifest_path: Option<PathBuf>,

    /// Directory for all generated artifacts
    #[clap(long, global = true, value_name = "DIRECTORY")]
    target_dir: Option<PathBuf>,

    /// Path to psitest executable
    #[clap(long, global = true, value_name = "PATH", default_value_os_t = find_psitest(), env = "CARGO_PSIBASE_PSITEST")]
    psitest: PathBuf,

    /// Path to psibase executable
    #[clap(long, global = true, value_name = "PATH", default_value_os_t = find_psibase(), env = "CARGO_PSIBASE_PSIBASE")]
    psibase: PathBuf,

    /// Build only the specified packages
    #[clap(short = 'p', long, global = true, value_name = "SPEC")]
    package: Vec<String>,

    /// The number of jobs to run in parallel
    #[clap(short = 'j', long, global = true, value_name = "N")]
    jobs: Option<usize>,

    #[clap(subcommand)]
    command: Command,
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
    /// Matches any test containing this string
    #[clap(value_name = "TEST_NAME")]
    test_filter: Option<String>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Build a service
    Build {},

    /// Build a psibase package
    Package {},

    /// Build and run tests
    Test(TestCommand),

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

fn find_psibase() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Ok(exe) = exe.canonicalize() {
            if let Some(parent) = exe.parent() {
                let psibase = format!("psibase{}", std::env::consts::EXE_SUFFIX);
                let sibling = parent.join(&psibase);
                if sibling.is_file() {
                    return sibling;
                }
            }
        }
    }
    "psibase".to_string().into()
}

fn find_psitest() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Ok(exe) = exe.canonicalize() {
            if let Some(parent) = exe.parent() {
                let psitest = format!("psitest{}", std::env::consts::EXE_SUFFIX);
                let sibling = parent.join(&psitest);
                if sibling.is_file() {
                    return sibling;
                }
                if parent.ends_with("rust/release") {
                    let in_build_dir = parent.parent().unwrap().parent().unwrap().join(psitest);
                    if in_build_dir.exists() {
                        return in_build_dir;
                    }
                }
            }
        }
    }
    "psitest".to_string().into()
}

fn strip(code: &mut Module, fns: &[&str]) -> Result<(), Error> {
    let mut ids = Vec::new();
    for exp in code.exports.iter() {
        if !matches!(exp.item, ExportItem::Function(_)) || !fns.contains(&exp.name.as_str()) {
            ids.push(exp.id())
        }
    }
    for id in ids {
        code.exports.delete(id)
    }
    Ok(())
}

fn optimize(code: &mut Module) -> Result<(), Error> {
    let file = tempfile::NamedTempFile::new()?;
    code.emit_wasm_file(file.path())?;

    let debug_build = false;
    OptimizationOptions::new_opt_level_2()
        .shrink_level(wasm_opt::ShrinkLevel::Level1)
        .enable_feature(wasm_opt::Feature::BulkMemory)
        .enable_feature(wasm_opt::Feature::TruncSat)
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

trait MTime {
    fn oldest_mtime(&self) -> Result<SystemTime, Error> {
        self.newest_mtime()
    }
    fn newest_mtime(&self) -> Result<SystemTime, Error>;
    fn is_newer_than<T: MTime>(&self, other: T) -> Result<bool, Error> {
        if let Ok(md2) = other.newest_mtime() {
            if md2 >= self.oldest_mtime()? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

impl MTime for Path {
    fn newest_mtime(&self) -> Result<SystemTime, Error> {
        let md = fs::metadata(self)
            .with_context(|| format!("Failed to get metadata for {}", self.display()))?;
        Ok(md
            .modified()
            .with_context(|| format!("Failed to read mtime for {}", self.display()))?)
    }
}

impl MTime for PathBuf {
    fn newest_mtime(&self) -> Result<SystemTime, Error> {
        self.as_path().newest_mtime()
    }
}

impl<T: MTime + ?Sized> MTime for &T {
    fn newest_mtime(&self) -> Result<SystemTime, Error> {
        (*self).newest_mtime()
    }
}

impl<T0: MTime, T1: MTime> MTime for (T0, T1) {
    fn oldest_mtime(&self) -> Result<SystemTime, Error> {
        Ok(self.0.oldest_mtime()?.min(self.1.oldest_mtime()?))
    }
    fn newest_mtime(&self) -> Result<SystemTime, Error> {
        Ok(self.0.newest_mtime()?.max(self.1.newest_mtime()?))
    }
}

impl<T: MTime, const N: usize> MTime for [T; N] {
    fn oldest_mtime(&self) -> Result<SystemTime, Error> {
        let mut iter = self.iter();
        let mut result = iter.next().unwrap().oldest_mtime()?;
        for x in iter {
            result = result.min(x.oldest_mtime()?)
        }
        Ok(result)
    }
    fn newest_mtime(&self) -> Result<SystemTime, Error> {
        let mut iter = self.iter();
        let mut result = iter.next().unwrap().newest_mtime()?;
        for x in iter {
            result = result.max(x.newest_mtime()?)
        }
        Ok(result)
    }
}

fn process(
    filename: &PathBuf,
    polyfill: Option<&[u8]>,
    exports: &[&str],
    output_file: &Path,
) -> Result<(), Error> {
    let code = &read(filename).with_context(|| format!("Failed to read {}", filename.display()))?;

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

    strip(&mut dest_module, exports)?;

    pretty_path("Reoptimizing", filename);
    optimize(&mut dest_module)?;

    write(output_file, dest_module.emit_wasm())
        .with_context(|| format!("Failed to write {}", filename.display()))?;

    Ok(())
}

#[derive(Debug)]
struct ArtifactFile {
    path: PathBuf,
    package_index: usize,
}

#[derive(Debug, Default)]
struct ArtifactList {
    services: Vec<ArtifactFile>,
    tests: Vec<ArtifactFile>,
    dep_dirs: HashSet<PathBuf>,
}

async fn get_files(
    packages: &[&str],
    mut lines: tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>,
) -> Result<ArtifactList, Error> {
    let mut result = ArtifactList::default();
    while let Some(line) = lines.next_line().await? {
        match serde_json::from_str::<cargo_metadata::Message>(&line)? {
            Message::CompilerMessage(msg) => {
                print!("{}", msg.message.rendered.unwrap());
            }
            Message::CompilerArtifact(artifact) => {
                for p in &artifact.filenames {
                    if p.extension() == Some("rmeta") {
                        if let Some(parent) = p.parent() {
                            result.dep_dirs.insert(parent.as_std_path().to_path_buf());
                        }
                    }
                }
                if let Some(idx) = packages
                    .iter()
                    .position(|id| id == &artifact.package_id.repr.as_str())
                {
                    if artifact.profile.test {
                        if let Some(path) = artifact.executable {
                            result.tests.push(ArtifactFile {
                                path: path.clone().into_std_path_buf(),
                                package_index: idx,
                            })
                        }
                    } else {
                        for p in &artifact.filenames {
                            if p.extension() == Some("rlib") {
                                result.services.push(ArtifactFile {
                                    path: p.clone().into_std_path_buf(),
                                    package_index: idx,
                                })
                            }
                        }
                    }
                }
            }
            _ => (),
        }
    }
    Ok(result)
}

async fn get_wasm_files<F: Fn(&str) -> bool>(
    filter: F,
    mut lines: tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>,
) -> Result<Vec<PathBuf>, Error> {
    let mut result = Vec::new();
    while let Some(line) = lines.next_line().await? {
        match serde_json::from_str::<cargo_metadata::Message>(&line)? {
            Message::CompilerMessage(msg) => {
                print!("{}", msg.message.rendered.unwrap());
            }
            Message::CompilerArtifact(artifact) => {
                if filter(&artifact.package_id.repr) {
                    result.extend(
                        artifact
                            .filenames
                            .iter()
                            .filter(|p| p.extension() == Some("wasm"))
                            .map(|p| p.clone().into_std_path_buf()),
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

type JobAcquiredSender = tokio::sync::oneshot::Sender<std::io::Result<jobserver::Acquired>>;

struct AsyncJobServer {
    helper: jobserver::HelperThread,
    queue: std::sync::mpsc::Sender<JobAcquiredSender>,
}

impl AsyncJobServer {
    unsafe fn new(limit: Option<usize>) -> Result<AsyncJobServer, Error> {
        let client = match jobserver::Client::from_env_ext(false).client {
            Ok(client) => client,
            Err(err) if matches!(err.kind(), jobserver::FromEnvErrorKind::NoEnvVar) => {
                jobserver::Client::new(limit.unwrap_or_else(|| {
                    std::thread::available_parallelism().map_or(1, |n| n.get())
                }))?
            }
            Err(err) => Err(err)?,
        };
        let (sender, receiver) = std::sync::mpsc::channel::<JobAcquiredSender>();
        let helper = client.into_helper_thread(move |aq| {
            if let Ok(send_token) = receiver.recv() {
                let _ = send_token.send(aq);
            }
        })?;
        Ok(AsyncJobServer {
            helper,
            queue: sender,
        })
    }
    async fn acquire(&self) -> Result<jobserver::Acquired, Error> {
        let (send, receive) = tokio::sync::oneshot::channel();
        self.queue.send(send)?;
        self.helper.request_token();
        Ok(receive.await??)
    }
}

async fn wait_for_child(
    mut command: tokio::process::Child,
    packages: &[&str],
) -> Result<ArtifactList, Error> {
    let stdout = tokio::io::BufReader::new(command.stdout.take().unwrap()).lines();
    let stderr = tokio::io::BufReader::new(command.stderr.take().unwrap()).lines();
    let status = command.wait();
    let (status, files, _) =
        tokio::join!(status, get_files(packages, stdout), print_messages(stderr),);

    let status = status?;
    if !status.success() {
        exit(status.code().unwrap());
    }

    files
}

fn write_service_crate(root: &Path) -> Result<PathBuf, Error> {
    let manifest = root.join("Cargo.toml");
    let libsrc = root.join("src/lib.rs");
    let exesrc = root.join("src/main.rs");
    write!(
        &mut File::create(&manifest)?,
        "{}",
        include_str!("service/Cargo.toml")
    )?;
    std::fs::create_dir(root.join("src"))?;
    write!(
        &mut File::create(libsrc)?,
        "{}",
        include_str!("service/src/lib.rs")
    )?;
    write!(
        &mut File::create(exesrc)?,
        "{}",
        include_str!("service/src/main.rs")
    )?;
    Ok(manifest)
}

async fn build_service_impl(
    manifest: &Path,
    target: &str,
    rustc_args: &[OsString],
) -> Result<Vec<PathBuf>, Error> {
    let mut command = tokio::process::Command::new(get_cargo());
    command
        .arg("rustc")
        .arg("--release")
        .arg("--target=wasm32-wasip1")
        .arg("--manifest-path")
        .arg(manifest)
        .arg("--message-format=json-diagnostic-rendered-ansi")
        .arg("--color=always")
        .arg(target)
        .arg("--")
        .args(rustc_args);

    let mut command = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = tokio::io::BufReader::new(command.stdout.take().unwrap()).lines();
    let stderr = tokio::io::BufReader::new(command.stderr.take().unwrap()).lines();
    let status = command.wait();
    let (status, files, _) = tokio::join!(
        status,
        get_wasm_files(|_id| true, stdout),
        print_messages(stderr),
    );

    let status = status?;
    if !status.success() {
        exit(status.code().unwrap());
    }

    files
}

async fn build_service(
    args: &Args,
    lib: &Path,
    output_file: &Path,
    dep_dirs: &HashSet<PathBuf>,
) -> Result<(), Error> {
    let schema_file = output_file.with_extension("schema.json");
    if !lib.is_newer_than((output_file, &schema_file))? {
        return Ok(());
    }
    let tmp_crate = tempfile::tempdir()?;

    let manifest = write_service_crate(tmp_crate.path())?;

    let mut rustc_args = Vec::new();
    rustc_args.push("--extern".into());
    let mut dep = OsString::from("service=");
    dep.push(lib);
    rustc_args.push(dep);
    for dir in dep_dirs {
        rustc_args.push("-L".into());
        let mut libpath = OsString::from("dependency=");
        libpath.push(dir);
        rustc_args.push(libpath);
    }
    let files = build_service_impl(&manifest, "--lib", &rustc_args).await?;
    assert!(files.len() == 1);
    process(
        &files[0],
        Some(SERVICE_POLYFILL),
        SERVICE_EXPORTS,
        &output_file,
    )?;
    let schema_gen = build_service_impl(&manifest, "--bins", &rustc_args).await?;
    assert!(schema_gen.len() == 1);
    process(&schema_gen[0], None, TESTER_EXPORTS, &schema_gen[0])?;

    let status = tokio::process::Command::new(&args.psitest)
        .arg(&schema_gen[0])
        .stdout(File::create(&schema_file)?)
        .status()
        .await?;

    if !status.success() {
        exit(status.code().unwrap());
    }
    Ok(())
}

async fn build(
    args: &Args,
    packages: &[&str],
    envs: Vec<(&str, &str)>,
    extra_args: &[&str],
) -> Result<Vec<ArtifactFile>, Error> {
    let command = tokio::process::Command::new(get_cargo())
        .envs(envs)
        .arg("build")
        .args(extra_args)
        .arg("--release")
        .arg("--target=wasm32-wasip1")
        .args(get_manifest_path(args))
        .args(get_target_dir(args))
        .arg("--message-format=json-diagnostic-rendered-ansi")
        .arg("--color=always")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut files = wait_for_child(command, packages).await?;
    for f in &mut files.services {
        let output_file = f.path.with_extension("wasm");
        build_service(args, &f.path, &output_file, &files.dep_dirs).await?;
        f.path = output_file;
    }

    Ok(files.services)
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
    let (status, files, _) = tokio::join!(
        status,
        get_wasm_files(|id| packages.contains(&id), stdout),
        print_messages(stderr),
    );

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
        .arg("--target=wasm32-wasip1")
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
    jobs: &AsyncJobServer,
    args: &Args,
    opts: &TestCommand,
    metadata: &MetadataIndex<'_>,
) -> Result<(), Error> {
    let mut test_packages: Vec<(&str, PackageSet)> = Vec::new();
    if args.package.is_empty() {
        for id in &*metadata.metadata.workspace_default_members {
            test_packages.push((id.repr.as_str(), get_test_packages(metadata, &id.repr)?));
        }
    } else {
        for package in &args.package {
            let id = &metadata
                .metadata
                .packages
                .iter()
                .find(|p| &p.name == package)
                .ok_or_else(|| anyhow!("Could not find package {}", package))?
                .id;
            test_packages.push((id.repr.as_str(), get_test_packages(metadata, &id.repr)?));
        }
    }

    let target_dir = args.target_dir.as_ref().map_or_else(
        || metadata.metadata.target_directory.as_std_path(),
        |p| p.as_path(),
    );
    let out_dir = target_dir.join("wasm32-wasip1/release/packages");
    let mut built: HashMap<&PackageId, PackageInfo> = HashMap::new();
    let mut test_info = Vec::new();
    pretty("Packages", "building dependencies...");
    for (id, deps) in test_packages {
        let mut index = Vec::new();
        for p in &deps.packages {
            if let Some(found) = built.get(p) {
                index.push(found.clone());
            } else {
                let info = build_package(args, metadata, Some(p.repr.as_str())).await?;
                built.insert(p, info.clone());
                index.push(info);
            }
        }

        // Write a package index specific to the crate
        let index_file =
            out_dir.join(metadata.packages.get(id).unwrap().name.clone() + "-index.json");
        serde_json::to_writer(File::create(&index_file)?, &index)?;
        test_info.push((id, index_file));
    }

    let mut index_files = Vec::new();
    let mut packages = Vec::new();

    let mut command = tokio::process::Command::new(get_cargo());
    command
        .arg("build")
        .arg("--tests")
        .arg("--release")
        .arg("--target=wasm32-wasip1")
        .args(get_manifest_path(args))
        .args(get_target_dir(args))
        .arg("--message-format=json-diagnostic-rendered-ansi")
        .arg("--color=always")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (id, index_file) in test_info {
        pretty("Test", "building unit tests...");
        let name = &metadata.packages.get(id).unwrap().name;

        index_files.push(index_file.canonicalize()?.into_os_string());
        packages.push(id);
        command.args(["-p", name.as_str()]);
    }

    let mut files = wait_for_child(command.spawn()?, &packages).await?;

    for f in &mut files.tests {
        let p = f.path.with_extension("polyfilled.wasm");
        if f.path.is_newer_than(&p)? {
            process(&f.path, None, TESTER_EXPORTS, &p)?;
        }
        f.path = p;
    }

    let mut running = FuturesUnordered::new();

    for test in files.tests {
        let fut = core::pin::pin!(jobs.acquire());
        let mut acquiring = running.by_ref().chain(pending()).take_until(fut);
        while let Some(res) = acquiring.next().await {
            res?
        }
        let acquired = acquiring.take_result().unwrap();
        let index_files = &index_files;
        running.push(async move {
            let _acquired = acquired;
            pretty_path("Running", &test.path);
            let mut command = tokio::process::Command::new(&args.psitest);
            command.env(
                "CARGO_PSIBASE_PACKAGE_PATH",
                &index_files[test.package_index],
            );
            command.arg(test.path);
            command.arg("--nocapture");
            if let Some(ref filter) = opts.test_filter {
                command.arg(filter);
            }
            let msg = format!("Failed running: {:?}", command);
            if !command.status().await.context(msg.clone())?.success() {
                return Err(anyhow! {msg});
            }
            Ok(())
        })
    }

    while let Some(res) = running.next().await {
        res?
    }
    Ok(())
}

async fn install(
    args: &Args,
    opts: &InstallCommand,
    metadata: &MetadataIndex<'_>,
) -> Result<(), Error> {
    let mut packages = PackageSet::new(metadata);
    if args.package.is_empty() {
        for id in &*metadata.metadata.workspace_default_members {
            packages.try_insert(id)?;
        }
    } else {
        for package in &args.package {
            let id = &metadata
                .metadata
                .packages
                .iter()
                .find(|p| &p.name == package)
                .ok_or_else(|| anyhow!("Could not find package {}", package))?
                .id;
            if !packages.try_insert(id)? {
                Err(anyhow!("{} is not a psibase package", package))?
            }
        }
    }
    packages.resolve_dependencies()?;
    let index = packages.build(args).await?;

    let mut command = std::process::Command::new(&args.psibase);

    command.arg("install");
    for key in &args.sign {
        command.args(["--sign", key]);
    }
    if let Some(api) = &opts.api {
        command.args(["--api", api.as_str()]);
    }
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

    let jobs = unsafe { AsyncJobServer::new(args.jobs)? };

    let metadata = get_metadata(&args)?;
    check_psibase_version(&metadata);

    match &args.command {
        Command::Build {} => {
            if args.package.is_empty() {
                let index = MetadataIndex::new(&metadata);
                for id in &*metadata.workspace_default_members {
                    let package = &index.packages.get(id.repr.as_str()).unwrap().name;
                    let mut extra_args = SERVICE_ARGS.to_owned();
                    extra_args.extend(["-p", package.as_str()]);
                    build(&args, &[id.repr.as_str()], vec![], &extra_args).await?;
                }
            } else {
                for package in &args.package {
                    let id = &metadata
                        .packages
                        .iter()
                        .find(|p| &p.name == package)
                        .ok_or_else(|| anyhow!("Could not find package {}", package))?
                        .id
                        .repr;
                    let mut extra_args = SERVICE_ARGS.to_owned();
                    extra_args.extend(["-p", package.as_str()]);
                    build(&args, &[id.as_str()], vec![], &extra_args).await?;
                }
            }
            pretty("Done", "");
        }
        Command::Package {} => {
            let index = MetadataIndex::new(&metadata);
            if args.package.is_empty() {
                for id in &*metadata.workspace_default_members {
                    let package = index.packages.get(id.repr.as_str()).unwrap();
                    if package::get_metadata(package)?.is_package() {
                        build_package(&args, &index, Some(id.repr.as_str())).await?;
                    }
                }
            } else {
                for package in &args.package {
                    let id = &metadata
                        .packages
                        .iter()
                        .find(|p| &p.name == package)
                        .ok_or_else(|| anyhow!("Could not find package {}", package))?
                        .id
                        .repr;
                    build_package(&args, &index, Some(id)).await?;
                }
            }
            pretty("Done", "");
        }
        Command::Test(opts) => {
            test(&jobs, &args, opts, &MetadataIndex::new(&metadata)).await?;
            pretty("Done", "All tests passed");
        }
        Command::Install(opts) => {
            install(&args, opts, &MetadataIndex::new(&metadata)).await?;
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
