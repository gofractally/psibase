use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use psibase::fracpack::{Pack, Unpack};

fn connected_apps_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "connected_apps",
    )
}

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

    pub fn add_connected_app(&self, app: &str) {
        let connected_apps = connected_apps_table().get(&self.user);
        let mut connected_apps = connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default();
        if connected_apps.apps.contains(&app.to_string()) {
            return;
        }
        connected_apps.add(app);
        connected_apps_table().set(&self.user, &connected_apps.packed());
    }

    pub fn remove_connected_app(&self, app: &str) {
        let connected_apps = connected_apps_table().get(&self.user);
        let mut connected_apps = connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_apps.remove(app);
        connected_apps_table().set(&self.user, &connected_apps.packed());
    }

    pub fn get_connected_apps(&self) -> Vec<String> {
        let connected_apps = connected_apps_table().get(&self.user);
        connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .apps
    }
}
