mod bindings;

use bindings::component::account_sys::imports;
use bindings::component::account_sys::types::Funccallparams;
use bindings::component::account_sys::types::User;

use bindings::Guest;

struct Component;

impl Guest for Component {
    fn numbers(num1: u8, num2: u8, doubleup: bool) -> String {
        let mutiplier: u8 = if doubleup { 2 } else { 1 };
        let y = imports::transfer("bobby", 117);

        println!("{:?} logged on rust from transfer", y);
        struct Par {
            service: String,
            method: String,
            params: String,
        }
        let test_params = Funccallparams {
            service: "test_service".to_string(),
            method: "test_method".to_string(),
            params: "test_params".to_string(),
        };
        let _x = imports::add_to_tx(&test_params);

        format!(
            "Hello, {} + {} equals {}. {}",
            num1,
            num2,
            (num1 + num2) * mutiplier,
            y
        )
    }

    fn strings(word: String) -> String {
        let test_params = Funccallparams {
            service: "test_service".to_string(),
            method: "test_method".to_string(),
            params: "test_params".to_string(),
        };
        let x = imports::funccall(&test_params);
        println!("The x, 'is a thing.. {:?}", x);
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
