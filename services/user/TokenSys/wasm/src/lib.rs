mod bindings;

use bindings::component::token_sys::types::Funccallparams;

use bindings::component::token_sys::imports;

use bindings::Guest;

struct Component;

impl Guest for Component {
    /// Say hello!
    fn transfer(to: String, amount: u32) -> String {
        let logged_in_user = imports::get_logged_in_user();

        println!("logged_in_user x, 'is a thing.. {:?}", logged_in_user);

        let test_params = Funccallparams {
            service: "test_service".to_string(),
            method: "test_method".to_string(),
            params: "test_paramsjj".to_string(),
        };
        imports::add_to_tx(&test_params);

        // println!("i got from the func {}", logged_in_user);

        format!(
            "I am {} telling yet and I am gonna send {} tokens to {}",
            logged_in_user, amount, to
        )
    }
}
