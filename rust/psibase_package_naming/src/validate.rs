use crate::constraints::constraint_violation;
use crate::{Diagnostic, EntityType, Occurrence, PackageScan, Severity};
use std::path::Path;

pub fn validate(scan: &PackageScan) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    for occ in &scan.occurrences {
        if let Some(msg) = constraint_violation(occ.entity, &occ.value) {
            diagnostics.push(Diagnostic {
                severity: Severity::Error,
                code: constraint_code(occ.entity).into(),
                message: format!("{}: {}", occ.entity.label(), msg),
                location: occ.location.clone(),
                entity: Some(occ.entity),
                group_id: Some(occ.group_id.clone()),
            });
        }
    }

    let mut groups: std::collections::HashMap<&str, Vec<&Occurrence>> =
        std::collections::HashMap::new();
    for occ in &scan.occurrences {
        groups.entry(&occ.group_id).or_default().push(occ);
    }

    for (group_id, members) in groups {
        if members.len() < 2 {
            continue;
        }
        let expected = &members[0].value;
        for occ in &members[1..] {
            if &occ.value != expected {
                diagnostics.push(Diagnostic {
                    severity: Severity::Error,
                    code: "correlationMismatch".into(),
                    message: format!(
                        "{} mismatch: expected `{}` (from {}), found `{}`",
                        members[0].entity.label(),
                        expected,
                        format_relative_location(&scan.package_root, &members[0].location),
                        occ.value
                    ),
                    location: occ.location.clone(),
                    entity: Some(occ.entity),
                    group_id: Some(group_id.to_string()),
                });
            }
        }
    }

    validate_query_subaccount_transform(scan, &mut diagnostics);
    diagnostics
}

fn constraint_code(entity: EntityType) -> &'static str {
    match entity {
        EntityType::OnChainService | EntityType::OnChainQuery => "invalidAccountName",
        _ => "invalidName",
    }
}

fn validate_query_subaccount_transform(scan: &PackageScan, diagnostics: &mut Vec<Diagnostic>) {
    let mut service_accounts: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for occ in &scan.occurrences {
        if occ.entity == EntityType::OnChainService {
            let service_key = occ.group_id.strip_prefix("on_chain_service:").unwrap_or("");
            service_accounts.insert(service_key.to_string(), occ.value.clone());
        }
    }

    for occ in &scan.occurrences {
        if occ.entity != EntityType::OnChainQuery {
            continue;
        }
        let service_key = occ.group_id.strip_prefix("on_chain_query:").unwrap_or("");
        let Some(base) = service_accounts.get(service_key) else {
            continue;
        };
        let Some((query_base, suffix)) = occ.value.split_once('+') else {
            continue;
        };
        if query_base != base {
            diagnostics.push(Diagnostic {
                severity: Severity::Error,
                code: "correlationMismatch".into(),
                message: format!(
                    "On-chain query account must use base `{}` (from on-chain service), found `{}`",
                    base, query_base
                ),
                location: occ.location.clone(),
                entity: Some(EntityType::OnChainQuery),
                group_id: Some(occ.group_id.clone()),
            });
        } else if suffix != "1" {
            // +1 is convention only; any non-zero suffix is valid if base matches
        }
    }
}

fn format_package_relative_path(package_root: &Path, file: &Path) -> String {
    let rel = path_relative_from(package_root, file);
    if rel == "." {
        "./".into()
    } else {
        format!("./{rel}")
    }
}

fn format_relative_location(package_root: &Path, location: &crate::Location) -> String {
    format!(
        "{}:{}",
        format_package_relative_path(package_root, location.file.as_path()),
        location.line
    )
}

fn path_relative_from(base: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(base) {
        let rel = rel.to_string_lossy().replace('\\', "/");
        return if rel.is_empty() { ".".into() } else { rel };
    }

    let base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());

    let base_parts: Vec<_> = base.components().collect();
    let path_parts: Vec<_> = path.components().collect();
    let mut shared = 0;
    while shared < base_parts.len()
        && shared < path_parts.len()
        && base_parts[shared] == path_parts[shared]
    {
        shared += 1;
    }

    let mut rel = std::path::PathBuf::new();
    for _ in shared..base_parts.len() {
        rel.push("..");
    }
    for part in &path_parts[shared..] {
        rel.push(part);
    }
    rel.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn package_relative_path_stays_inside_package_root() {
        let root = PathBuf::from("/repo/packages/user/TokenSwap");
        let file = root.join("service/Cargo.toml");
        assert_eq!(
            format_package_relative_path(&root, &file),
            "./service/Cargo.toml"
        );
    }

    #[test]
    fn package_relative_path_reaches_outside_package_root() {
        let root = PathBuf::from("/repo/packages/user/TokenSwap");
        let file = PathBuf::from("/repo/CMakeLists.txt");
        assert_eq!(
            format_package_relative_path(&root, &file),
            "./../../../CMakeLists.txt"
        );
    }

    #[test]
    fn relative_location_includes_line_number() {
        let root = PathBuf::from("/repo/packages/user/TokenSwap");
        let file = root.join("service/Cargo.toml");
        let location = crate::Location {
            file,
            line: 24,
            start_col: 0,
            end_col: 1,
        };
        assert_eq!(
            format_relative_location(&root, &location),
            "./service/Cargo.toml:24"
        );
    }
}
