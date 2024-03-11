mod bindings;

use bindings::component::demoapp1::demoapp2;
use bindings::Guest;

use bindings::exports::component::demoapp1::inv::Guest as InviteInterface;
use bindings::invites;


struct Component;

impl Guest for Component {
    fn helloworld() -> String {
        let barry = demoapp2::callintoplugin();
        format!("barry is {}", barry)
    }
}

impl InviteInterface for Component {
    fn generate_invite(subpath: String) -> Result<String, String> {
        Ok(invites::plugin::inviter::generate_invite(&subpath)?)
    }
}

bindings::export!(Component with_types_in bindings);
