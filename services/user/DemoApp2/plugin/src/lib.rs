mod bindings;

use bindings::component::demoapp2::imports;
// use bindings::component::demoapp2::types::Funccallparams;

use bindings::Guest;

struct Component;

impl Guest for Component {
    fn callintoplugin() -> String {
        let logged_in_user = imports::get_logged_in_user();
        println!("logged_in_user x, 'is a thing.. {:?}", logged_in_user);
        return logged_in_user + " is logged in";
    }
}
