use crate::bindings::host::common::{client as Client, types as CommonTypes};
use crate::bindings::host::privileged::intf as Privileged;
use crate::errors::ErrorType::*;

use url::Url;

// Constructs a subling url of the target. e.g. if target is https://accounts.psibase.io:8080
// and app is "app1", the result is "app1.psibase.io:8080"
pub fn sibling_url_of(app: &str, target: &str) -> Result<String, CommonTypes::Error> {
    let node_url = Url::parse(target).unwrap();
    let host: &str = node_url.host_str().unwrap();
    let host_parts: Vec<&str> = host.split('.').collect();
    assert!(host_parts.len() == 3, "Invalid host structure"); // sub.node.tld
    let mut app_origin = format!("{}.{}", app, host_parts[host_parts.len() - 2..].join("."));

    if let Some(port) = node_url.port() {
        app_origin += &format!(":{}", port);
    }

    Ok(app_origin)
}

pub fn get_assert_top_level_app(
    context: &str,
    privileged_apps: &[&str],
) -> Result<String, CommonTypes::Error> {
    let sender = Client::get_sender_app();
    let top_level_domain = Privileged::get_active_app_domain();

    if sender.app.is_some() && privileged_apps.contains(&sender.app.as_ref().unwrap().as_str()) {
        return Ok(top_level_domain);
    }

    if sender.origin != top_level_domain {
        return Err(Unauthorized.err(&format!(
            "{} can only be called by the top-level app",
            context
        )));
    }

    Ok(top_level_domain)
}
