use crate::EntityType;

pub fn constraint_violation(entity: EntityType, value: &str) -> Option<String> {
    let constraints = entity.constraints();
    for constraint in constraints {
        if let Some(msg) = check_constraint(constraint, value) {
            return Some(msg);
        }
    }
    None
}

fn check_constraint(constraint: &str, value: &str) -> Option<String> {
    match constraint {
        "kebabCase" => validate_kebab_case(value),
        "cargoCrateName" => validate_cargo_crate_name(value),
        "pascalCase" => validate_pascal_case(value),
        "witPackage" => validate_wit_package(value),
        "accountNumber" => validate_account_number(value),
        "accountNumberSubaccount" => validate_account_subaccount(value),
        _ => None,
    }
}

fn validate_kebab_case(value: &str) -> Option<String> {
    if value.is_empty() {
        return Some("name must not be empty".into());
    }
    if value.contains('_') {
        return Some("use kebab-case, not snake_case".into());
    }
    if value.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
        return Some("use kebab-case, not PascalCase".into());
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Some("kebab-case allows only lowercase letters, digits, and hyphens".into());
    }
    if value.starts_with('-') || value.ends_with('-') || value.contains("--") {
        return Some("hyphens must not be leading, trailing, or consecutive".into());
    }
    None
}

fn validate_cargo_crate_name(value: &str) -> Option<String> {
    if value.is_empty() {
        return Some("name must not be empty".into());
    }
    if value.chars().any(|c| c.is_ascii_uppercase()) {
        return Some("Cargo crate names must be lowercase".into());
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Some(
            "Cargo crate names allow only lowercase letters, digits, hyphens, and underscores"
                .into(),
        );
    }
    None
}

fn validate_pascal_case(value: &str) -> Option<String> {
    if value.is_empty() {
        return Some("name must not be empty".into());
    }
    if !value.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
        return Some("published package name must be PascalCase".into());
    }
    if value.contains('-') || value.contains('_') {
        return Some("published package name must be PascalCase without separators".into());
    }
    if !value.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Some("PascalCase allows only letters and digits".into());
    }
    None
}

fn validate_wit_package(value: &str) -> Option<String> {
    let (base, suffix) = value.split_once(':')?;
    if suffix != "plugin" {
        return Some("WIT package must end with `:plugin`".into());
    }
    validate_kebab_case(base)
}

fn validate_account_number(value: &str) -> Option<String> {
    if value.is_empty() {
        return Some("on-chain account name must not be empty".into());
    }
    validate_primary_account(value).err()
}

fn validate_account_subaccount(value: &str) -> Option<String> {
    if value.is_empty() {
        return Some("on-chain query account name must not be empty".into());
    }
    let Some((base, sub)) = value.split_once('+') else {
        return Some("query account must use `{service}+{N}` format".into());
    };
    if sub.is_empty() || !sub.chars().all(|c| c.is_ascii_digit()) {
        return Some("subaccount suffix must be a positive integer".into());
    }
    if sub == "0" {
        return Some("subaccount suffix must be non-zero".into());
    }
    validate_primary_account(base).err()
}

fn validate_primary_account(value: &str) -> Result<(), String> {
    if value.len() > 10 {
        return Err("account name must be at most 10 characters".into());
    }
    if value.starts_with('-') || value.ends_with('-') || value.contains("--") {
        return Err("hyphens must not be leading, trailing, or consecutive".into());
    }
    if value.starts_with("x-") {
        return Err("account names must not begin with `x-`".into());
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("account names allow only `a-z`, `0-9`, and `-`".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EntityType;

    #[test]
    fn kebab_case_accepts_hyphenated_names() {
        assert!(validate_kebab_case("token-swap").is_none());
        assert!(validate_kebab_case("r-name-market").is_none());
    }

    #[test]
    fn kebab_case_rejects_snake_case_and_pascal_case() {
        assert!(validate_kebab_case("token_swap").is_some());
        assert!(validate_kebab_case("TokenSwap").is_some());
    }

    #[test]
    fn cargo_crate_name_accepts_kebab_and_snake() {
        assert!(validate_cargo_crate_name("token-swap-pkg").is_none());
        assert!(validate_cargo_crate_name("chainmail_package").is_none());
    }

    #[test]
    fn cargo_crate_name_rejects_uppercase() {
        assert!(validate_cargo_crate_name("TokenSwap-pkg").is_some());
    }

    #[test]
    fn pascal_case_for_published_packages() {
        assert!(validate_pascal_case("TokenSwap").is_none());
        assert!(validate_pascal_case("token-swap").is_some());
    }

    #[test]
    fn wit_package_requires_plugin_suffix() {
        assert!(validate_wit_package("token-swap:plugin").is_none());
        assert!(validate_wit_package("token-swap:other").is_some());
    }

    #[test]
    fn account_number_rules() {
        assert!(validate_account_number("token-swap").is_none());
        assert!(validate_account_number("diff-adj").is_none());
        assert!(validate_account_number("namemarket").is_none());
        assert!(validate_account_number("toolongname-x").is_some());
        assert!(validate_account_number("-bad").is_some());
        assert!(validate_account_number("x-bad").is_some());
    }

    #[test]
    fn account_subaccount_rules() {
        assert!(validate_account_subaccount("token-swap+1").is_none());
        assert!(validate_account_subaccount("token-swap").is_some());
        assert!(validate_account_subaccount("token-swap+0").is_some());
    }

    #[test]
    fn entity_constraint_integration() {
        assert!(constraint_violation(EntityType::ServiceCrate, "token-swap").is_none());
        assert!(constraint_violation(EntityType::PackageCrate, "chainmail_package").is_none());
        assert!(constraint_violation(EntityType::PackageCrate, "TokenSwap").is_some());
        assert!(constraint_violation(EntityType::OnChainService, "valid-name").is_none());
    }
}
