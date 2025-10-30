use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use psibase::fracpack::{Pack, Unpack};

use crate::db::keys::DbKeys;

#[derive(Pack, Unpack, Default)]
struct ConnectedApps {
    apps: Vec<String>,
}

impl ConnectedApps {
    pub fn add(&mut self, app: &str) {
        let app = app.to_string();
        if self.apps.contains(&app) {
            return;
        }

        self.apps.push(app);
    }

    pub fn remove(&mut self, app: &str) {
        let app = app.to_string();
        if let Some(idx) = self.apps.iter().position(|a| a == &app) {
            self.apps.swap_remove(idx);
        }
    }
}

// A database with a separate namespace for each user within the `accounts` namespace
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

    pub fn add_connected_app(&self, app: &str) {
        let connected_apps = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_APPS));
        let mut connected_apps = connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default();
        if connected_apps.apps.contains(&app.to_string()) {
            return;
        }
        connected_apps.add(app);
        Keyvalue::set(
            &self.prefixed_key(DbKeys::CONNECTED_APPS),
            &connected_apps.packed(),
        );
    }

    pub fn remove_connected_app(&self, app: &str) {
        let connected_apps = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_APPS));
        let mut connected_apps = connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_apps.remove(app);
        Keyvalue::set(
            &self.prefixed_key(DbKeys::CONNECTED_APPS),
            &connected_apps.packed(),
        );
    }

    pub fn get_connected_apps(&self) -> Vec<String> {
        let connected_apps = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_APPS));
        connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .apps
    }
}
