use anyhow::{Context, Result};
use psibase_package_naming::{check_package, Diagnostic, Severity};
use std::path::{Path, PathBuf};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|a| a == "--json");
    let paths: Vec<PathBuf> = if args.iter().all(|a| a == "--json") || args.is_empty() {
        vec![std::env::current_dir()?]
    } else {
        args.iter()
            .filter(|a| *a != "--json")
            .map(PathBuf::from)
            .collect()
    };

    let mut all = Vec::new();
    for path in paths {
        let package_root = find_package_root(&path)?;
        let cmake_roots = cmake_search_roots(&package_root);
        let refs: Vec<&Path> = cmake_roots.iter().map(|p| p.as_path()).collect();
        let mut diagnostics = check_package(&package_root, &refs)
            .with_context(|| format!("check {}", package_root.display()))?;
        all.append(&mut diagnostics);
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&all)?);
    } else {
        print_diagnostics(&all);
    }

    if all.iter().any(|d| d.severity == Severity::Error) {
        std::process::exit(1);
    }
    Ok(())
}

fn print_diagnostics(diagnostics: &[Diagnostic]) {
    if diagnostics.is_empty() {
        println!("psibase package naming: ok");
        return;
    }
    for d in diagnostics {
        eprintln!(
            "{}:{}:{}: {}: {}",
            d.location.file.display(),
            d.location.line,
            d.location.start_col + 1,
            d.code,
            d.message
        );
    }
}

fn find_package_root(start: &Path) -> Result<PathBuf> {
    let mut current = if start.is_dir() {
        start.to_path_buf()
    } else {
        start
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| start.to_path_buf())
    };
    loop {
        let cargo = current.join("Cargo.toml");
        if cargo.is_file() {
            let content = std::fs::read_to_string(&cargo)?;
            let value: toml::Value = toml::from_str(&content)?;
            if value
                .get("package")
                .and_then(|p| p.get("metadata"))
                .and_then(|m| m.get("psibase"))
                .and_then(|p| p.get("package-name"))
                .is_some()
            {
                return Ok(current);
            }
        }
        if !current.pop() {
            break;
        }
    }
    Err(anyhow::anyhow!(
        "no psibase package root found near {}",
        start.display()
    ))
}

fn cmake_search_roots(package_root: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut current = package_root.to_path_buf();
    while current.pop() {
        if current.join("CMakeLists.txt").is_file() {
            roots.push(current.clone());
        }
    }
    roots
}
