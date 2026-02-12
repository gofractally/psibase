#[allow(warnings)]
mod bindings {
    use super::Caller;
    wit_bindgen::generate!({
        generate_all,
    });
    export!(Caller);
}
use bindings::Guest as Api;

use bindings::callee::component::api as Callee;
use bindings::exports::callee::component::callbacks::Guest as Callbacks;
use bindings::exports::callee::component::callbacks::GuestSomeContract;


//use exports::callee::plugin::dynamics::{Guest as Dynamics, GuestCallback};
//use bindings::callee::component::api as Callee;

impl GuestSomeContract for Callee::SomeContract {
    #[allow(async_fn_in_trait)]
    fn new() -> Self {
        Callee::SomeContract::new()
    }

    #[allow(async_fn_in_trait)]
    fn run(&self, message: String) -> () {
        println!("Hello, world! {}", message);
    }
}

// struct MyCallbackType;
// impl GuestCallback for MyCallbackType {
//     fn new() -> Self { MyCallbackType {} }

//     fn run(&self, message: String) -> Option<String> {
//         println!("Hello, world! {}", message);
//         Some("Success".to_string())
//     }
// }

struct Caller;

impl Api for Caller {
    fn hello() {
        //Callee::hello_world();
        println!("Hello, world!");

        Callee::process(Callee::SomeContract::new());
    }
}

impl Callbacks for Caller {
    type SomeContract = Callee::SomeContract;
}
// impl Dynamics for Caller {
//     type Callback = MyCallbackType;
// }
