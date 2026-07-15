//! Generate Psibase account names that round-trip account_number compression.
//!
//! Usage:
//!   cargo run --manifest-path e2e/tools/e2e-account-names/Cargo.toml -- \
//!     /path/to/verified-e2e-account-names.json [count]

use psibase_names::{account_number_from_str, account_number_to_string};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::Path;

fn is_valid_account_name(s: &str) -> bool {
    if s.len() != 10 {
        return false;
    }
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() {
        return false;
    }
    if !chars.all(|c| c.is_ascii_lowercase()) {
        return false;
    }
    let v = account_number_from_str(s);
    v != 0 && account_number_to_string(v) == s
}

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1);
        (self.0 >> 32) as u32
    }

    fn random_letters(&mut self, len: usize) -> String {
        let mut s = String::with_capacity(len);
        for i in 0..len {
            let alphabet = if i == 0 { 26u32 } else { 26 };
            s.push((b'a' + (self.next_u32() % alphabet) as u8) as char);
        }
        s
    }
}

fn measure_random_letter_success(trials: u32) -> f64 {
    let mut rng = Rng::new(0x_e2e_2026);
    let mut ok = 0u32;
    for _ in 0..trials {
        let name = rng.random_letters(10);
        if is_valid_account_name(&name) {
            ok += 1;
        }
    }
    ok as f64 / trials as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_generated_names_round_trip_and_differ() {
        let mut rng = Rng::new(0xe2e2026);
        let mut valid: Vec<String> = Vec::new();
        for _ in 0..20_000 {
            let name = rng.random_letters(10);
            if is_valid_account_name(&name) {
                valid.push(name);
                if valid.len() >= 2 {
                    break;
                }
            }
        }
        assert!(
            valid.len() >= 2,
            "expected at least two valid random account names"
        );
        assert_ne!(
            account_number_from_str(&valid[0]),
            account_number_from_str(&valid[1])
        );
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let out_path = args
        .get(1)
        .map(|s| s.as_str())
        .unwrap_or("verified-e2e-account-names.json");
    let count: usize = args
        .get(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(512);

    let random_rate = measure_random_letter_success(10_000);
    eprintln!(
        "random 10-letter lowercase names: {:.1}% pass compression round-trip (10k samples)",
        random_rate * 100.0
    );

    let mut names = HashSet::new();
    let mut rng = Rng::new(0x_e2e_2026_512);

    while names.len() < count {
        let candidate = rng.random_letters(10);
        if is_valid_account_name(&candidate) {
            names.insert(candidate);
        }
    }

    let mut list: Vec<String> = names.into_iter().collect();
    list.sort();

    let mut json = String::from("[\n");
    for (i, name) in list.iter().enumerate() {
        if i > 0 {
            json.push(',');
            json.push('\n');
        }
        json.push_str("  \"");
        json.push_str(name);
        json.push('"');
    }
    json.push_str("\n]\n");

    let path = Path::new(out_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).expect("create output dir");
        }
    }
    fs::write(path, json).expect("write output");
    eprintln!("wrote {} verified names to {}", list.len(), out_path);
}
