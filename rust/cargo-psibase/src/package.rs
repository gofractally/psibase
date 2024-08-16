use crate::{build, build_plugin, Args, SERVICE_POLYFILL};
use anyhow::anyhow;
use cargo_metadata::{Metadata, Node, Package, PackageId};
use psibase::{AccountNumber, Checksum256, Meta, PackageInfo, PackageRef, ServiceInfo};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{Seek, Write};
use zip::write::{FileOptions, ZipWriter};

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

pub async fn build_package(
    args: &Args,
    metadata: &MetadataIndex<'_>,
    service: Option<&str>,
) -> Result<PackageInfo, anyhow::Error> {
    let mut depends = vec![];
    let mut accounts = vec![];
    let mut visited = HashSet::new();
    let mut queue = Vec::new();
    let mut services = Vec::new();
    let mut plugins = Vec::new();
    let mut data_files = Vec::new();

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
    } else {
        Err(anyhow!("Cannot package a virtual workspace"))?
    }

    while !queue.is_empty() {
        for service in std::mem::take(&mut queue) {
            let Some(package) = metadata.packages.get(service) else {
                Err(anyhow!("Cannot find crate for service {}", service))?
            };
            let account: AccountNumber = package.name.parse()?;
            accounts.push(account);
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
            services.push((&package.name, info, &package.id.repr));
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
        data_files.push((service, path, paths.pop().unwrap()))
    }

    let target_dir = args.target_dir.as_ref().map_or_else(
        || metadata.metadata.target_directory.as_std_path(),
        |p| p.as_path(),
    );
    let out_dir = target_dir.join("wasm32-wasi/release/packages");
    let out_path = out_dir.join(package_name.clone() + ".psi");
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
    let mut file = out.finish()?;
    // Calculate the package checksum
    file.rewind()?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    let hash: [u8; 32] = hasher.finalize().into();
    Ok(meta.info(Checksum256::from(hash), package_name.clone() + ".psi"))
}
