use psibase_macros_derive::authorized;

struct MyPlugin;

impl MyPlugin {
    #[authorized(whitelist = ["app"])]
    fn my_fn() {}
}

fn main() {}
