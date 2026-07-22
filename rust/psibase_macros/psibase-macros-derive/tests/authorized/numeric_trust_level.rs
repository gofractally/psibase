use psibase_macros_derive::authorized;

struct MyPlugin;

impl MyPlugin {
    #[authorized(42)]
    fn my_fn() {}
}

fn main() {}
