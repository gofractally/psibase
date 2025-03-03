use crate::services::{
    accounts, auth_delegate, http_server, packages, producers, psi_brotli::brotli_impl, setcode,
    sites, transact,
};
use crate::{
    new_account_action, reg_server, set_auth_service_action, set_code_action, set_key_action,
    solve_dependencies, version_match, AccountNumber, Action, AnyPublicKey, Checksum256,
    GenesisService, Pack, PackageDisposition, PackageOp, ToSchema, Unpack, Version,
};
use anyhow::{anyhow, Context};
use async_trait::async_trait;
use custom_error::custom_error;
use flate2::write::GzEncoder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{hash_map, HashMap, HashSet};
use std::ffi::OsString;
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use zip::ZipArchive;

#[cfg(not(target_family = "wasm"))]
use crate::ChainUrl;
#[cfg(not(target_family = "wasm"))]
use std::io::Write;
#[cfg(not(target_family = "wasm"))]
use tempfile::tempfile;

custom_error! {
    pub Error
        MissingMeta          = "Service does not contain meta.json",
    InvalidFlags = "Invalid service flags",
    DependencyCycle = "Cycle in service dependencies",
    UnknownFileType{path:String} = "Cannot determine Mime-Type for {path}",
    UnknownAccount{name:AccountNumber} = "Account {name} not defined in meta.json",
    AccountConflict{name: AccountNumber, old: String, new: String} = "The account {name} is defined by more than one package: {old}, {new}",
    MissingDepAccount{name: AccountNumber, package: String} = "The account {name} required by {package} is not defined by any package",
    MissingDepPackage{name: String, dep: String} = "The package {name} uses {dep} but does not depend on it",
    PackageNotFound{package: String} = "The package {package} was not found",
    DuplicatePackage{package: String} = "The package {package} was declared multiple times in the package index",
    PackageDigestFailure{package: String} = "The package file for {package} does not match the package index",
    PackageMetaMismatch{package: String} = "The package metadata for {package} does not match the package index",
    CrossOriginFile{file: String} = "The package file {file} has a different origin from the package index",
}

fn should_compress(content_type: &str) -> bool {
    matches!(
        content_type,
        "text/plain"
            | "text/html"
            | "text/css"
            | "application/javascript"
            | "application/json"
            | "application/xml"
            | "application/rss+xml"
            | "application/atom+xml"
            | "image/svg+xml"
            | "font/ttf"
            | "font/otf"
            | "application/wasm"
    )
}

pub fn compress_content(
    content: &[u8],
    content_type: &str,
    compression_level: u32,
) -> (Vec<u8>, Option<String>) {
    if should_compress(content_type) {
        assert!(
            compression_level >= 1 && compression_level <= 11,
            "Compression level must be between 1 and 11"
        );

        let compressed_content = brotli_impl::compress(content.to_vec(), compression_level as u8);

        (compressed_content, Some("br".to_string()))
    } else {
        (content.to_vec(), None)
    }
}

#[derive(
    Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, Pack, Unpack, ToSchema, Hash,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct PackageRef {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, Pack, Unpack, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Meta {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub depends: Vec<PackageRef>,
    #[serde(default)]
    pub accounts: Vec<AccountNumber>,
}

impl Meta {
    pub fn info(&self, sha256: Checksum256, file: String) -> PackageInfo {
        return PackageInfo {
            name: self.name.clone(),
            version: self.version.clone(),
            description: self.description.clone(),
            depends: self.depends.clone(),
            accounts: self.accounts.clone(),
            sha256,
            file,
        };
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub depends: Vec<PackageRef>,
    #[serde(default)]
    pub accounts: Vec<AccountNumber>,
    #[serde(default)]
    pub sha256: Checksum256,
    #[serde(default)]
    pub file: String,
}

impl PackageInfo {
    fn meta(&self) -> Meta {
        Meta {
            name: self.name.clone(),
            version: self.version.clone(),
            description: self.description.clone(),
            depends: self.depends.clone(),
            accounts: self.accounts.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstalledPackageInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub depends: Vec<PackageRef>,
    pub accounts: Vec<AccountNumber>,
    pub owner: AccountNumber,
}

impl InstalledPackageInfo {
    pub fn meta(&self) -> Meta {
        Meta {
            name: self.name.clone(),
            version: self.version.clone(),
            description: self.description.clone(),
            depends: self.depends.clone(),
            accounts: self.accounts.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct PackageDataFile {
    pub account: AccountNumber,
    pub service: AccountNumber,
    pub filename: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PackageManifest {
    pub services: HashMap<AccountNumber, ServiceInfo>,
    pub data: Vec<PackageDataFile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceInfo {
    pub flags: Vec<String>,
    pub server: Option<AccountNumber>,
}

pub struct PackagedService<R: Read + Seek> {
    archive: zip::read::ZipArchive<R>,
    meta: Meta,
    services: Vec<(AccountNumber, usize, ServiceInfo)>,
    data: Vec<(AccountNumber, usize)>,
}

fn translate_flags(flags: &[String]) -> Result<u64, Error> {
    let mut result = 0;
    for flag in flags {
        result |= match flag.as_str() {
            "allowSudo" => 1 << 0,
            "allowWriteNative" => 1 << 1,
            "isSubjective" => 1 << 2,
            "allowWriteSubjective" => 1 << 3,
            "canNotTimeOut" => 1 << 4,
            "canSetTimeLimit" => 1 << 5,
            "isAuthService" => 1 << 6,
            "forceReplay" => 1 << 7,
            "allowSocket" => 1 << 8,
            "allowNativeSubjective" => 1 << 9,
            _ => Err(Error::InvalidFlags)?,
        };
    }
    Ok(result)
}

fn read<T: Read>(reader: &mut T) -> Result<Vec<u8>, anyhow::Error> {
    let mut result = vec![];
    reader.read_to_end(&mut result)?;
    Ok(result)
}

impl<R: Read + Seek> PackagedService<R> {
    pub fn new(reader: R) -> Result<Self, anyhow::Error> {
        let mut archive = ZipArchive::new(reader)?;
        let mut info_files: HashMap<AccountNumber, usize> = HashMap::new();
        let mut service_files: Vec<(AccountNumber, usize)> = vec![];
        let mut data = vec![];
        let mut meta_index = None;
        let service_re = Regex::new(r"^service/([-a-zA-Z0-9]*)\.(wasm|json)$")?;
        let data_re = Regex::new(r"^data/([-a-zA-Z0-9]*)/.*$")?;
        for index in 0..archive.len() {
            let raw_file = archive.by_index_raw(index)?;
            let filename = raw_file.name();
            if filename == "meta.json" {
                meta_index = Some(index)
            } else if let Some(captures) = service_re.captures(filename) {
                match captures.extract() {
                    (_, [name, "wasm"]) => {
                        service_files.push((AccountNumber::from_str(name)?, index));
                    }
                    (_, [name, "json"]) => {
                        info_files.insert(AccountNumber::from_str(name)?, index);
                    }
                    _ => {}
                }
            } else if let Some(captures) = data_re.captures(filename) {
                if raw_file.is_file() {
                    let (_, [name]) = captures.extract();
                    data.push((AccountNumber::from_str(name)?, index));
                }
            }
        }
        let meta_contents =
            std::io::read_to_string(archive.by_index(meta_index.ok_or(Error::MissingMeta)?)?)?;
        let meta: Meta = serde_json::de::from_str(&meta_contents)?;
        let mut services = vec![];
        for (account, file) in service_files {
            if !meta.accounts.contains(&account) {
                Err(Error::UnknownAccount { name: account })?
            }
            let info = match info_files.get(&account) {
                Some(info_idx) => serde_json::de::from_reader(archive.by_index(*info_idx)?)?,
                None => ServiceInfo {
                    flags: vec![],
                    server: None,
                },
            };
            services.push((account, file, info));
        }
        for (account, _file) in &data[..] {
            if !meta.accounts.contains(&account) {
                Err(Error::UnknownAccount { name: *account })?
            }
        }
        Ok(PackagedService {
            archive: archive,
            meta: meta,
            services: services,
            data: data,
        })
    }
    pub fn name(&self) -> &str {
        &self.meta.name
    }
    pub fn meta(&self) -> &Meta {
        &self.meta
    }
    pub fn get_genesis(&mut self, services: &mut Vec<GenesisService>) -> Result<(), anyhow::Error> {
        for (account, index, info) in &self.services {
            services.push(GenesisService {
                service: *account,
                flags: translate_flags(&info.flags)?,
                vmType: 0,
                vmVersion: 0,
                code: read(&mut self.archive.by_index(*index)?)?.into(),
            })
        }
        Ok(())
    }
    // This does the same work as get_genesis, for services that
    // don't need to be installed in the boot block.
    pub fn install_code(&mut self, actions: &mut Vec<Action>) -> Result<(), anyhow::Error> {
        // service accounts
        for (account, index, info) in &self.services {
            actions.push(set_code_action(
                *account,
                read(&mut self.archive.by_index(*index)?)?.into(),
            ));
            let flags = translate_flags(&info.flags)?;
            if flags != 0 {
                actions.push(setcode::Wrapper::pack().setFlags(*account, flags));
            }
        }
        Ok(())
    }
    pub fn has_service(&self, service: AccountNumber) -> bool {
        for (account, _, _) in &self.services {
            if *account == service {
                return true;
            }
        }
        false
    }
    pub fn store_data(
        &mut self,
        actions: &mut Vec<Action>,
        compression_level: u32,
    ) -> Result<(), anyhow::Error> {
        let data_re = Regex::new(r"^data/[-a-zA-Z0-9]*(/.*)$")?;
        for (sender, index) in &self.data {
            let mut file = self.archive.by_index(*index)?;
            let file_name = file.name().to_string();
            let path = data_re
                .captures(&file_name)
                .unwrap()
                .get(1)
                .unwrap()
                .as_str();

            if let Some(t) = mime_guess::from_path(path).first() {
                let content = read(&mut file)?;
                let (content, content_encoding) =
                    compress_content(&content, t.essence_str(), compression_level);

                actions.push(
                    sites::Wrapper::pack_from_to(*sender, sites::SERVICE).storeSys(
                        path.to_string(),
                        t.essence_str().to_string(),
                        content_encoding,
                        content.into(),
                    ),
                );
            } else {
                Err(Error::UnknownFileType {
                    path: file.name().to_string(),
                })?
            }
        }
        Ok(())
    }
    pub fn reg_server(&mut self, actions: &mut Vec<Action>) -> Result<(), anyhow::Error> {
        for (account, _, info) in &self.services {
            if let Some(server) = &info.server {
                actions.push(http_server::Wrapper::pack_from(*account).registerServer(*server))
            }
        }
        Ok(())
    }
    pub fn get_accounts(&self) -> &[AccountNumber] {
        &self.meta.accounts
    }
    pub fn postinstall(&mut self, actions: &mut Vec<Action>) -> Result<(), anyhow::Error> {
        if let Ok(file) = self.archive.by_name("script/postinstall.json") {
            actions.append(&mut serde_json::de::from_str(&std::io::read_to_string(
                file,
            )?)?);
        }
        Ok(())
    }

    fn manifest_services(&self) -> HashMap<AccountNumber, ServiceInfo> {
        let mut result = HashMap::new();
        for (service, _, info) in &self.services {
            result.insert(*service, info.clone());
        }
        result
    }

    fn manifest_data(&mut self) -> Vec<PackageDataFile> {
        let mut manifest = vec![];
        let data_re = Regex::new(r"^data/[-a-zA-Z0-9]*(/.*)$").unwrap();
        for (sender, index) in &self.data {
            let service = if self.has_service(*sender) {
                *sender
            } else {
                sites::SERVICE
            };
            let file = self.archive.by_index(*index).unwrap();
            let path = data_re
                .captures(file.name())
                .unwrap()
                .get(1)
                .unwrap()
                .as_str();
            manifest.push(PackageDataFile {
                account: *sender,
                service,
                filename: path.to_string(),
            });
        }
        manifest
    }

    pub fn manifest(&mut self) -> PackageManifest {
        let services = self.manifest_services();
        let data = self.manifest_data();
        PackageManifest { services, data }
    }

    pub fn commit_install(
        &mut self,
        sender: AccountNumber,
        actions: &mut Vec<Action>,
    ) -> Result<(), anyhow::Error> {
        let manifest = self.manifest();
        let mut manifest_encoder = GzEncoder::new(Vec::new(), flate2::Compression::default());
        serde_json::to_writer(&mut manifest_encoder, &manifest)?;
        actions.push(
            packages::Wrapper::pack_from(sender)
                .postinstall(self.meta.clone(), manifest_encoder.finish()?.into()),
        );
        Ok(())
    }

    pub fn create_account(
        &self,
        account: AccountNumber,
        key: &Option<AnyPublicKey>,
        sender: AccountNumber,
        actions: &mut Vec<Action>,
    ) -> Result<(), anyhow::Error> {
        actions.push(new_account_action(accounts::SERVICE, account));
        if let Some(key) = key {
            actions.push(set_key_action(account, key));
            actions.push(set_auth_service_action(account, key.auth_service()));
        } else {
            actions.push(auth_delegate::Wrapper::pack_from(account).setOwner(sender));
            actions.push(set_auth_service_action(account, auth_delegate::SERVICE));
        }
        Ok(())
    }

    pub fn install_accounts(
        &mut self,
        actions: &mut Vec<Vec<Action>>,
        sender: AccountNumber,
        key: &Option<AnyPublicKey>,
    ) -> Result<(), anyhow::Error> {
        // service accounts
        for (account, index, info) in &self.services {
            let mut group = vec![];
            self.create_account(*account, key, sender, &mut group)?;
            group.push(set_code_action(
                *account,
                read(&mut self.archive.by_index(*index)?)?.into(),
            ));
            let flags = translate_flags(&info.flags)?;
            if flags != 0 {
                group.push(setcode::Wrapper::pack().setFlags(*account, flags));
            }
            actions.push(group);
        }
        // extra accounts
        for account in self.get_accounts() {
            if !self.has_service(*account) {
                let mut group = vec![];
                self.create_account(*account, key, sender, &mut group)?;
                actions.push(group);
            }
        }
        Ok(())
    }

    // TODO: handle recovery from partial install
    pub fn install(
        &mut self,
        actions: &mut Vec<Action>,
        sender: AccountNumber,
        install_ui: bool,
        compression_level: u32,
    ) -> Result<(), anyhow::Error> {
        if install_ui {
            self.reg_server(actions)?;
            self.store_data(actions, compression_level)?;
        }

        self.postinstall(actions)?;
        self.commit_install(sender, actions)?;
        Ok(())
    }

    // Returns accounts that must be defined by either this package or its
    // immediate dependencies
    pub fn get_required_accounts(&mut self) -> Result<Vec<AccountNumber>, anyhow::Error> {
        let mut result = vec![];

        for account in self.get_accounts() {
            if !self.has_service(*account) {
                result.push(accounts::SERVICE)
            }
        }

        if !self.data.is_empty() {
            result.push(sites::SERVICE);
        }

        for (_, _, info) in &self.services {
            if let Some(_) = &info.server {
                result.push(http_server::SERVICE)
            }
        }

        if let Ok(file) = self.archive.by_name("script/postinstall.json") {
            let actions: Vec<Action> = serde_json::de::from_str(&std::io::read_to_string(file)?)?;
            for act in actions {
                result.push(act.sender);
                result.push(act.service);
            }
        }

        result.sort_unstable_by(|a, b| a.value.cmp(&b.value));
        result.dedup();

        Ok(result)
    }
}

pub trait ActionGroup {
    fn append_to_tx(self, trx_actions: &mut Vec<Action>, size: &mut usize);
}

impl ActionGroup for Action {
    fn append_to_tx(self, trx_actions: &mut Vec<Action>, size: &mut usize) {
        *size += self.rawData.len();
        trx_actions.push(self);
    }
}

impl ActionGroup for Vec<Action> {
    fn append_to_tx(self, trx_actions: &mut Vec<Action>, size: &mut usize) {
        for act in self {
            act.append_to_tx(trx_actions, size);
        }
    }
}

pub trait ActionSink {
    fn push_action<T: ActionGroup>(&mut self, act: T) -> Result<(), anyhow::Error>;
}

impl ActionSink for Vec<Action> {
    fn push_action<T: ActionGroup>(&mut self, act: T) -> Result<(), anyhow::Error> {
        let mut size = 0;
        act.append_to_tx(self, &mut size);
        Ok(())
    }
}

impl PackageManifest {
    // This removes every part of self that is not overwritten by other
    pub fn upgrade<T: ActionSink>(
        &self,
        other: PackageManifest,
        out: &mut T,
    ) -> Result<(), anyhow::Error> {
        let new_files: HashSet<_> = other.data.into_iter().collect();
        for file in &self.data {
            if !new_files.contains(file) {
                out.push_action(
                    sites::Wrapper::pack_from_to(file.account, file.service)
                        .remove(file.filename.clone()),
                )?;
            }
        }
        for (service, info) in &self.services {
            let other_info = other.services.get(service);
            if info.server.is_some() && other_info.map_or(true, |i| i.server.is_none()) {
                out.push_action(reg_server(*service, sites::SERVICE))?;
            }
            if !info.flags.is_empty() && other_info.map_or(true, |i| i.flags.is_empty()) {
                out.push_action(setcode::Wrapper::pack().setFlags(*service, 0))?;
            }
            if other_info.is_none() {
                out.push_action(set_code_action(*service, vec![]))?;
            }
        }
        Ok(())
    }
    pub fn remove<T: ActionSink>(&self, out: &mut T) -> Result<(), anyhow::Error> {
        for file in &self.data {
            out.push_action(
                sites::Wrapper::pack_from_to(file.account, file.service)
                    .remove(file.filename.clone()),
            )?;
        }
        for (service, info) in &self.services {
            if info.server.is_some() {
                out.push_action(reg_server(*service, sites::SERVICE))?;
            }
            if !info.flags.is_empty() {
                out.push_action(setcode::Wrapper::pack().setFlags(*service, 0))?;
            }
            out.push_action(set_code_action(*service, vec![]))?;
        }
        Ok(())
    }
}

// Two packages shall not create the same account
// Accounts used in any way during installation must be part of the package or
// its direct dependencies
pub fn validate_dependencies<T: Read + Seek>(
    packages: &mut [PackagedService<T>],
) -> Result<(), anyhow::Error> {
    let mut accounts: HashMap<AccountNumber, String> = HashMap::new();
    for p in &packages[..] {
        for account in p.get_accounts() {
            match accounts.entry(*account) {
                hash_map::Entry::Occupied(entry) => Err(Error::AccountConflict {
                    name: *account,
                    old: entry.get().to_string(),
                    new: p.meta.name.clone(),
                })?,
                hash_map::Entry::Vacant(entry) => entry.insert(p.meta.name.clone()),
            };
        }
    }
    for p in &mut packages[..] {
        for account in p.get_required_accounts()? {
            if let Some(package) = accounts.get(&account) {
                if &p.meta.name != package && !p.meta.depends.iter().any(|dep| &dep.name == package)
                {
                    Err(Error::MissingDepPackage {
                        name: p.meta.name.clone(),
                        dep: package.clone(),
                    })?;
                }
            } else {
                Err(Error::MissingDepAccount {
                    name: account,
                    package: p.meta.name.clone(),
                })?
            }
        }
    }
    Ok(())
}

pub fn make_refs(packages: &[String]) -> Result<Vec<PackageRef>, anyhow::Error> {
    let re = Regex::new(r"^(.*?)(?:-(\d+\.\d+\.\d+(?:-[0-9a-zA-Z-.]+)?(?:\+[0-9a-zA-Z-.]+)?))?$")?;
    let mut refs = vec![];
    for package in packages {
        if let Some(captures) = re.captures(package) {
            let name = captures.get(1).unwrap().as_str();
            let version = captures
                .get(2)
                .map_or("*".to_string(), |m| "=".to_string() + m.as_str());
            refs.push(PackageRef {
                name: name.to_string(),
                version: version,
            });
        }
    }
    Ok(refs)
}

// services that should be installed first
pub struct EssentialServices {
    remaining: Vec<AccountNumber>,
}

impl EssentialServices {
    pub fn new() -> Self {
        Self {
            remaining: vec![transact::SERVICE, producers::SERVICE, setcode::SERVICE],
        }
    }
    pub fn remove(&mut self, accounts: &[AccountNumber]) {
        for account in accounts {
            if let Some(idx) = self.remaining.iter().position(|a| a == account) {
                self.remaining.swap_remove(idx);
            }
        }
    }
    pub fn is_empty(&self) -> bool {
        self.remaining.is_empty()
    }
    pub fn intersects(&self, accounts: &[AccountNumber]) -> bool {
        for account in accounts {
            if self.remaining.iter().find(|a| *a == account).is_some() {
                return true;
            }
        }
        return false;
    }
}

pub fn get_essential_packages(
    packages: &Vec<PackageInfo>,
    essential_services: &EssentialServices,
) -> Vec<String> {
    let mut result = Vec::new();
    for info in packages {
        if essential_services.intersects(&info.accounts) {
            result.push(info.name.clone());
        }
    }
    result
}

#[async_trait(?Send)]
pub trait PackageRegistry {
    type R: Read + Seek;
    fn index(&self) -> Result<Vec<PackageInfo>, anyhow::Error>;
    async fn get_by_info(
        &self,
        info: &PackageInfo,
    ) -> Result<PackagedService<Self::R>, anyhow::Error>;
    // Returns a set of packages and all dependencies
    // The result is ordered by dependency so that if A depends on B, then B appears before A.
    async fn resolve(
        &self,
        packages: &[String],
    ) -> Result<Vec<PackagedService<Self::R>>, anyhow::Error> {
        let mut result = vec![];
        let index = self.index()?;
        let essential = get_essential_packages(&index, &EssentialServices::new());
        for op in solve_dependencies(index, make_refs(packages)?, vec![], essential, false)? {
            let PackageOp::Install(info) = op else {
                panic!("Only install is expected when there are no existing packages");
            };
            result.push(self.get_by_info(&info).await?);
        }

        Ok(result)
    }
}

pub struct DirectoryRegistry {
    dir: PathBuf,
    index: PathBuf,
}

impl DirectoryRegistry {
    pub fn new(path: PathBuf) -> Self {
        if path.is_dir() {
            let index = path.join("index.json");
            DirectoryRegistry { dir: path, index }
        } else {
            let dir = path.parent().unwrap().to_path_buf();
            DirectoryRegistry { dir, index: path }
        }
    }
}

#[async_trait(?Send)]
impl PackageRegistry for DirectoryRegistry {
    type R = BufReader<File>;
    fn index(&self) -> Result<Vec<PackageInfo>, anyhow::Error> {
        let f = File::open(&self.index)
            .with_context(|| format!("Cannot open {}", self.index.to_string_lossy()))?;
        let contents = std::io::read_to_string(f)?;
        let result: Vec<PackageInfo> = serde_json::de::from_str(&contents)?;
        Ok(result)
    }
    async fn get_by_info(
        &self,
        info: &PackageInfo,
    ) -> Result<PackagedService<Self::R>, anyhow::Error> {
        let path = self.dir.join(&info.file);
        let f =
            File::open(&path).with_context(|| format!("Cannot open {}", path.to_string_lossy()))?;
        PackagedService::new(BufReader::new(f))
    }
}

// A virtual registry that contains packages from a set of files
pub struct FileSetRegistry {
    info: Vec<PackageInfo>,
    by_hash: HashMap<Checksum256, PathBuf>,
}

impl FileSetRegistry {
    // Splits string that are paths to existing files from ones that are package names
    pub fn from_files(
        packages: &[OsString],
    ) -> Result<(FileSetRegistry, Vec<String>), anyhow::Error> {
        let mut not_files = Vec::new();
        let mut result = FileSetRegistry {
            info: Vec::new(),
            by_hash: HashMap::new(),
        };
        for package in packages {
            let path: &Path = package.as_ref();
            if path.exists() {
                let mut f =
                    File::open(path).with_context(|| format!("Cannot open {}", path.display()))?;
                let mut hasher = Sha256::new();
                std::io::copy(&mut f, &mut hasher)?;
                let hash: [u8; 32] = hasher.finalize().into();
                f.rewind()?;
                let mut archive = ZipArchive::new(f)?;

                let meta_contents = std::io::read_to_string(archive.by_name("meta.json")?)?;
                let meta: Meta = serde_json::de::from_str(&meta_contents)?;
                let sha256 = Checksum256::from(hash);
                not_files.push(format!("{}-{}", meta.name, meta.version));
                if result
                    .by_hash
                    .insert(sha256.clone(), PathBuf::from(path))
                    .is_none()
                {
                    result
                        .info
                        .push(meta.info(sha256, path.display().to_string()));
                }
            } else {
                not_files.push(
                    path.to_str()
                        .ok_or_else(|| anyhow!("{} is not valid UTF8", path.display()))?
                        .to_string(),
                );
            }
        }
        Ok((result, not_files))
    }
}

#[async_trait(?Send)]
impl PackageRegistry for FileSetRegistry {
    type R = BufReader<File>;
    fn index(&self) -> Result<Vec<PackageInfo>, anyhow::Error> {
        Ok(self.info.clone())
    }
    async fn get_by_info(
        &self,
        info: &PackageInfo,
    ) -> Result<PackagedService<Self::R>, anyhow::Error> {
        let path = self.by_hash.get(&info.sha256).unwrap();
        let f = File::open(&path).with_context(|| format!("Cannot open {}", info.file))?;
        PackagedService::new(BufReader::new(f))
    }
}

#[cfg(not(target_family = "wasm"))]
pub struct HTTPRegistry {
    index_url: reqwest::Url,
    client: reqwest::Client,
    index: HashMap<String, PackageInfo>,
}

#[cfg(not(target_family = "wasm"))]
impl HTTPRegistry {
    pub async fn new(
        url: reqwest::Url,
        client: reqwest::Client,
    ) -> Result<HTTPRegistry, anyhow::Error> {
        let mut index_url = url.clone();
        index_url
            .path_segments_mut()
            .unwrap()
            .pop_if_empty()
            .push("index.json");
        let mut index = HashMap::new();
        for package in crate::as_json::<Vec<PackageInfo>>(client.get(index_url.clone())).await? {
            if let Some(prev) = index.insert(package.name.clone(), package) {
                Err(Error::DuplicatePackage { package: prev.name })?
            }
        }
        Ok(HTTPRegistry {
            index_url,
            client,
            index,
        })
    }
    async fn download(&self, filename: &str) -> Result<(File, Checksum256), anyhow::Error> {
        let url = self.index_url.join(filename)?;
        if url.origin() != self.index_url.origin() {
            Err(Error::CrossOriginFile {
                file: filename.to_string(),
            })?;
        }
        let mut response = self.client.get(url).send().await?.error_for_status()?;
        let mut hasher = Sha256::new();
        let mut f = tempfile()?;
        while let Some(chunk) = response.chunk().await? {
            f.write_all(&chunk)?;
            hasher.update(&chunk);
        }
        let hash: [u8; 32] = hasher.finalize().into();
        f.rewind()?;
        Ok((f, Checksum256::from(hash)))
    }
}

#[cfg(not(target_family = "wasm"))]
#[async_trait(?Send)]
impl PackageRegistry for HTTPRegistry {
    type R = BufReader<File>;
    fn index(&self) -> Result<Vec<PackageInfo>, anyhow::Error> {
        let mut result = Vec::new();
        for (_k, v) in &self.index {
            result.push(v.clone());
        }
        Ok(result)
    }
    async fn get_by_info(
        &self,
        info: &PackageInfo,
    ) -> Result<PackagedService<Self::R>, anyhow::Error> {
        let (f, hash) = self.download(&info.file).await?;
        if hash != info.sha256 {
            Err(Error::PackageDigestFailure {
                package: info.name.clone(),
            })?
        }
        let result = PackagedService::new(BufReader::new(f))?;
        if result.meta != info.meta() {
            Err(Error::PackageMetaMismatch {
                package: info.name.clone(),
            })?
        }
        Ok(result)
    }
}

pub struct JointRegistry<T: Read + Seek> {
    sources: Vec<(PackageList, Box<dyn PackageRegistry<R = T>>)>,
}

impl<T: Read + Seek> JointRegistry<T> {
    pub fn new() -> Self {
        Self { sources: vec![] }
    }
    pub fn push<U: PackageRegistry<R = T> + 'static>(
        &mut self,
        source: U,
    ) -> Result<(), anyhow::Error> {
        let list = PackageList::from_registry(&source)?;
        self.sources.push((list, Box::new(source)));
        Ok(())
    }
}

#[async_trait(?Send)]
impl<T: Read + Seek> PackageRegistry for JointRegistry<T> {
    type R = T;
    fn index(&self) -> Result<Vec<PackageInfo>, anyhow::Error> {
        let mut result = Vec::new();
        let mut found = PackageList::new();
        for (_, reg) in &self.sources {
            for entry in reg.index()? {
                if !found.contains_version(&entry.name, &entry.version) {
                    found.insert_info(entry.clone());
                    result.push(entry);
                }
            }
        }
        Ok(result)
    }
    async fn get_by_info(
        &self,
        info: &PackageInfo,
    ) -> Result<PackagedService<Self::R>, anyhow::Error> {
        for (list, reg) in &self.sources {
            if list.contains_version(&info.name, &info.version) {
                return reg.get_by_info(info).await;
            }
        }
        Err(Error::PackageNotFound {
            package: info.name.to_string() + "-" + &info.version,
        })?
    }
}

pub enum PackageOrigin {
    Installed { owner: AccountNumber },
    Repo { sha256: Checksum256, file: String },
}

pub struct PackageList {
    packages: HashMap<String, HashMap<String, (Meta, PackageOrigin)>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledEdge {
    node: InstalledPackageInfo,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct NextPageInfo {
    hasNextPage: bool,
    endCursor: String,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledConnection {
    pageInfo: NextPageInfo,
    edges: Vec<InstalledEdge>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledQuery {
    installed: InstalledConnection,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct NewAccountsQuery {
    newAccounts: Vec<AccountNumber>,
}

#[cfg(not(target_family = "wasm"))]
pub async fn get_accounts_to_create(
    base_url: &reqwest::Url,
    client: &mut reqwest::Client,
    accounts: &[AccountNumber],
    sender: AccountNumber,
) -> Result<Vec<AccountNumber>, anyhow::Error> {
    let result: NewAccountsQuery = crate::gql_query(
        base_url,
        client,
        packages::SERVICE,
        format!(
            "query {{ newAccounts(accounts: {}, owner: {}) }}",
            serde_json::to_string(accounts)?,
            serde_json::to_string(&sender)?,
        ),
    )
    .await?;
    Ok(result.newAccounts)
}

#[cfg(not(target_family = "wasm"))]
pub async fn get_installed_manifest(
    base_url: &reqwest::Url,
    client: &mut reqwest::Client,
    package: &str,
    owner: AccountNumber,
) -> Result<PackageManifest, anyhow::Error> {
    let url = packages::SERVICE
        .url(base_url)?
        .join(&format!("/manifest?package={}&owner={}", package, owner))?;
    crate::as_json(client.get(url)).await
}

#[cfg(not(target_family = "wasm"))]
pub async fn get_manifest<T: PackageRegistry + ?Sized>(
    reg: &T,
    base_url: &reqwest::Url,
    client: &mut reqwest::Client,
    package: &Meta,
    origin: &PackageOrigin,
) -> Result<PackageManifest, anyhow::Error> {
    match origin {
        PackageOrigin::Installed { owner } => {
            get_installed_manifest(base_url, client, &package.name, *owner).await
        }
        PackageOrigin::Repo { sha256, file } => {
            let mut package = reg
                .get_by_info(&package.info(sha256.clone(), file.clone()))
                .await?;
            Ok(package.manifest())
        }
    }
}

impl PackageList {
    pub fn new() -> PackageList {
        PackageList {
            packages: HashMap::new(),
        }
    }
    #[cfg(not(target_family = "wasm"))]
    pub async fn installed(
        base_url: &reqwest::Url,
        client: &mut reqwest::Client,
    ) -> Result<Self, anyhow::Error> {
        let mut end_cursor: Option<String> = None;
        let mut result = PackageList::new();
        loop {
            let data = crate::gql_query::<InstalledQuery>(base_url, client, packages::SERVICE,
                                        format!("query {{ installed(first: 100, after: {}) {{ pageInfo {{ hasNextPage endCursor }} edges {{ node {{ name version description depends {{ name version }}  accounts owner }} }} }} }}", serde_json::to_string(&end_cursor)?))
                .await.with_context(|| "Failed to list installed packages")?;
            for edge in data.installed.edges {
                result.insert_installed(edge.node);
            }
            if !data.installed.pageInfo.hasNextPage {
                break;
            }
            end_cursor = Some(data.installed.pageInfo.endCursor);
        }
        Ok(result)
    }
    pub fn from_registry<T: PackageRegistry + ?Sized>(reg: &T) -> Result<Self, anyhow::Error> {
        let mut result = PackageList::new();
        for package in reg.index()? {
            result.insert_info(package);
        }
        Ok(result)
    }
    pub fn insert(&mut self, meta: Meta, origin: PackageOrigin) {
        let name = meta.name.clone();
        let version = meta.version.clone();
        self.packages
            .entry(name)
            .or_insert(HashMap::new())
            .insert(version, (meta, origin));
    }
    pub fn insert_info(&mut self, info: PackageInfo) {
        self.insert(
            info.meta(),
            PackageOrigin::Repo {
                sha256: info.sha256.clone(),
                file: info.file.clone(),
            },
        );
    }
    pub fn insert_installed(&mut self, info: InstalledPackageInfo) {
        self.insert(info.meta(), PackageOrigin::Installed { owner: info.owner });
    }

    fn contains_version(&self, name: &str, version: &str) -> bool {
        if let Some(packages) = self.packages.get(name) {
            return packages.contains_key(version);
        }
        return false;
    }
    fn as_upgradable(&self) -> Vec<(Meta, PackageDisposition)> {
        let mut result = vec![];
        for (_, versions) in &self.packages {
            for (version, (meta, _)) in versions {
                result.push((meta.clone(), PackageDisposition::upgradable(version)));
            }
        }
        result
    }
    pub async fn resolve_changes<T: PackageRegistry + ?Sized>(
        &self,
        reg: &T,
        packages: &[String],
        reinstall: bool,
    ) -> Result<Vec<PackageOp>, anyhow::Error> {
        let index = reg.index()?;
        let essential = get_essential_packages(&index, &EssentialServices::new());
        solve_dependencies(
            index,
            make_refs(packages)?,
            self.as_upgradable(),
            essential,
            reinstall,
        )
    }
    pub fn into_info(self) -> Vec<(Meta, PackageOrigin)> {
        let mut result = vec![];
        for (_, versions) in self.packages {
            for (_, item) in versions {
                result.push(item);
            }
        }
        result.sort_unstable_by(|lhs, rhs| {
            (&lhs.0.name, &lhs.0.version).cmp(&(&rhs.0.name, &rhs.0.version))
        });
        result
    }
    pub fn get_by_name(
        &self,
        packages: &str,
    ) -> Result<Option<&(Meta, PackageOrigin)>, anyhow::Error> {
        for package in make_refs(&[packages.to_string()])? {
            if let Some(versions) = self.packages.get(&package.name) {
                let mut found: Option<&(Meta, PackageOrigin)> = None;
                for (version, item) in versions {
                    if version_match(&package.version, version)? {
                        if found.map_or(Ok::<bool, anyhow::Error>(true), |prev| {
                            Ok(Version::new(&prev.0.version)? < Version::new(version)?)
                        })? {
                            found = Some(item)
                        }
                    }
                }
                return Ok(found);
            }
        }
        Ok(None)
    }
    pub fn into_vec(mut self) -> Vec<String> {
        let mut result: Vec<String> = self.packages.drain().map(|(k, _)| k).collect();
        result.sort_unstable();
        result
    }
    pub fn union(mut self, mut other: Self) -> Self {
        for (name, versions) in other.packages.drain() {
            self.packages.insert(name, versions);
        }
        self
    }
    pub fn difference(mut self, other: Self) -> Self {
        for package in other.packages.keys() {
            self.packages.remove(package);
        }
        self
    }
}
