#[allow(warnings)]
mod bindings;
use bindings::*;

mod helpers;
use helpers::*;

use exports::host::client::api::Guest as Api;
use supervisor::bridge::intf as Supervisor;
use url::Url;

struct HostClient;

impl Api for HostClient {
    fn get_sender() -> String {
        // Exported for use by other plugins who want to know which app called *them*.
        // Look back 2 frames: the client hop is frame 1.
        let frame = 2;
        let stack = get_callstack();
        assert!(stack.len() >= frame);
        stack[stack.len() - frame].clone()
    }

    fn get_receiver() -> String {
        let stack = get_callstack();
        assert!(stack.len() > 0);
        stack.last().unwrap().clone()
    }

    fn get_app_url(app: String) -> String {
        let root = Supervisor::get_root_domain();
        let mut url = Url::parse(&root).unwrap();
        url.set_host(Some(&format!("{}.{}", app, url.host_str().unwrap())))
            .unwrap();
        url.to_string().trim_end_matches('/').to_string()
    }

    fn get_root_domain() -> String {
        Supervisor::get_root_domain()
    }

    fn get_active_app() -> String {
        let stack = get_callstack();
        assert!(stack.len() > 0);
        stack.into_iter().next().unwrap()
    }
}

bindings::export!(HostClient with_types_in bindings);
