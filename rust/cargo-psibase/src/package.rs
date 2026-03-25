use crate::{build, build_plugin, Args, AsyncJobServer, ServiceArtifacts};
use anyhow::anyhow;
use cargo_metadata::{Metadata, Node, Package, PackageId};
use psibase::{
    AccountNumber, Checksum256, Meta, PackageInfo, PackageRef, PackagedService, PrettyAction,
    Schema, ServiceInfo,
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
    scope: Option<String>,
    server: Option<String>,
    plugin: Option<String>,
    flags: Vec<String>,
    dependencies: HashMap<String, String>,
    services: Option<Vec<String>>,
    postinstall: Option<Vec<PrettyAction>>,
    data: Vec<DataFiles>,
}

impl PsibaseMetadata {
    pub fn is_package(&self) -> bool {
        self.package_name.is_some()
    }
}

fn find_dep<'a>(
    packages: &HashMap<&str, &'a Package>,
    ids: &[PackageId],
    name: &str,
) -> Option<&'a Package> {
    for id in ids {
        let p = packages.get(&id.repr.as_str()).unwrap();
        if &p.name == name {
            return Some(p);
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
    target_dir.join("wasm32-wasip1/release/packages")
}

fn should_build_package(
    filename: &Path,
    meta: &Meta,
    services: &[(AccountNumber, ServiceInfo, PathBuf)],
    data: &[(AccountNumber, String, PathBuf)],
    postinstall: &[PrettyAction],
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
    for (account, info, path) in services {
        if path.metadata()?.modified()? > timestamp {
            return Ok(true);
        }
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
        existing_data.push((data.account.value, data.filename.as_str()));
    }
    let mut new_data = Vec::new();
    for (account, dest, src) in data {
        if src.metadata()?.modified()? > timestamp {
            return Ok(true);
        }
        new_data.push((account.value, dest.as_str()));
    }
    existing_data.sort();
    new_data.sort();
    if existing_data != new_data {
        return Ok(true);
    }
    // check postinstall
    let existing_postinstall = existing.read_postinstall()?;
    if &existing_postinstall[..] != postinstall {
        return Ok(true);
    }
    Ok(false)
}

fn add_files<'a>(
    service: AccountNumber,
    src: &Path,
    dest: &str,
    out: &mut Vec<(AccountNumber, String, PathBuf)>,
) -> Result<(), anyhow::Error> {
    if src.is_file() {
        out.push((service, dest.to_string(), src.to_path_buf()));
    } else if src.is_dir() {
        for entry in src.read_dir()? {
            let entry = entry?;
            add_files(
                service,
                &entry.path(),
                &(dest.to_string()
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

pub struct PackageBuilder<'a> {
    service_crates: Vec<&'a Package>,
    service_info: Vec<ServiceInfo>,
    // (plugin, service-crate, path)
    plugins: Vec<(&'a Package, &'a str, String)>,
    postinstall: Vec<PrettyAction>,
    // (service-crate, src, dest)
    data_sources: Vec<(&'a str, PathBuf, String)>,
    depends: Vec<PackageRef>,
}

impl<'a> PackageBuilder<'a> {
    pub fn new(
        metadata: &'a MetadataIndex<'a>,
        root: &PackageId,
    ) -> Result<PackageBuilder<'a>, anyhow::Error> {
        let mut depends_set = HashSet::new();
        let mut visited = HashSet::new();
        let mut queue = Vec::new();
        let mut service_crates = Vec::new();
        let mut service_info = Vec::new();
        let mut plugins = Vec::new();
        let mut postinstall = Vec::new();
        let mut data_sources = Vec::new();

        let get_dep = get_dep_type(|service, dep| {
            let r = metadata.resolved.get(&service.id.repr.as_str()).unwrap();
            if dep == &service.name {
                Ok(&service.id)
            } else if let Some(p) = find_dep(&metadata.packages, &r.dependencies, dep) {
                Ok(&p.id)
            } else if let Some(p) = find_dep(
                &metadata.packages,
                &metadata.metadata.workspace_members,
                dep,
            ) {
                Ok(&p.id)
            } else {
                Err(anyhow!("{} is not a dependency of {}", dep, service.name))
            }
        });

        {
            let package = metadata.packages.get(root.repr.as_str()).unwrap();
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
                visited.insert(root.repr.as_str());
                queue.push(root.repr.as_str());
            }
            // Add postinstall and dependencies from the root whether it is a service or not
            if !visited.contains(root.repr.as_str()) {
                if let Some(actions) = &meta.postinstall {
                    postinstall.extend_from_slice(actions.as_slice());
                }
                for (k, v) in meta.dependencies {
                    depends_set.insert(PackageRef {
                        name: k,
                        version: v,
                    });
                }
            }
        }

        while !queue.is_empty() {
            for service in std::mem::take(&mut queue) {
                let Some(package) = metadata.packages.get(service) else {
                    Err(anyhow!("Cannot find crate for service {}", service))?
                };
                let pmeta: PsibaseMetadata = get_metadata(package)?;
                for (k, v) in pmeta.dependencies {
                    depends_set.insert(PackageRef {
                        name: k,
                        version: v,
                    });
                }
                let mut info = ServiceInfo {
                    flags: pmeta.flags,
                    server: None,
                    schema: None,
                };
                if let Some(server) = pmeta.server {
                    info.server = Some(server.parse()?);
                    let server_package = &get_dep(package, &server)?.repr;
                    if visited.insert(server_package) {
                        queue.push(&server_package);
                    }
                }
                if let Some(plugin) = pmeta.plugin {
                    let Some(p) = find_dep(
                        &metadata.packages,
                        &metadata.metadata.workspace_members,
                        &plugin,
                    ) else {
                        return Err(anyhow!("{} is not a workspace member", plugin,));
                    };
                    plugins.push((p, package.name.as_str(), "/plugin.wasm".to_string()));
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
                    data_sources.push((package.name.as_str(), src.into_std_path_buf(), dest));
                }
                service_crates.push(*package);
                service_info.push(info);
                if let Some(actions) = &pmeta.postinstall {
                    postinstall.extend_from_slice(actions.as_slice());
                }
            }
        }

        let mut depends: Vec<PackageRef> = depends_set.into_iter().collect();
        depends.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(PackageBuilder {
            service_crates,
            service_info,
            plugins,
            postinstall,
            data_sources,
            depends,
        })
    }

    fn finish(
        self,
        service_wasms: Vec<(AccountNumber, ServiceInfo, PathBuf)>,
        args: &Args,
        metadata: &MetadataIndex<'_>,
        root: &PackageId,
    ) -> Result<PackageInfo, anyhow::Error> {
        let PackageBuilder {
            service_crates,
            service_info: _,
            plugins: _,
            postinstall,
            data_sources,
            depends,
        } = self;

        let (package_name, package_version, package_description, package_scope) = {
            let root = metadata.packages.get(root.repr.as_str()).unwrap();
            let root_meta: PsibaseMetadata = get_metadata(root)?;
            let name = root_meta.package_name.unwrap_or_else(|| root.name.clone());
            let scope = root_meta.scope.unwrap_or_else(|| "network".to_string());
            (
                name,
                root.version.to_string(),
                root.description.clone(),
                scope,
            )
        };

        let accounts: Vec<_> = service_wasms.iter().map(|p| p.0).collect();

        let crate_to_account: HashMap<&str, AccountNumber> = service_crates
            .iter()
            .zip(service_wasms.iter())
            .map(|(p, (service, _, _))| (p.name.as_str(), *service))
            .collect();

        let mut data_files = Vec::new();
        for (service, src, dest) in data_sources {
            add_files(crate_to_account[service], &src, &dest, &mut data_files)?;
        }

        let meta = Meta {
            name: package_name.to_string(),
            version: package_version.to_string(),
            scope: package_scope,
            description: package_description.unwrap_or_else(|| package_name.to_string()),
            depends,
            accounts,
        };

        let out_dir = get_package_dir(args, metadata);
        let out_path = out_dir.join(package_name.clone() + ".psi");
        let mut file =
            if should_build_package(&out_path, &meta, &service_wasms, &data_files, &postinstall)
                .unwrap_or(true)
            {
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
}

#[derive(Default)]
struct FlattenServices<'a> {
    packages: Vec<&'a Package>,
    uses: HashMap<*const Package, Vec<usize>>,
    sizes: Vec<usize>,
}

impl<'a> FlattenServices<'a> {
    fn new(builders: &'a Vec<PackageBuilder>) -> Self {
        let mut result = FlattenServices::default();
        let mut i = 0;
        for builder in builders {
            result.sizes.push(builder.service_crates.len());
            for package in &builder.service_crates {
                let v = result.uses.entry(*package as *const Package).or_default();
                if v.is_empty() {
                    result.packages.push(*package);
                }
                v.push(i);
                i += 1;
            }
        }
        result
    }
    fn split(
        mut self,
        files: Vec<ServiceArtifacts>,
    ) -> Result<Vec<Vec<ServiceArtifacts>>, anyhow::Error> {
        // Duplicate items as needed
        let mut expanded = Vec::new();
        for mut file in files {
            let Some(uses) = self
                .uses
                .remove(&(self.packages[file.package_index] as *const Package))
            else {
                Err(anyhow!(
                    "Service {} should not produce more than one wasm target",
                    self.packages[file.package_index].name
                ))?
            };
            for i in &uses[0..(uses.len() - 1)] {
                file.package_index = *i;
                expanded.push(file.clone());
            }
            file.package_index = *uses.last().unwrap();
            expanded.push(file);
        }
        // Verify that all packages are present
        for package in &self.packages {
            if self.uses.contains_key(&(*package as *const Package)) {
                Err(anyhow!(
                    "Service {} is expected to produce a wasm target",
                    package.name
                ))?
            }
        }
        // Sort by package_index
        for i in 0..expanded.len() {
            let j = expanded[i].package_index;
            expanded.swap(i, j);
        }
        // Split into groups matching the original builders
        let mut result = Vec::new();
        let mut iter = expanded.into_iter();
        for n in &self.sizes {
            let mut group = Vec::with_capacity(*n);
            for _ in 0..*n {
                group.push(iter.next().unwrap())
            }
            result.push(group);
        }
        Ok(result)
    }
}

pub async fn build_packages(
    jobs: &AsyncJobServer,
    args: &Args,
    metadata: &MetadataIndex<'_>,
    roots: &[&PackageId],
) -> Result<Vec<PackageInfo>, anyhow::Error> {
    let mut builders = Vec::new();
    let mut all_crates = HashSet::new();

    for root in roots {
        builders.push(PackageBuilder::new(metadata, root)?);
    }

    for builder in &builders {
        for service in &builder.service_crates {
            all_crates.insert(&service.id);
        }
        for (plugin, _, _) in &builder.plugins {
            all_crates.insert(&plugin.id);
        }
    }

    // Run cargo build at the root to pick up any build scripts
    let mut extra_roots = Vec::new();
    for root in roots {
        if !all_crates.insert(*root) {
            extra_roots.push(*root);
        }
    }

    for builder in &mut builders {
        for (plugin, service, path) in std::mem::take(&mut builder.plugins) {
            let mut paths = build_plugin(args, &[plugin]).await?;
            if paths.len() != 1 {
                Err(anyhow!(
                    "Plugin {} should produce exactly one wasm target",
                    plugin.name
                ))?
            };
            builder
                .data_sources
                .push((service, paths.pop().unwrap().into(), path))
        }
    }

    let flattened = FlattenServices::new(&builders);
    let paths = build(&jobs, args, &flattened.packages, &extra_roots).await?;
    let paths = flattened.split(paths)?;

    let mut result = Vec::new();
    for ((mut builder, paths), root) in builders.into_iter().zip(paths).zip(roots) {
        let mut service_wasms = Vec::new();
        for (mut info, paths) in std::mem::take(&mut builder.service_info)
            .into_iter()
            .zip(paths)
        {
            let schema: Schema =
                serde_json::from_str(&std::io::read_to_string(File::open(paths.schema)?)?)?;
            let service = schema.service.clone();
            info.schema = Some(schema);
            service_wasms.push((service, info, paths.service));
        }
        result.push(builder.finish(service_wasms, args, metadata, root)?)
    }
    Ok(result)
}
