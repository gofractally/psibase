//! Line-oriented conformance probe; no application-specific schema is needed.
use psibase_names::{action_name_from_str, action_name_to_string, ACTION_NAME_MODEL_SHA256};
use std::io::{self, BufRead};
fn main() {
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode == "--model-hash" {
        println!("{ACTION_NAME_MODEL_SHA256}");
        return;
    }
    for line in io::stdin().lock().lines() {
        let line = line.expect("stdin");
        if mode == "--decode" {
            match line
                .parse::<u64>()
                .ok()
                .and_then(|n| action_name_to_string(n).ok())
            {
                Some(name) => println!("{line}\t{name}"),
                None => println!("{line}\tERROR"),
            }
        } else {
            match action_name_from_str(&line) {
                Ok(value) => println!(
                    "{}\t{}\t{}\t{}",
                    line,
                    value,
                    action_name_to_string(value).unwrap(),
                    u8::from(value >> 62 == 3)
                ),
                Err(_) => println!("{line}\tERROR"),
            }
        }
    }
}
