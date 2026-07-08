use crate::{EntityType, Location, Occurrence, PackageScan};
use anyhow::{anyhow, Context, Result};
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};
use toml::map::Map;

pub fn scan_package(package_root: &Path, cmake_search_roots: &[&Path]) -> Result<PackageScan> {
    let root_toml_path = package_root.join("Cargo.toml");
    let root_content = fs::read_to_string(&root_toml_path)
        .with_context(|| format!("read {}", root_toml_path.display()))?;
    let root_toml: toml::Value = toml::from_str(&root_content)?;

    let mut occurrences = Vec::new();

    let published_name = root_toml
        .get("package")
        .and_then(|p| p.get("metadata"))
        .and_then(|m| m.get("psibase"))
        .and_then(|p| p.get("package-name"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("missing package.metadata.psibase.package-name"))?;

    push_toml_string(
        &mut occurrences,
        &root_toml_path,
        &root_content,
        EntityType::PublishedPackage,
        "published_package",
        published_name,
        &["package-name"],
    )?;

    if let Some(package_crate) = root_toml
        .get("package")
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
    {
        push_toml_string(
            &mut occurrences,
            &root_toml_path,
            &root_content,
            EntityType::PackageCrate,
            "package_crate",
            package_crate,
            &["name"],
        )?;
    }

    let services = root_toml
        .get("package")
        .and_then(|p| p.get("metadata"))
        .and_then(|m| m.get("psibase"))
        .and_then(|p| p.get("services"))
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow!("missing package.metadata.psibase.services"))?;

    let deps = root_toml
        .get("dependencies")
        .and_then(|v| v.as_table())
        .cloned()
        .unwrap_or_default();

    for service_value in services {
        let service_name = service_value
            .as_str()
            .ok_or_else(|| anyhow!("services entries must be strings"))?;

        let group = format!("service_crate:{service_name}");

        push_toml_string(
            &mut occurrences,
            &root_toml_path,
            &root_content,
            EntityType::ServiceCrate,
            &group,
            service_name,
            &["services"],
        )?;

        if deps.contains_key(service_name) {
            push_toml_key(
                &mut occurrences,
                &root_toml_path,
                &root_content,
                EntityType::ServiceCrate,
                &group,
                service_name,
                &format!("\"{service_name}\""),
            )?;
        }

        let service_dir = dependency_path(&deps, service_name, package_root)
            .unwrap_or_else(|| package_root.join("service"));

        scan_service(&mut occurrences, package_root, &service_dir, service_name)?;
    }

    scan_cmake_outputs(
        &mut occurrences,
        package_root,
        cmake_search_roots,
        published_name,
    )?;

    Ok(PackageScan {
        package_root: package_root.to_path_buf(),
        occurrences,
    })
}

fn scan_service(
    occurrences: &mut Vec<Occurrence>,
    package_root: &Path,
    service_dir: &Path,
    service_key: &str,
) -> Result<()> {
    let service_toml_path = service_dir.join("Cargo.toml");
    if !service_toml_path.is_file() {
        return Ok(());
    }
    let service_content = fs::read_to_string(&service_toml_path)?;
    let service_toml: toml::Value = toml::from_str(&service_content)?;

    let service_crate = service_toml
        .get("package")
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or(service_key);
    let service_group = format!("service_crate:{service_key}");

    let root_toml_path = package_root.join("Cargo.toml");
    let root_content = fs::read_to_string(&root_toml_path)?;
    let root_toml: toml::Value = toml::from_str(&root_content)?;
    let root_deps = root_toml.get("dependencies").and_then(|v| v.as_table());

    push_toml_string(
        occurrences,
        &service_toml_path,
        &service_content,
        EntityType::ServiceCrate,
        &service_group,
        service_crate,
        &["name"],
    )?;

    let pkg_crate = package_root
        .join("Cargo.toml")
        .pipe(|p| fs::read_to_string(p).ok())
        .and_then(|c| toml::from_str::<toml::Value>(&c).ok())
        .and_then(|v| {
            v.get("package")
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .map(str::to_string)
        });

    if let Some(dev_deps) = service_toml
        .get("dev-dependencies")
        .and_then(|v| v.as_table())
    {
        if let Some(pkg) = &pkg_crate {
            if dev_deps.contains_key(pkg) {
                push_toml_key(
                    occurrences,
                    &service_toml_path,
                    &service_content,
                    EntityType::PackageCrate,
                    "package_crate",
                    pkg,
                    &format!("\"{pkg}\""),
                )?;
            }
        }
    }

    let psibase_meta = service_toml
        .get("package")
        .and_then(|p| p.get("metadata"))
        .and_then(|m| m.get("psibase"));

    if let Some(server) = psibase_meta
        .and_then(|m| m.get("server"))
        .and_then(|v| v.as_str())
    {
        if server == service_crate {
            // Service handles its own HTTP; `server` references the service crate.
            push_toml_string(
                occurrences,
                &service_toml_path,
                &service_content,
                EntityType::ServiceCrate,
                &service_group,
                server,
                &["server"],
            )?;
        } else {
            let query_group = format!("query_crate:{service_key}");
            push_toml_string(
                occurrences,
                &service_toml_path,
                &service_content,
                EntityType::QueryCrate,
                &query_group,
                server,
                &["server"],
            )?;

            if root_deps.is_some_and(|deps| deps.contains_key(server)) {
                push_toml_key(
                    occurrences,
                    &root_toml_path,
                    &root_content,
                    EntityType::QueryCrate,
                    &query_group,
                    server,
                    &format!("\"{server}\""),
                )?;
            }

            let query_dir = dependency_path_from_table(
                service_toml.get("dependencies").and_then(|v| v.as_table()),
                server,
                service_dir.parent().unwrap_or(package_root),
            )
            .or_else(|| dependency_path_from_table(root_deps, server, package_root))
            .unwrap_or_else(|| package_root.join("query-service"));

            scan_query(occurrences, &query_dir, service_key, server)?;
        }
    }

    if let Some(plugin) = psibase_meta
        .and_then(|m| m.get("plugin"))
        .and_then(|v| v.as_str())
    {
        let plugin_group = format!("plugin_crate:{service_key}");
        push_toml_string(
            occurrences,
            &service_toml_path,
            &service_content,
            EntityType::PluginCrate,
            &plugin_group,
            plugin,
            &["plugin"],
        )?;

        if root_deps.is_some_and(|deps| deps.contains_key(plugin)) {
            push_toml_key(
                occurrences,
                &root_toml_path,
                &root_content,
                EntityType::PluginCrate,
                &plugin_group,
                plugin,
                &format!("\"{plugin}\""),
            )?;
        }

        let plugin_dir = dependency_path_from_table(root_deps, plugin, package_root)
            .unwrap_or_else(|| package_root.join("plugin"));

        scan_plugin(occurrences, &plugin_dir, service_key, plugin)?;
    }

    if let Some(postinstall) = psibase_meta
        .and_then(|m| m.get("postinstall"))
        .and_then(|v| v.as_array())
    {
        let chain_group = format!("on_chain_service:{service_key}");
        let on_chain_name = find_on_chain_service_name(service_dir);
        for action in postinstall {
            let sender = action.get("sender").and_then(|v| v.as_str());
            let service = action.get("service").and_then(|v| v.as_str());
            // Correlate postinstall only for this service's own init action.
            if sender.is_some() && sender == service {
                let account = sender.unwrap();
                if on_chain_name.as_deref() == Some(account) {
                    push_toml_field_string(
                        occurrences,
                        &service_toml_path,
                        &service_content,
                        EntityType::OnChainService,
                        &chain_group,
                        "sender",
                        account,
                        &["postinstall", "sender"],
                    )?;
                    push_toml_field_string(
                        occurrences,
                        &service_toml_path,
                        &service_content,
                        EntityType::OnChainService,
                        &chain_group,
                        "service",
                        account,
                        &["postinstall", "service"],
                    )?;
                }
            }
        }
    }

    scan_rust_service_account(occurrences, service_dir, service_key)?;
    Ok(())
}

fn scan_query(
    occurrences: &mut Vec<Occurrence>,
    query_dir: &Path,
    service_key: &str,
    expected_query_crate: &str,
) -> Result<()> {
    let query_toml_path = query_dir.join("Cargo.toml");
    if !query_toml_path.is_file() {
        return Ok(());
    }
    let query_content = fs::read_to_string(&query_toml_path)?;
    let query_toml: toml::Value = toml::from_str(&query_content)?;
    let query_group = format!("query_crate:{service_key}");

    if let Some(name) = query_toml
        .get("package")
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
    {
        push_toml_string(
            occurrences,
            &query_toml_path,
            &query_content,
            EntityType::QueryCrate,
            &query_group,
            name,
            &["name"],
        )?;
    }

    let _ = expected_query_crate;
    scan_rust_query_account(occurrences, query_dir, service_key)?;
    Ok(())
}

fn scan_plugin(
    occurrences: &mut Vec<Occurrence>,
    plugin_dir: &Path,
    service_key: &str,
    expected_plugin_crate: &str,
) -> Result<()> {
    let plugin_toml_path = plugin_dir.join("Cargo.toml");
    if !plugin_toml_path.is_file() {
        return Ok(());
    }
    let plugin_content = fs::read_to_string(&plugin_toml_path)?;
    let plugin_toml: toml::Value = toml::from_str(&plugin_content)?;
    let plugin_group = format!("plugin_crate:{service_key}");

    if let Some(name) = plugin_toml
        .get("package")
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
    {
        push_toml_string(
            occurrences,
            &plugin_toml_path,
            &plugin_content,
            EntityType::PluginCrate,
            &plugin_group,
            name,
            &["name"],
        )?;
    }

    let _ = expected_plugin_crate;
    if let Some(package) = plugin_toml
        .get("package")
        .and_then(|p| p.get("metadata"))
        .and_then(|m| m.get("component"))
        .and_then(|c| c.get("package"))
        .and_then(|v| v.as_str())
    {
        let wit_group = format!("wit_package:{service_key}");
        push_toml_string(
            occurrences,
            &plugin_toml_path,
            &plugin_content,
            EntityType::WitPackage,
            &wit_group,
            package,
            &["package"],
        )?;
    }

    let wit_dir = plugin_dir.join("wit");
    if wit_dir.is_dir() {
        for entry in fs::read_dir(&wit_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "wit") {
                scan_wit_package(occurrences, &path, service_key)?;
            }
        }
    }
    Ok(())
}

fn scan_wit_package(
    occurrences: &mut Vec<Occurrence>,
    path: &Path,
    service_key: &str,
) -> Result<()> {
    let content = fs::read_to_string(path)?;
    let re = Regex::new(r"^\s*package\s+([^;]+);")?;
    for (idx, line) in content.lines().enumerate() {
        if let Some(caps) = re.captures(line) {
            let value = caps[1].trim().to_string();
            if let Some(loc) = find_quoted_or_word_in_line(path, &content, idx + 1, &value) {
                occurrences.push(Occurrence {
                    entity: EntityType::WitPackage,
                    group_id: format!("wit_package:{service_key}"),
                    value,
                    location: loc,
                });
            }
        }
    }
    Ok(())
}

fn find_on_chain_service_name(service_dir: &Path) -> Option<String> {
    let src = service_dir.join("src");
    if !src.is_dir() {
        return None;
    }
    let re = Regex::new(r#"#\[psibase::service\s*\(\s*name\s*=\s*"([^"]+)""#).ok()?;
    find_rust_macro_value(&src, &re)
}

fn find_rust_macro_value(dir: &Path, re: &Regex) -> Option<String> {
    for entry in fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(v) = find_rust_macro_value(&path, re) {
                return Some(v);
            }
        } else if path.extension().is_some_and(|e| e == "rs") {
            let content = fs::read_to_string(&path).ok()?;
            if let Some(caps) = re.captures(&content) {
                return Some(caps[1].to_string());
            }
        }
    }
    None
}

fn scan_rust_service_account(
    occurrences: &mut Vec<Occurrence>,
    service_dir: &Path,
    service_key: &str,
) -> Result<()> {
    let src = service_dir.join("src");
    if !src.is_dir() {
        return Ok(());
    }
    let re = Regex::new(r#"#\[psibase::service\s*\(\s*name\s*=\s*"([^"]+)""#)?;
    scan_rust_dir(
        occurrences,
        &src,
        &re,
        EntityType::OnChainService,
        &format!("on_chain_service:{service_key}"),
    )?;
    Ok(())
}

fn scan_rust_query_account(
    occurrences: &mut Vec<Occurrence>,
    query_dir: &Path,
    service_key: &str,
) -> Result<()> {
    let src = query_dir.join("src");
    if !src.is_dir() {
        return Ok(());
    }
    let re = Regex::new(r#"#\[psibase::service\s*\(\s*name\s*=\s*"([^"]+)""#)?;
    scan_rust_dir(
        occurrences,
        &src,
        &re,
        EntityType::OnChainQuery,
        &format!("on_chain_query:{service_key}"),
    )?;
    Ok(())
}

fn scan_rust_dir(
    occurrences: &mut Vec<Occurrence>,
    dir: &Path,
    re: &Regex,
    entity: EntityType,
    group_id: &str,
) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            scan_rust_dir(occurrences, &path, re, entity, group_id)?;
        } else if path.extension().is_some_and(|e| e == "rs") {
            let content = fs::read_to_string(&path)?;
            for (idx, line) in content.lines().enumerate() {
                if let Some(caps) = re.captures(line) {
                    let value = caps[1].to_string();
                    if let Some(loc) = find_quoted_in_line(&path, idx + 1, line, &value) {
                        occurrences.push(Occurrence {
                            entity,
                            group_id: group_id.to_string(),
                            value,
                            location: loc,
                        });
                    }
                }
            }
        }
    }
    Ok(())
}

fn scan_cmake_outputs(
    occurrences: &mut Vec<Occurrence>,
    package_root: &Path,
    cmake_search_roots: &[&Path],
    published_name: &str,
) -> Result<()> {
    let package_root = package_root
        .canonicalize()
        .unwrap_or_else(|_| package_root.to_path_buf());

    for search_root in cmake_search_roots {
        let cmake_path = search_root.join("CMakeLists.txt");
        if !cmake_path.is_file() {
            continue;
        }
        let content = fs::read_to_string(&cmake_path)?;
        let _path_pattern = regex::escape(&normalize_path_for_match(path_relative_to(
            package_root.to_path_buf(),
            search_root,
        )));
        let block_re = Regex::new(&format!(
            r"(?s)cargo_psibase_package\s*\(\s*.*?PATH\s+([^\)\n]+).*?\)"
        ))?;
        let output_re = Regex::new(r"OUTPUT\s+\$\{SERVICE_DIR\}/([^.]+)\.psi")?;

        for caps in block_re.captures_iter(&content) {
            let path_value = caps[1].trim();
            if !path_matches_package(path_value, &package_root, search_root) {
                continue;
            }
            let block = caps.get(0).unwrap().as_str();
            if let Some(out) = output_re.captures(block) {
                let psi_name = out[1].to_string();
                if let Some(loc) = find_word_in_content(&cmake_path, &content, &psi_name) {
                    occurrences.push(Occurrence {
                        entity: EntityType::PublishedPackage,
                        group_id: "published_package".into(),
                        value: psi_name,
                        location: loc,
                    });
                }
            }
        }
    }

    let _ = published_name;
    Ok(())
}

fn path_matches_package(path_value: &str, package_root: &Path, search_root: &Path) -> bool {
    let rel = path_relative_to(package_root.to_path_buf(), search_root);
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    let path_value = path_value.trim().replace('\\', "/");
    path_value.ends_with(&rel_str)
        || path_value.ends_with(
            rel.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .as_ref(),
        )
}

fn path_relative_to(path: PathBuf, base: &Path) -> PathBuf {
    path.strip_prefix(base)
        .map(Path::to_path_buf)
        .unwrap_or(path)
}

fn normalize_path_for_match(path: PathBuf) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn dependency_path(deps: &Map<String, toml::Value>, key: &str, base: &Path) -> Option<PathBuf> {
    dependency_path_from_table(Some(deps), key, base)
}

fn dependency_path_from_table(
    deps: Option<&Map<String, toml::Value>>,
    key: &str,
    base: &Path,
) -> Option<PathBuf> {
    let dep = deps?.get(key)?;
    let path = dep.get("path").and_then(|v| v.as_str())?;
    Some(base.join(path))
}

fn push_toml_field_string(
    occurrences: &mut Vec<Occurrence>,
    path: &Path,
    content: &str,
    entity: EntityType,
    group_id: &str,
    field: &str,
    value: &str,
    key_hints: &[&str],
) -> Result<()> {
    if let Some(loc) = find_toml_field_string_value(path, content, field, value, key_hints) {
        occurrences.push(Occurrence {
            entity,
            group_id: group_id.to_string(),
            value: value.to_string(),
            location: loc,
        });
    }
    Ok(())
}

fn find_toml_field_string_value(
    path: &Path,
    content: &str,
    field: &str,
    value: &str,
    key_hints: &[&str],
) -> Option<Location> {
    let field_re = Regex::new(&format!(
        "{}\\s*=\\s*\"{}\"",
        regex::escape(field),
        regex::escape(value)
    ))
    .ok()?;
    for (idx, line) in content.lines().enumerate() {
        if !key_hints.iter().any(|k| line.contains(k)) {
            continue;
        }
        let Some(m) = field_re.find(line) else {
            continue;
        };
        let start_col = m.end() - 1 - value.len();
        return Some(Location {
            file: path.to_path_buf(),
            line: (idx + 1) as u32,
            start_col: start_col as u32,
            end_col: (start_col + value.len()) as u32,
        });
    }
    None
}

#[cfg(test)]
mod field_scan_tests {
    use super::*;

    #[test]
    fn postinstall_field_regex_matches() {
        let re = Regex::new(r#"sender\s*=\s*"token-swap""#).unwrap();
        let line =
            r#"    { sender = "token-swap", service = "token-swap", method = "init", data = {} },"#;
        assert!(re.is_match(line));
    }

    #[test]
    fn finds_postinstall_sender_and_service_fields() {
        let content = r#"postinstall = [
    { sender = "token-swap", service = "token-swap", method = "init", data = {} },
]"#;
        let path = Path::new("/tmp/Cargo.toml");
        let sender = find_toml_field_string_value(
            path,
            content,
            "sender",
            "token-swap",
            &["postinstall", "sender"],
        )
        .unwrap();
        assert_eq!(sender.line, 2);
        let service = find_toml_field_string_value(
            path,
            content,
            "service",
            "token-swap",
            &["postinstall", "service"],
        )
        .unwrap();
        assert_eq!(service.line, 2);
        assert!(service.start_col > sender.start_col);
    }
}

fn push_toml_string(
    occurrences: &mut Vec<Occurrence>,
    path: &Path,
    content: &str,
    entity: EntityType,
    group_id: &str,
    value: &str,
    key_hints: &[&str],
) -> Result<()> {
    if let Some(loc) = find_toml_string_value(path, content, value, key_hints) {
        occurrences.push(Occurrence {
            entity,
            group_id: group_id.to_string(),
            value: value.to_string(),
            location: loc,
        });
    }
    Ok(())
}

fn push_toml_key(
    occurrences: &mut Vec<Occurrence>,
    path: &Path,
    content: &str,
    entity: EntityType,
    group_id: &str,
    value: &str,
    _search: &str,
) -> Result<()> {
    if let Some(loc) = find_toml_table_key(path, content, value) {
        occurrences.push(Occurrence {
            entity,
            group_id: group_id.to_string(),
            value: value.to_string(),
            location: loc,
        });
    }
    Ok(())
}

fn find_toml_string_value(
    path: &Path,
    content: &str,
    value: &str,
    key_hints: &[&str],
) -> Option<Location> {
    for (idx, line) in content.lines().enumerate() {
        if !key_hints.iter().any(|k| line.contains(k)) {
            continue;
        }
        if let Some(loc) = find_quoted_in_line(path, idx + 1, line, value) {
            return Some(loc);
        }
    }
    for (idx, line) in content.lines().enumerate() {
        if let Some(loc) = find_quoted_in_line(path, idx + 1, line, value) {
            return Some(loc);
        }
    }
    None
}

fn find_quoted_in_line(path: &Path, line: usize, line_text: &str, value: &str) -> Option<Location> {
    let prefix = format!("\"{value}");
    let mut idx = 0;
    while idx < line_text.len() {
        let Some(rel_start) = line_text[idx..].find(&prefix) else {
            return None;
        };
        let start = idx + rel_start;
        let close_idx = start + 1 + value.len();
        if line_text.as_bytes().get(close_idx) == Some(&b'"') {
            return Some(Location {
                file: path.to_path_buf(),
                line: line as u32,
                start_col: (start + 1) as u32,
                end_col: (start + 1 + value.len()) as u32,
            });
        }
        idx = start + 1;
    }
    None
}

fn find_toml_table_key(path: &Path, content: &str, key: &str) -> Option<Location> {
    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with(key) {
            continue;
        }
        let after = trimmed[key.len()..].trim_start();
        if !after.starts_with('=') {
            continue;
        }
        let start = line.find(key)?;
        return Some(Location {
            file: path.to_path_buf(),
            line: (idx + 1) as u32,
            start_col: start as u32,
            end_col: (start + key.len()) as u32,
        });
    }
    None
}

fn find_quoted_or_word_in_line(
    path: &Path,
    content: &str,
    line: usize,
    value: &str,
) -> Option<Location> {
    let line_text = content.lines().nth(line - 1)?;
    if let Some(loc) = find_quoted_in_line(path, line, line_text, value) {
        return Some(loc);
    }
    let start = line_text.find(value)?;
    Some(Location {
        file: path.to_path_buf(),
        line: line as u32,
        start_col: start as u32,
        end_col: (start + value.len()) as u32,
    })
}

fn find_word_in_content(path: &Path, content: &str, word: &str) -> Option<Location> {
    for (idx, line) in content.lines().enumerate() {
        if let Some(start) = line.find(word) {
            return Some(Location {
                file: path.to_path_buf(),
                line: (idx + 1) as u32,
                start_col: start as u32,
                end_col: (start + word.len()) as u32,
            });
        }
    }
    None
}

trait Pipe: Sized {
    fn pipe<F, R>(self, f: F) -> R
    where
        F: FnOnce(Self) -> R,
    {
        f(self)
    }
}

impl<T> Pipe for T {}
