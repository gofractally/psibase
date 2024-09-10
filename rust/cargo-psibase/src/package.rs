use crate::{build, build_plugin, Args, SERVICE_POLYFILL};
use anyhow::anyhow;
use cargo_metadata::{Metadata, Node, Package, PackageId};
use psibase::{
    AccountNumber, Action, Checksum256, ExactAccountNumber, Meta, PackageInfo, PackageRef,
    PackagedService, ServiceInfo,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{BufReader, Seek, Write};
use std::path::{Path, PathBuf};
use zip::write::{FileOptions, ZipWriter};

#[derive(Serialize, Deserialize, Default)]
struct DataFiles {
    src: String,
    dst: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PsibaseMetadata {
    #[serde(rename = "package-name")]
    package_name: Option<String>,
    server: Option<String>,
    plugin: Option<String>,
    flags: Vec<String>,
    dependencies: HashMap<String, String>,
    services: Option<Vec<String>>,
    postinstall: Option<Vec<Action>>,
    data: Vec<DataFiles>,
}

impl PsibaseMetadata {
    pub fn is_package(&self) -> bool {
        self.package_name.is_some()
    }
}

fn find_dep<'a>(
    packages: &HashMap<&str, &Package>,
    ids: &'a [PackageId],
    name: &str,
) -> Option<&'a PackageId> {
    for id in ids {
        let p = packages.get(&id.repr.as_str()).unwrap();
        if &p.name == name {
            return Some(id);
        }
    }
    None
}

pub fn get_metadata(package: &Package) -> Result<PsibaseMetadata, anyhow::Error> {
    Ok(serde_json::from_value(
        package
            .metadata
            .as_object()
            .and_then(|m| m.get("psibase"))
            .unwrap_or(&json!({}))
            .clone(),
    )?)
}

fn get_dep_type<'a, F>(f: F) -> F
where
    F: Fn(&'a Package, &str) -> Result<&'a PackageId, anyhow::Error> + 'a,
{
    f
}

pub struct MetadataIndex<'a> {
    pub metadata: &'a Metadata,
    pub packages: HashMap<&'a str, &'a Package>,
    pub resolved: HashMap<&'a str, &'a Node>,
}

impl<'a> MetadataIndex<'a> {
    pub fn new(metadata: &'a Metadata) -> MetadataIndex<'a> {
        let mut packages: HashMap<&str, &Package> = HashMap::new();
        let mut resolved: HashMap<&str, &Node> = HashMap::new();
        for package in &metadata.packages {
            packages.insert(&package.id.repr, &package);
        }

        if let Some(resolve) = &metadata.resolve {
            for package in &resolve.nodes {
                resolved.insert(&package.id.repr, &package);
            }
        }
        MetadataIndex {
            metadata,
            packages,
            resolved,
        }
    }
}

pub fn get_package_dir(args: &Args, metadata: &MetadataIndex) -> PathBuf {
    let target_dir = args.target_dir.as_ref().map_or_else(
        || metadata.metadata.target_directory.as_std_path(),
        |p| p.as_path(),
    );
    target_dir.join("wasm32-wasi/release/packages")
}

fn should_build_package(
    filename: &Path,
    meta: &Meta,
    services: &[(&String, ServiceInfo, PathBuf)],
    data: &[(&String, String, PathBuf)],
    postinstall: &[Action],
) -> Result<bool, anyhow::Error> {
    let timestamp = if let Ok(metadata) = filename.metadata() {
        metadata.modified()?
    } else {
        return Ok(true);
    };
    let mut existing = PackagedService::new(BufReader::new(File::open(filename)?))?;
    if existing.meta() != meta {
        return Ok(true);
    }
    let manifest = existing.manifest();
    // Check services
    if manifest.services.len() != services.len() {
        return Ok(true);
    }
    for (name, info, path) in services {
        if path.metadata()?.modified()? > timestamp {
            return Ok(true);
        }
        let account: AccountNumber = name.parse()?;
        if let Some(existing_info) = manifest.services.get(&account) {
            if info != existing_info {
                return Ok(true);
            }
        } else {
            return Ok(true);
        }
    }
    // check data
    if manifest.data.len() != data.len() {
        return Ok(true);
    }
    let mut existing_data = Vec::new();
    for data in &manifest.data {
        existing_data.push((data.service.value, data.filename.as_str()));
    }
    let mut new_data = Vec::new();
    for (service, dest, src) in data {
        if src.metadata()?.modified()? > timestamp {
            return Ok(true);
        }
        let account: AccountNumber = service.parse()?;
        new_data.push((account.value, dest.as_str()));
    }
    existing_data.sort();
    new_data.sort();
    if existing_data != new_data {
        return Ok(true);
    }
    // check postinstall
    let mut existing_postinstall = Vec::new();
    existing.postinstall(&mut existing_postinstall)?;
    if &existing_postinstall[..] != postinstall {
        return Ok(true);
    }
    Ok(false)
}

fn add_files<'a>(
    service: &'a String,
    src: &Path,
    dest: &String,
    out: &mut Vec<(&'a String, String, PathBuf)>,
) -> Result<(), anyhow::Error> {
    if src.is_file() {
        out.push((service, dest.clone(), src.to_path_buf()));
    } else if src.is_dir() {
        for entry in src.read_dir()? {
            let entry = entry?;
            add_files(
                service,
                &entry.path(),
                &(dest.clone()
                    + "/"
                    + entry.file_name().to_str().ok_or_else(|| {
                        anyhow!(
                            "non-unicode file name: {}",
                            entry.file_name().to_string_lossy()
                        )
                    })?),
                out,
            )?;
        }
    }
    Ok(())
}

pub async fn build_package(
    args: &Args,
    metadata: &MetadataIndex<'_>,
    service: Option<&str>,
) -> Result<PackageInfo, anyhow::Error> {
    let mut depends = vec![];
    let mut accounts: Vec<AccountNumber> = Vec::new();
    let mut visited = HashSet::new();
    let mut queue = Vec::new();
    let mut services = Vec::new();
    let mut plugins = Vec::new();
    let mut data_files = Vec::new();
    let mut postinstall = Vec::new();
    let mut data_sources = Vec::new();

    let get_dep = get_dep_type(|service, dep| {
        let r = metadata.resolved.get(&service.id.repr.as_str()).unwrap();
        if dep == &service.name {
            Ok(&service.id)
        } else if let Some(id) = find_dep(&metadata.packages, &r.dependencies, dep) {
            Ok(id)
        } else if let Some(id) = find_dep(
            &metadata.packages,
            &metadata.metadata.workspace_members,
            dep,
        ) {
            Ok(id)
        } else {
            Err(anyhow!("{} is not a dependency of {}", dep, service.name))
        }
    });

    if let Some(root) = service {
        let package = metadata.packages.get(root).unwrap();
        let meta = get_metadata(package)?;
        if !meta.is_package() {
            Err(anyhow!("{} is not a psibase package because it does not define package.metadata.psibase.package_name", package.name))?
        }
        if let Some(services) = &meta.services {
            for s in services {
                let id: &str = &get_dep(package, &s)?.repr;
                if visited.insert(id) {
                    queue.push(id);
                }
            }
        } else {
            visited.insert(root);
            queue.push(root);
        }
        // Add postinstall from the root whether it is a service or not
        if !visited.contains(root) {
            if let Some(actions) = &meta.postinstall {
                postinstall.extend_from_slice(actions.as_slice());
            }
        }
    } else {
        Err(anyhow!("Cannot package a virtual workspace"))?
    }

    while !queue.is_empty() {
        for service in std::mem::take(&mut queue) {
            let Some(package) = metadata.packages.get(service) else {
                Err(anyhow!("Cannot find crate for service {}", service))?
            };
            let account: ExactAccountNumber = package.name.parse()?;
            accounts.push(account.into());
            let pmeta: PsibaseMetadata = get_metadata(package)?;
            for (k, v) in pmeta.dependencies {
                depends.push(PackageRef {
                    name: k,
                    version: v,
                })
            }
            let mut info = ServiceInfo {
                flags: pmeta.flags,
                server: None,
            };
            if let Some(server) = pmeta.server {
                info.server = Some(server.parse()?);
                let server_package = &get_dep(package, &server)?.repr;
                if visited.insert(server_package) {
                    queue.push(&server_package);
                }
            }
            if let Some(plugin) = pmeta.plugin {
                let Some(id) = find_dep(
                    &metadata.packages,
                    &metadata.metadata.workspace_members,
                    &plugin,
                ) else {
                    return Err(anyhow!("{} is not a workspace member", service,));
                };
                plugins.push((plugin, &package.name, "/plugin.wasm", &id.repr));
            }
            for data in &pmeta.data {
                let src = package.manifest_path.parent().unwrap().join(&data.src);
                let mut dest = data.dst.clone();
                if !dest.starts_with('/') {
                    dest = "/".to_string() + &dest;
                }
                if dest.ends_with('/') {
                    dest.pop();
                }
                data_sources.push((&package.name, src, dest));
            }
            services.push((&package.name, info, &package.id.repr));
            if let Some(actions) = &pmeta.postinstall {
                postinstall.extend_from_slice(actions.as_slice());
            }
        }
    }

    let (package_name, package_version, package_description) = {
        let root = metadata.packages.get(service.unwrap()).unwrap();
        let root_meta: PsibaseMetadata = get_metadata(root)?;
        if let Some(name) = root_meta.package_name {
            (name, root.version.to_string(), root.description.clone())
        } else {
            (
                root.name.clone(),
                root.version.to_string(),
                root.description.clone(),
            )
        }
    };

    let meta = Meta {
        name: package_name.to_string(),
        version: package_version.to_string(),
        description: package_description.unwrap_or_else(|| package_name.to_string()),
        depends,
        accounts,
    };

    let mut service_wasms = Vec::new();
    for (service, info, id) in services {
        let mut paths = build(
            args,
            &[id.as_str()],
            vec![],
            &["--lib", "--crate-type=cdylib", "-p", &service],
            Some(SERVICE_POLYFILL),
        )
        .await?;
        if paths.len() != 1 {
            Err(anyhow!(
                "Service {} should produce exactly one wasm target",
                service
            ))?
        };
        service_wasms.push((service, info, paths.pop().unwrap()));
    }

    for (plugin, service, path, id) in plugins {
        let mut paths = build_plugin(args, &[id.as_str()], &["-p", &plugin]).await?;
        if paths.len() != 1 {
            Err(anyhow!(
                "Plugin {} should produce exactly one wasm target",
                plugin
            ))?
        };
        data_files.push((service, path.to_string(), paths.pop().unwrap()))
    }

    for (service, src, dest) in data_sources {
        add_files(service, src.as_std_path(), &dest, &mut data_files)?;
    }

    let out_dir = get_package_dir(args, metadata);
    let out_path = out_dir.join(package_name.clone() + ".psi");
    let mut file =
        if should_build_package(&out_path, &meta, &service_wasms, &data_files, &postinstall)? {
            std::fs::create_dir_all(&out_dir)?;
            let mut out = ZipWriter::new(
                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .open(&out_path)?,
            );
            let options: FileOptions = FileOptions::default();
            out.start_file("meta.json", options)?;
            write!(out, "{}", &serde_json::to_string(&meta)?)?;
            for (service, info, path) in service_wasms {
                out.start_file(format!("service/{}.wasm", service), options)?;
                std::io::copy(&mut File::open(path)?, &mut out)?;
                out.start_file(format!("service/{}.json", service), options)?;
                write!(out, "{}", &serde_json::to_string(&info)?)?;
            }
            for (service, dest, src) in data_files {
                out.start_file(format!("data/{}{}", service, dest), options)?;
                std::io::copy(&mut File::open(src)?, &mut out)?;
            }
            if !postinstall.is_empty() {
                out.start_file("script/postinstall.json", options)?;
                write!(out, "{}", &serde_json::to_string(&postinstall)?)?;
            }
            let mut file = out.finish()?;
            file.rewind()?;
            file
        } else {
            File::open(out_path)?
        };
    // Calculate the package checksum
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    let hash: [u8; 32] = hasher.finalize().into();
    Ok(meta.info(Checksum256::from(hash), package_name.clone() + ".psi"))
}
