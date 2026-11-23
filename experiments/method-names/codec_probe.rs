//! Batch probe using the actual current Rust codec modules, without pulling in
//! unrelated workspace services. One input line -> input, u64, decoded, hash TSV.
#[path = "../../rust/psibase_names/src/constants.rs"]
mod constants;
#[path = "../../rust/psibase_names/src/frequency.rs"]
mod frequency;
#[path = "../../rust/psibase_names/src/method_number.rs"]
mod method_number;
#[path = "../../rust/psibase_names/src/method_to_number_converter.rs"]
mod method_to_number_converter;
#[path = "../../rust/psibase_names/src/number_to_string_converter.rs"]
mod number_to_string_converter;

use std::io::{self, BufRead};

fn main() {
    // Invalid explicit hash strings can panic in the current codec. Report that
    // fact as a separate row rather than abandoning the rest of a corpus.
    std::panic::set_hook(Box::new(|_| {}));
    for line in io::stdin().lock().lines() {
        let name = line.expect("read input");
        match std::panic::catch_unwind(|| {
            let value = method_number::method_number_from_str(&name);
            let decoded = method_number::method_number_to_string(value);
            (value, decoded)
        }) {
            Ok((value, decoded)) => println!(
                "{}\t{}\t{}\t{}",
                name,
                value,
                decoded,
                u8::from(value & (1u64 << 56) != 0)
            ),
            Err(_) => println!("{}\tPANIC\tPANIC\tPANIC", name),
        }
    }
}
