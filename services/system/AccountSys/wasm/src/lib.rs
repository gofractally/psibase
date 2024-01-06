cargo_component_bindings::generate!();

use bindings::Guest;

struct Component;

impl Guest for Component {
    fn numbers(num1: u8, num2: u8, doubleup: bool) -> String {
        let mutiplier: u8 = if doubleup { 2 } else { 1 };
        format!(
            "Hello, {} + {} equals {}",
            num1,
            num2,
            (num1 + num2) * mutiplier
        )
    }

    fn strings(word: String) -> String {
        bindings::component::account_sys::imports::prnt("Calling prnt from Rust");
        format!("The word you gave me was {}", word)
    }

    fn hire(user: User) -> String {
        format!("{} was hired", user.name)
    }

    fn peoples(users: Vec<User>) -> String {
        format!("I got users")
    }

    fn call() -> String {
        "DerpCasey".to_string()
    }
}
