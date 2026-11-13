//! TEST ONLY: see ../README.md.
#[allow(warnings)]
mod bindings;

use bindings::exports::host::e2e_probe::api::Guest as Api;
use bindings::exports::host::e2e_probe::res::{Guest as Res, GuestEagerProbe, GuestLazyProbe};
use bindings::host::client::api as Client;
use bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use bindings::host::prompt::api as Prompt;
use bindings::host::types::types::{Error, PluginId};
use bindings::supervisor::bridge::intf as Supervisor;
use bindings::supervisor::bridge::types::{BodyTypes, Header, HttpRequest};

struct Probe;

fn err(message: String) -> Error {
    Error {
        code: 0,
        producer: PluginId {
            service: "host".to_string(),
            plugin: "e2e-probe".to_string(),
        },
        message,
    }
}

/// GET `endpoint` on the caller app's URL through the bridge (JSPI-suspending).
fn get(endpoint: &str) -> Result<String, Error> {
    let base = Client::get_app_url(&Client::get_sender());
    let req = HttpRequest {
        uri: format!(
            "{}/{}",
            base.trim_end_matches('/'),
            endpoint.trim_start_matches('/')
        ),
        method: "GET".to_string(),
        headers: vec![Header {
            key: "Accept".to_string(),
            value: "application/json".to_string(),
        }],
        body: None,
    };
    let res = Supervisor::send_request(&req, false).map_err(|e| Error {
        code: e.code,
        producer: PluginId {
            service: e.producer.service,
            plugin: e.producer.plugin,
        },
        message: e.message,
    })?;
    match res.body {
        Some(BodyTypes::Json(s)) | Some(BodyTypes::Text(s)) => Ok(s),
        Some(BodyTypes::Bytes(b)) => String::from_utf8(b).map_err(|e| err(e.to_string())),
        Some(BodyTypes::Graphql(s)) => Ok(s),
        None => Ok(String::new()),
    }
}

const DB: Database = Database {
    mode: DbMode::NonTransactional,
    duration: StorageDuration::Persistent,
};

impl Api for Probe {
    fn fetch_then_prompt(endpoint: String) -> Result<String, Error> {
        let body = get(&endpoint)?;
        // Resumed: now raise a prompt the real way (host:prompt -> bridge
        // request-prompt -> Supervisor throws PromptSignal).
        Prompt::prompt("e2eprobe", None);
        Ok(body)
    }

    fn bucket_across_fetch(
        endpoint: String,
        key: String,
        value: String,
    ) -> Result<Option<String>, Error> {
        let bucket = Bucket::new(DB, "e2e_probe");
        get(&endpoint)?;
        bucket.set(&key, value.as_bytes());
        Ok(bucket
            .get(&key)
            .map(|v| String::from_utf8_lossy(&v).into_owned()))
    }

    fn whoami() -> Vec<String> {
        let mut v = Supervisor::service_stack();
        v.push(Client::get_sender());
        v
    }
}

pub struct LazyProbe {
    endpoint: String,
}

impl GuestLazyProbe for LazyProbe {
    fn new(endpoint: String) -> Self {
        Self { endpoint }
    }

    fn fetch(&self) -> Result<String, Error> {
        get(&self.endpoint)
    }
}

pub struct EagerProbe {
    body: String,
}

impl GuestEagerProbe for EagerProbe {
    fn new(endpoint: String) -> Self {
        Self {
            body: get(&endpoint).expect("eager-probe constructor fetch failed"),
        }
    }

    fn body(&self) -> String {
        self.body.clone()
    }
}

impl Res for Probe {
    type LazyProbe = LazyProbe;
    type EagerProbe = EagerProbe;
}

bindings::export!(Probe with_types_in bindings);
