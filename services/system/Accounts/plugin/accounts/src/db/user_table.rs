use crate::bindings::{
    accounts::plugin::types::AppDetails, clientdata::plugin::keyvalue as Keyvalue,
};
use psibase::fracpack::{Pack, Unpack};

use crate::db::keys::DbKeys;

#[derive(Pack, Unpack, Default)]
struct ConnectedApps {
    apps: Vec<String>,
}

impl ConnectedApps {
    pub fn add(&mut self, app: &AppDetails) {
        let app = app.app.as_ref();

        if app.is_none() {
            return;
        }

        let app = app.unwrap();

        if self.apps.contains(app) {
            return;
        }

        self.apps.push(app.clone());
    }
}

// A database with a separate namespace for each app within the `accounts` namespace
pub struct UserTable {
    user: String,
}
impl UserTable {
    pub fn new(user: &str) -> Self {
        Self {
            user: user.to_string(),
        }
    }

    fn prefixed_key(&self, key: &str) -> String {
        self.user.to_string() + "." + key
    }

    pub fn add_connected_app(&self, app: &AppDetails) {
        let connected_apps = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_APPS));
        let mut connected_apps = connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_apps.add(app);
        Keyvalue::set(
            &self.prefixed_key(DbKeys::CONNECTED_APPS),
            &connected_apps.packed(),
        )
        .expect("Failed to set connected apps");
    }

    pub fn get_connected_apps(&self) -> Vec<String> {
        let connected_apps = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_APPS));
        connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .apps
    }
}
