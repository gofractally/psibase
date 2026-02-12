#[allow(warnings)]
mod bindings {
    use super::Callee;
    wit_bindgen::generate!();
    export!(Callee);
}

use bindings::exports::callee::component::{api, simple_api};
use bindings::callee::component::callbacks;

struct Callee;

impl api::Guest for Callee {
    fn process(callback: callbacks::SomeContract) {
        callback.run("Hello, world!");
    }
}

impl simple_api::Guest for Callee {
    fn hello() {
        println!("Hello, world!");
    }
}
