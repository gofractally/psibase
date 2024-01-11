use crate::services::{account_sys, proxy_sys, psispace_sys};
use crate::{AccountNumber, Action, GenesisService};
use custom_error::custom_error;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{hash_map, HashMap};
use std::io::{Read, Seek};
use std::str::FromStr;
use zip::ZipArchive;

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;

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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Meta {
    name: String,
    description: String,
    depends: Vec<String>,
    accounts: Vec<AccountNumber>,
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

fn dfs<T: PackageRegistry + ?Sized>(
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
            let package = reg.get(name.as_str())?;
            dfs(reg, &package.meta.depends, found, result)?;
            result.push(package);
            *found.get_mut(name).unwrap() = true;
        }
    }
    Ok(())
}

pub trait PackageRegistry {
    type R: Read + Seek;
    fn get(&self, name: &str) -> Result<PackagedService<Self::R>, anyhow::Error>;
    // Returns a set of packages and all dependencies
    // The result is ordered by dependency so that if A depends on B, then B appears before A.
    fn resolve(&self, packages: &[String]) -> Result<Vec<PackagedService<Self::R>>, anyhow::Error> {
        let mut result = vec![];
        dfs(self, packages, &mut HashMap::new(), &mut result)?;
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

impl PackageRegistry for DirectoryRegistry {
    type R = BufReader<File>;
    fn get(&self, name: &str) -> Result<PackagedService<Self::R>, anyhow::Error> {
        let f = File::open(self.dir.join(name.to_string() + ".psi"))?;
        PackagedService::new(BufReader::new(f))
    }
}
