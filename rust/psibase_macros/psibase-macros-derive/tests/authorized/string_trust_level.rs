use psibase_macros_derive::authorized;

struct MyPlugin;

impl MyPlugin {
    #[authorized("Medium")]
    fn my_fn() {}
}

fn main() {}
