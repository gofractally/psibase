use psibase_macros_derive::authorized;

struct MyPlugin;

impl MyPlugin {
    #[authorized]
    fn my_fn() {}
}

fn main() {}
