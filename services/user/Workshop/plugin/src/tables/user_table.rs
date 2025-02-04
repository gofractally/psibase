use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use psibase::fracpack::{Pack, Unpack};

use crate::tables::keys::DbKeys;

#[derive(Pack, Unpack, Default)]
pub struct ManagedApps {
    pub apps: Vec<String>,
}

impl ManagedApps {
    pub fn add(&mut self, app: &str) {
        if self.apps.contains(&app.to_string()) {
            return;
        }

        self.apps.push(app.to_string());
    }
}

// Tables namespaced by user
pub struct UserTables {
    user: String,
}
impl UserTables {
    pub fn new(user: &str) -> Self {
        Self {
            user: user.to_string(),
        }
    }

    fn prefixed_key(&self, key: &str) -> String {
        self.user.to_string() + "." + key
    }

    pub fn add_managed_app(&self, app: &str) {
        let mut managed_apps = self.get_managed_apps();
        managed_apps.add(app);
        Keyvalue::set(
            &self.prefixed_key(DbKeys::MANAGED_APPS),
            &managed_apps.packed(),
        )
        .expect("Failed to set connected apps");
    }

    pub fn get_managed_apps(&self) -> ManagedApps {
        let managed_apps = Keyvalue::get(&self.prefixed_key(DbKeys::MANAGED_APPS));
        managed_apps
            .map(|c| <ManagedApps>::unpacked(&c).unwrap())
            .unwrap_or_default()
    }

    pub fn remove_managed_app(&self, app: &str) {
        let mut managed_apps = self.get_managed_apps();
        managed_apps.apps.retain(|a| a != app);
        Keyvalue::set(
            &self.prefixed_key(DbKeys::MANAGED_APPS),
            &managed_apps.packed(),
        )
        .expect("Failed to set connected apps");
    }
}
