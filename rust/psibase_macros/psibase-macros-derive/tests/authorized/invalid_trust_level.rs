use psibase_macros_derive::authorized;

struct MyPlugin;

impl MyPlugin {
    #[authorized(Invalid)]
    fn my_fn() {}
}

fn main() {}
