use crate::services::{account_sys, package_sys, proxy_sys, psispace_sys, setcode_sys};
use crate::{
    new_account_action, set_auth_service_action, set_code_action, set_key_action, AccountNumber,
    Action, AnyPublicKey, Checksum256, GenesisService,
};
use custom_error::custom_error;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{hash_map, HashMap, HashSet};
use std::io::{Read, Seek};
use std::str::FromStr;
use zip::ZipArchive;

use async_recursion::async_recursion;
use async_trait::async_trait;
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;

#[cfg(not(target_family = "wasm"))]
use sha2::{Digest, Sha256};
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
    NoDomain = "Virtual hosting requires a URL with a domain name",
    PackageNotFound{package: String} = "The package {package} was not found",
    DuplicatePackage{package: String} = "The package {package} was declared multiple times in the package index",
    PackageDigestFailure{package: String} = "The package file for {package} does not match the package index",
    PackageMetaMismatch{package: String} = "The package metadata for {package} does not match the package index",
    CrossOriginFile{file: String} = "The package file {file} has a different origin from the package index",
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
struct Meta {
    name: String,
    description: String,
    depends: Vec<String>,
    accounts: Vec<AccountNumber>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PackageInfo {
    pub name: String,
    pub description: String,
    pub depends: Vec<String>,
    pub accounts: Vec<AccountNumber>,
    pub sha256: Checksum256,
    pub file: String,
}

#[cfg(not(target_family = "wasm"))]
impl PackageInfo {
    fn meta(&self) -> Meta {
        Meta {
            name: self.name.clone(),
            description: self.description.clone(),
            depends: self.depends.clone(),
            accounts: self.accounts.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ServiceInfo {
    flags: Vec<String>,
    server: Option<AccountNumber>,
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
    pub fn has_service(&self, service: AccountNumber) -> bool {
        for (account, _, _) in &self.services {
            if *account == service {
                return true;
            }
        }
        false
    }
    pub fn store_data(&mut self, actions: &mut Vec<Action>) -> Result<(), anyhow::Error> {
        let data_re = Regex::new(r"^data/[-a-zA-Z0-9]*(/.*)$")?;
        for (sender, index) in &self.data {
            let service = if self.has_service(*sender) {
                *sender
            } else {
                psispace_sys::SERVICE
            };
            let mut file = self.archive.by_index(*index)?;
            let path = data_re
                .captures(file.name())
                .unwrap()
                .get(1)
                .unwrap()
                .as_str();
            if let Some(t) = mime_guess::from_path(path).first() {
                actions.push(
                    psispace_sys::Wrapper::pack_from_to(*sender, service).storeSys(
                        path.to_string(),
                        t.essence_str().to_string(),
                        read(&mut file)?.into(),
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
                actions.push(proxy_sys::Wrapper::pack_from(*account).registerServer(*server))
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

    pub fn commit_install(&mut self, actions: &mut Vec<Action>) -> Result<(), anyhow::Error> {
        actions.push(
            package_sys::Wrapper::pack().postinstall(package_sys::InstalledPackage {
                name: self.meta.name.clone(),
                depends: self.meta.depends.clone(),
                accounts: self.meta.accounts.clone(),
            }),
        );
        Ok(())
    }

    pub fn create_account(
        &self,
        account: AccountNumber,
        key: &Option<AnyPublicKey>,
        actions: &mut Vec<Action>,
    ) -> Result<(), anyhow::Error> {
        actions.push(new_account_action(account_sys::SERVICE, account));
        if let Some(key) = key {
            actions.push(set_key_action(account, key));
            actions.push(set_auth_service_action(account, key.auth_service()));
        }
        Ok(())
    }

    pub fn install_accounts(
        &mut self,
        actions: &mut Vec<Vec<Action>>,
        key: &Option<AnyPublicKey>,
    ) -> Result<(), anyhow::Error> {
        // service accounts
        for (account, index, info) in &self.services {
            let mut group = vec![];
            self.create_account(*account, key, &mut group)?;
            group.push(set_code_action(
                *account,
                read(&mut self.archive.by_index(*index)?)?.into(),
            ));
            let flags = translate_flags(&info.flags)?;
            if flags != 0 {
                group.push(setcode_sys::Wrapper::pack().setFlags(*account, flags));
            }
            actions.push(group);
        }
        // extra accounts
        for account in self.get_accounts() {
            if !self.has_service(*account) {
                let mut group = vec![];
                self.create_account(*account, key, &mut group)?;
                actions.push(group);
            }
        }
        Ok(())
    }

    // TODO: handle recovery from partial install
    pub fn install(
        &mut self,
        actions: &mut Vec<Action>,
        install_ui: bool,
    ) -> Result<(), anyhow::Error> {
        if install_ui {
            self.reg_server(actions)?;
            self.store_data(actions)?;
        }

        self.postinstall(actions)?;
        self.commit_install(actions)?;
        Ok(())
    }

    // Returns accounts that must be defined by either this package or its
    // immediate dependencies
    pub fn get_required_accounts(&mut self) -> Result<Vec<AccountNumber>, anyhow::Error> {
        let mut result = vec![];

        for account in self.get_accounts() {
            if !self.has_service(*account) {
                result.push(account_sys::SERVICE)
            }
        }

        for (_, _, info) in &self.services {
            if let Some(_) = &info.server {
                result.push(proxy_sys::SERVICE)
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
                if &p.meta.name != package && !p.meta.depends.contains(package) {
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

#[async_recursion(?Send)]
async fn dfs<T: PackageRegistry + ?Sized>(
    reg: &T,
    names: &[String],
    found: &mut HashMap<String, bool>,
    result: &mut Vec<PackagedService<<T as PackageRegistry>::R>>,
) -> Result<(), anyhow::Error> {
    for name in names {
        if let Some(completed) = found.get(name) {
            if !completed {
                Err(Error::DependencyCycle)?
            }
        } else {
            found.insert(name.clone(), false);
            let package = reg.get(name.as_str()).await?;
            dfs(reg, &package.meta.depends, found, result).await?;
            result.push(package);
            *found.get_mut(name).unwrap() = true;
        }
    }
    Ok(())
}

#[async_trait(?Send)]
pub trait PackageRegistry {
    type R: Read + Seek;
    fn index(&self) -> Result<Vec<PackageInfo>, anyhow::Error>;
    async fn get(&self, name: &str) -> Result<PackagedService<Self::R>, anyhow::Error>;
    // Returns a set of packages and all dependencies
    // The result is ordered by dependency so that if A depends on B, then B appears before A.
    async fn resolve(
        &self,
        packages: &[String],
    ) -> Result<Vec<PackagedService<Self::R>>, anyhow::Error> {
        let mut result = vec![];
        dfs(self, packages, &mut HashMap::new(), &mut result).await?;
        Ok(result)
    }
}

pub struct DirectoryRegistry {
    dir: PathBuf,
}

impl DirectoryRegistry {
    pub fn new(dir: PathBuf) -> Self {
        DirectoryRegistry { dir }
    }
}

#[async_trait(?Send)]
impl PackageRegistry for DirectoryRegistry {
    type R = BufReader<File>;
    fn index(&self) -> Result<Vec<PackageInfo>, anyhow::Error> {
        let f = File::open(self.dir.join("index.json"))?;
        let contents = std::io::read_to_string(f)?;
        let result: Vec<PackageInfo> = serde_json::de::from_str(&contents)?;
        Ok(result)
    }
    async fn get(&self, name: &str) -> Result<PackagedService<Self::R>, anyhow::Error> {
        let f = File::open(self.dir.join(name.to_string() + ".psi"))?;
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
    async fn get(&self, name: &str) -> Result<PackagedService<Self::R>, anyhow::Error> {
        let Some(info) = self.index.get(name) else {
            Err(Error::PackageNotFound {
                package: name.to_string(),
            })?
        };
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
        let mut found = HashSet::new();
        for (_, reg) in &self.sources {
            for entry in reg.index()? {
                if !found.contains(&entry.name) {
                    found.insert(entry.name.clone());
                    result.push(entry);
                }
            }
        }
        Ok(result)
    }
    async fn get(&self, name: &str) -> Result<PackagedService<Self::R>, anyhow::Error> {
        for (list, reg) in &self.sources {
            if list.contains(name) {
                return reg.get(name).await;
            }
        }
        Err(Error::PackageNotFound {
            package: name.to_string(),
        })?
    }
}

#[async_recursion(?Send)]
pub async fn additional_packages<T: PackageRegistry + ?Sized>(
    installed: &PackageList,
    reg: &T,
    names: &[String],
    found: &mut HashMap<String, bool>,
    result: &mut Vec<PackagedService<<T as PackageRegistry>::R>>,
) -> Result<(), anyhow::Error> {
    for name in names {
        if let Some(completed) = found.get(name) {
            if !completed {
                Err(Error::DependencyCycle)?
            }
        } else {
            found.insert(name.clone(), false);
            if !installed.contains(name.as_str()) {
                let package = reg.get(name.as_str()).await?;
                additional_packages(installed, reg, &package.meta.depends, found, result).await?;
                result.push(package);
            }
            *found.get_mut(name).unwrap() = true;
        }
    }
    Ok(())
}

pub struct PackageList {
    packages: HashSet<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledNode {
    name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledEdge {
    node: InstalledNode,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledRoot {
    data: InstalledQuery,
}

impl PackageList {
    #[cfg(not(target_family = "wasm"))]
    pub async fn installed(
        base_url: &reqwest::Url,
        client: &mut reqwest::Client,
    ) -> Result<Self, anyhow::Error> {
        let Some(url::Host::Domain(host)) = base_url.host() else {
            Err(Error::NoDomain)?
        };
        let mut url = base_url.join("graphql")?;
        url.set_host(Some(&("package-sys.".to_string() + host)))?;
        //
        let mut end_cursor: Option<String> = None;
        let mut result = PackageList {
            packages: HashSet::new(),
        };
        loop {
            let page: InstalledRoot = crate::as_json(client
                                                     .post(url.clone())
                                                     .header("Content-Type", "application/graphql")
                                                    .body(format!("query {{ installed(first: 100, after: {}) {{ pageInfo {{ hasNextPage endCursor }} edges {{ node {{ name }} }} }} }}", serde_json::to_string(&end_cursor)?)))
                .await?;
            for edge in page.data.installed.edges {
                result.packages.insert(edge.node.name);
            }
            if !page.data.installed.pageInfo.hasNextPage {
                break;
            }
            end_cursor = Some(page.data.installed.pageInfo.endCursor);
        }
        Ok(result)
    }
    pub fn from_registry<T: PackageRegistry + ?Sized>(reg: &T) -> Result<Self, anyhow::Error> {
        let mut result = PackageList {
            packages: HashSet::new(),
        };
        for package in reg.index()? {
            result.packages.insert(package.name);
        }
        Ok(result)
    }
    fn contains(&self, name: &str) -> bool {
        self.packages.contains(name)
    }
    pub async fn resolve_new<T: PackageRegistry + ?Sized>(
        &self,
        reg: &T,
        packages: &[String],
    ) -> Result<Vec<PackagedService<<T as PackageRegistry>::R>>, anyhow::Error> {
        let mut result = vec![];
        additional_packages(self, reg, packages, &mut HashMap::new(), &mut result).await?;
        Ok(result)
    }
    pub fn into_vec(mut self) -> Vec<String> {
        let mut result: Vec<String> = self.packages.drain().collect();
        result.sort_unstable();
        result
    }
    pub fn union(mut self, mut other: Self) -> Self {
        for package in other.packages.drain() {
            self.packages.insert(package);
        }
        self
    }
    pub fn difference(mut self, other: Self) -> Self {
        for package in other.packages {
            self.packages.remove(&package);
        }
        self
    }
}
