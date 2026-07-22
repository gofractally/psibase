use anyhow::{anyhow, Context};
use clap::Parser;
use psibase::{AccountNumber, Meta, PackageRef, PackagedService, MAX_ACCOUNT_NAME_LENGTH};
use std::collections::BTreeSet;
use std::fs::File;
use std::io::{BufReader, Write};
use std::path::PathBuf;
use zip::write::{SimpleFileOptions, ZipWriter};

/// Groups of spellings that are easily mistaken for each other when
/// rendered in a subdomain or account name. Every member of a group can be
/// substituted for any other member, including multi-character sequences
/// like `rn`/`m`.
const CONFUSABLE_CLASSES: &[&[&str]] = &[
    &["i", "l", "1"],
    &["o", "0"],
    &["rn", "m"],
    &["vv", "w"],
];

/// Generates a psibase package that reserves account names which could be
/// used to impersonate apps or system accounts.
///
/// The tool collects account names from the given .psi package files and from
/// an optional text file of generic names, generates every confusable
/// variant (swapping i/l/1, o/0, rn/m, and vv/w), and writes a meta-only .psi package
/// that lists them all as accounts. Installing that package creates the
/// accounts owned by the installer, making them unclaimable by ordinary
/// users. It does not block later installation of the real packages, since
/// account creation during installation accepts existing accounts owned by
/// the installer.
///
/// Note that the reservation is a snapshot: names introduced by packages
/// added to the network later are not protected until an updated
/// reserved-names package is generated and installed.
#[derive(Parser)]
#[command(name = "reserved-names", verbatim_doc_comment)]
struct Args {
    /// Paths to .psi package files whose account names should be protected
    #[arg(required_unless_present = "names")]
    packages: Vec<PathBuf>,

    /// Text file with additional names to reserve, one per line
    /// (blank lines and lines starting with '#' are ignored)
    #[arg(long)]
    names: Option<PathBuf>,

    /// Name of the generated package
    #[arg(long, default_value = "ReservedNames")]
    name: String,

    /// Version of the generated package (required with --output)
    #[arg(long)]
    version: Option<String>,

    /// Description of the generated package
    #[arg(
        long,
        default_value = "Reserves account names that could be used to impersonate apps or system accounts"
    )]
    description: String,

    /// Path of the .psi package file to write; if omitted, the reserved
    /// names are printed to stdout instead
    #[arg(short, long)]
    output: Option<PathBuf>,
}

/// All spellings of `name` obtained by substituting confusable spellings,
/// including `name` itself.
fn confusable_variants(name: &str) -> Vec<String> {
    fn expand(rest: &str, prefix: &str, results: &mut BTreeSet<String>) {
        let Some(first) = rest.chars().next() else {
            results.insert(prefix.to_string());
            return;
        };
        // Leave the next character as-is. For multi-character spellings this
        // branch is what allows overlapping matches to be found (e.g. both
        // occurrences of "vv" in "vvv").
        let mut literal = prefix.to_string();
        literal.push(first);
        expand(&rest[first.len_utf8()..], &literal, results);
        // Replace any confusable spelling that starts here with each other
        // member of its class.
        for class in CONFUSABLE_CLASSES {
            for spelling in *class {
                if let Some(tail) = rest.strip_prefix(spelling) {
                    for replacement in *class {
                        expand(tail, &format!("{prefix}{replacement}"), results);
                    }
                }
            }
        }
    }
    let mut results = BTreeSet::new();
    expand(name, "", &mut results);
    results.into_iter().collect()
}

struct Generated {
    reserved: Vec<String>,
    /// Variants that were dropped because they don't fit in an AccountNumber
    skipped: Vec<String>,
}

/// Generates the reserved name list: every confusable variant of `seeds`
/// (including the seeds themselves), minus variants that exceed the maximum
/// account name length or don't round-trip through the AccountNumber
/// encoding.
///
/// Names that real packages create are reserved too. This doesn't prevent
/// installing those packages later: account creation during installation
/// uses auth-delegate's newAccount, which accepts an existing account as
/// long as it is owned by the installer.
fn generate(seeds: &BTreeSet<String>) -> Generated {
    let mut reserved = BTreeSet::new();
    let mut skipped = BTreeSet::new();
    for seed in seeds {
        for variant in confusable_variants(seed) {
            if reserved.contains(&variant) {
                continue;
            }
            // Substitutions like m -> rn can push a variant past the
            // maximum name length; such variants simply don't exist as
            // account names, so drop them silently.
            if variant.len() > MAX_ACCOUNT_NAME_LENGTH as usize {
                continue;
            }
            if AccountNumber::from_exact(&variant).is_ok() {
                reserved.insert(variant);
            } else {
                skipped.insert(variant);
            }
        }
    }
    Generated {
        reserved: reserved.into_iter().collect(),
        skipped: skipped.into_iter().collect(),
    }
}

fn read_names_file(path: &PathBuf) -> Result<Vec<String>, anyhow::Error> {
    let contents = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    let mut names = vec![];
    for line in contents.lines() {
        let name = line.trim();
        if name.is_empty() || name.starts_with('#') {
            continue;
        }
        AccountNumber::from_exact(name)
            .map_err(|_| anyhow!("Invalid account name {} in {}", name, path.display()))?;
        names.push(name.to_string());
    }
    Ok(names)
}

/// Writes a meta-only .psi package (a zip archive containing just meta.json)
/// whose accounts are the reserved names.
fn write_package(args: &Args, reserved: &[String]) -> Result<(), anyhow::Error> {
    let path = args.output.as_ref().unwrap();
    let version = args
        .version
        .as_ref()
        .ok_or_else(|| anyhow!("--version is required when writing a package with --output"))?;

    let meta = Meta {
        name: args.name.clone(),
        version: version.clone(),
        scope: "network".to_string(),
        description: args.description.clone(),
        // Account creation during installation goes through these services
        depends: ["Accounts", "AuthDelegate"]
            .iter()
            .map(|name| PackageRef {
                name: name.to_string(),
                version: "*".to_string(),
            })
            .collect(),
        accounts: reserved
            .iter()
            .map(|name| name.parse().unwrap())
            .collect(),
        services: vec![],
        exports: vec![],
    };

    let file =
        File::create(path).with_context(|| format!("Failed to create {}", path.display()))?;
    let mut out = ZipWriter::new(file);
    out.start_file("meta.json", SimpleFileOptions::default())?;
    write!(out, "{}", serde_json::to_string(&meta)?)?;
    out.finish()?;
    Ok(())
}

fn main() -> Result<(), anyhow::Error> {
    let args = Args::parse();

    let mut seeds = BTreeSet::new();
    let mut package_accounts = 0;
    for path in &args.packages {
        let file =
            File::open(path).with_context(|| format!("Failed to open {}", path.display()))?;
        let package = PackagedService::new(BufReader::new(file))
            .with_context(|| format!("Failed to read package {}", path.display()))?;
        for account in package.get_accounts() {
            // Reserving the base account is sufficient for subaccounts,
            // since creating a subaccount requires the base account's
            // approval.
            let name = account.base().to_string();
            // The 'x-' prefix is reserved for infrastructure providers and
            // cannot be claimed by ordinary users, so there is nothing to
            // protect. Confusable variants of an 'x-' name still start with
            // 'x-', so they are covered by the same rule.
            if name.starts_with("x-") {
                continue;
            }
            if seeds.insert(name) {
                package_accounts += 1;
            }
        }
    }

    if let Some(names) = &args.names {
        seeds.extend(read_names_file(names)?);
    }

    let generated = generate(&seeds);

    if !generated.skipped.is_empty() {
        eprintln!(
            "warning: {} variant(s) skipped because they don't fit in an account number:",
            generated.skipped.len()
        );
        for name in &generated.skipped {
            eprintln!("  {}", name);
        }
    }
    eprintln!(
        "{} account name(s) from {} package(s), {} name(s) reserved",
        package_accounts,
        args.packages.len(),
        generated.reserved.len()
    );

    if let Some(output) = &args.output {
        write_package(&args, &generated.reserved)?;
        eprintln!("Wrote {}", output.display());
    } else {
        for name in &generated.reserved {
            println!("{}", name);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn variants_of_plain_name_is_identity() {
        assert_eq!(confusable_variants("abc"), vec!["abc"]);
    }

    #[test]
    fn variants_expand_all_confusable_positions() {
        // 'o' has 2 spellings, 'i' and 'l' have 3 each: 2 * 3 * 3 = 18
        let result: BTreeSet<String> = confusable_variants("oil").into_iter().collect();
        assert_eq!(result.len(), 18);
        assert!(result.contains("oil"));
        assert!(result.contains("0il"));
        assert!(result.contains("o1l"));
        assert!(result.contains("0l1"));
    }

    #[test]
    fn originals_are_reserved_too() {
        let seeds = set(&["sites"]);
        let generated = generate(&seeds);
        assert!(generated.reserved.contains(&"sites".to_string()));
        assert!(generated.reserved.contains(&"s1tes".to_string()));
        assert!(generated.reserved.contains(&"sltes".to_string()));
    }

    #[test]
    fn all_variants_are_reserved() {
        let seeds = set(&["root"]);
        let generated = generate(&seeds);
        assert!(generated.reserved.contains(&"root".to_string()));
        assert!(generated.reserved.contains(&"r00t".to_string()));
        assert!(generated.reserved.contains(&"ro0t".to_string()));
        assert!(generated.reserved.contains(&"r0ot".to_string()));
        assert_eq!(generated.reserved.len(), 4);
    }

    #[test]
    fn reserved_names_round_trip() {
        let seeds = set(&["billing", "official", "localhost"]);
        let generated = generate(&seeds);
        for name in &generated.reserved {
            assert!(AccountNumber::from_exact(name).is_ok());
        }
    }

    #[test]
    fn multi_char_confusables_expand_both_ways() {
        let result: BTreeSet<String> = confusable_variants("market").into_iter().collect();
        assert!(result.contains("market"));
        assert!(result.contains("rnarket"));

        let result: BTreeSet<String> = confusable_variants("corn").into_iter().collect();
        assert!(result.contains("corn"));
        assert!(result.contains("com"));
        assert!(result.contains("c0m"));
        assert!(result.contains("c0rn"));

        let result: BTreeSet<String> = confusable_variants("wow").into_iter().collect();
        assert!(result.contains("wow"));
        assert!(result.contains("vvow"));
        assert!(result.contains("wovv"));
        assert!(result.contains("vv0vv"));
    }

    #[test]
    fn overlapping_multi_char_matches_are_found() {
        // "vvv" contains two overlapping "vv" sequences; both replacements
        // must be generated.
        let result: BTreeSet<String> = confusable_variants("vvv").into_iter().collect();
        assert!(result.contains("vvv"));
        assert!(result.contains("wv"));
        assert!(result.contains("vw"));
        // "rnm" -> expanding m to rn and rn to m in all combinations
        let result: BTreeSet<String> = confusable_variants("rnm").into_iter().collect();
        assert!(result.contains("rnm"));
        assert!(result.contains("mm"));
        assert!(result.contains("rnrn"));
        assert!(result.contains("mrn"));
    }

    #[test]
    fn over_length_variants_are_dropped() {
        // "mmmmmmmmm" is 9 chars; replacing two or more m's with rn exceeds
        // the 10-character maximum and must be dropped, not reported as
        // skipped.
        let seeds = set(&["mmmmmmmmm"]);
        let generated = generate(&seeds);
        assert!(generated.reserved.contains(&"mmmmmmmmm".to_string()));
        assert!(generated.reserved.contains(&"rnmmmmmmmm".to_string()));
        for name in &generated.reserved {
            assert!(name.len() <= MAX_ACCOUNT_NAME_LENGTH as usize);
            assert!(AccountNumber::from_exact(name).is_ok());
        }
        assert!(generated.skipped.is_empty());
    }
}
