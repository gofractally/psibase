use crate::{build, Args, SERVICE_POLYFILL};
use anyhow::anyhow;
use cargo_metadata::{Metadata, Node, Package, PackageId};
use psibase::{AccountNumber, Meta, PackageRef, ServiceInfo};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Write;
use zip::write::{FileOptions, ZipWriter};

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct PsibaseMetadata {
    #[serde(rename = "package-name")]
    package_name: Option<String>,
    server: Option<String>,
    flags: Vec<String>,
    dependencies: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Default)]
struct PsibaseWorkspaceMetadata {
    #[serde(rename = "package-name")]
    package_name: String,
    version: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    services: Vec<String>,
    #[serde(default)]
    dependencies: HashMap<String, String>,
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

pub async fn build_package(
    args: &Args,
    metadata: &Metadata,
    service: Option<&str>,
) -> Result<(), anyhow::Error> {
    let mut depends = vec![];
    let mut accounts = vec![];
    let mut visited = HashSet::new();
    let mut queue = Vec::new();
    let mut packages: HashMap<&str, &Package> = HashMap::new();
    let mut services = Vec::new();
    let mut resolved: HashMap<&str, &Node> = HashMap::new();
    let mut package_info = None;

    for package in &metadata.packages {
        packages.insert(&package.id.repr, &package);
    }

    if let Some(resolve) = &metadata.resolve {
        for package in &resolve.nodes {
            resolved.insert(&package.id.repr, &package);
        }
    }

    if let Some(root) = service {
        visited.insert(root);
        queue.push(root);
    } else {
        let work_meta: PsibaseWorkspaceMetadata = serde_json::from_value(
            metadata
                .workspace_metadata
                .as_object()
                .and_then(|m| m.get("psibase"))
                .unwrap_or(&json!({}))
                .clone(),
        )?;
        package_info = Some((
            work_meta.package_name,
            work_meta.version,
            work_meta.description,
        ));
        for service in work_meta.services {
            let Some(id) = find_dep(&packages, &metadata.workspace_members, &service) else {
                return Err(anyhow!("{} is not a workspace member", service,));
            };
            visited.insert(&id.repr);
            queue.push(&id.repr);
        }
        for (k, v) in work_meta.dependencies {
            depends.push(PackageRef {
                name: k,
                version: v,
            })
        }
    }
    let get_dep = |service: &str, dep: &str| {
        let r = resolved.get(service).unwrap();
        if let Some(id) = find_dep(&packages, &r.dependencies, dep) {
            Ok(id)
        } else if let Some(id) = find_dep(&packages, &metadata.workspace_members, dep) {
            Ok(id)
        } else {
            Err(anyhow!(
                "{} is not a dependency of {}",
                dep,
                packages.get(service).unwrap().name
            ))
        }
    };

    while !queue.is_empty() {
        for service in std::mem::take(&mut queue) {
            let Some(package) = packages.get(service) else {
                Err(anyhow!("Cannot find crate for service {}", service))?
            };
            let account: AccountNumber = package.name.parse()?;
            accounts.push(account);
            let pmeta: PsibaseMetadata = serde_json::from_value(
                package
                    .metadata
                    .as_object()
                    .and_then(|m| m.get("psibase"))
                    .unwrap_or(&json!({}))
                    .clone(),
            )?;
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
                let server_package = if &server == &package.name {
                    service
                } else {
                    &get_dep(&service, &server)?.repr
                };
                if visited.insert(server_package) {
                    queue.push(&server_package);
                }
            }
            services.push((&package.name, info, &package.id.repr));
        }
    }

    let (package_name, package_version, package_description) = if let Some(info) = package_info {
        info
    } else {
        let root = packages.get(service.unwrap()).unwrap();
        let root_meta: PsibaseMetadata = serde_json::from_value(
            root.metadata
                .as_object()
                .and_then(|m| m.get("psibase"))
                .unwrap_or(&json!({}))
                .clone(),
        )?;
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

    let target_dir = args
        .target_dir
        .as_ref()
        .map_or_else(|| metadata.target_directory.as_std_path(), |p| p.as_path());
    let out_dir = target_dir.join("wasm32-wasi/release/packages");
    let out_path = out_dir.join(package_name.clone() + ".psi");
    std::fs::create_dir_all(&out_dir)?;
    let mut out = ZipWriter::new(File::create(&out_path)?);
    let options: FileOptions = FileOptions::default();
    out.start_file("meta.json", options)?;
    write!(out, "{}", &serde_json::to_string(&meta)?)?;
    for (service, info, path) in service_wasms {
        out.start_file(format!("service/{}.wasm", service), options)?;
        std::io::copy(&mut File::open(path)?, &mut out)?;
        out.start_file(format!("service/{}.json", service), options)?;
        write!(out, "{}", &serde_json::to_string(&info)?)?;
    }
    out.finish()?;
    Ok(())
}
