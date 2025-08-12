use crate::{
    bindings::exports::permissions::plugin::api::TrustLevel,
    host::common::store::{DbMode::*, StorageDuration::*, *},
};
use psibase::fracpack::{Pack, Unpack};

mod tables {
    use super::*;

    pub fn permissions(duration: StorageDuration) -> Bucket {
        Bucket::new(
            Database {
                mode: NonTransactional,
                duration,
            },
            "user-app-permissions",
        )
    }
}

#[derive(Pack, Unpack, Default)]
pub struct Permission {
    pub caller: String,
    pub trust_level: TrustLevel,
}

#[derive(Pack, Unpack, Default)]
pub struct Permissions {
    pub permissions: Vec<Permission>,
}

impl Permissions {
    fn get_trust_level(&self, caller: &str) -> Option<TrustLevel> {
        self.get_permission_index(caller)
            .ok()
            .map(|index| self.permissions[index].trust_level)
    }

    fn get_permission_index(&self, caller: &str) -> Result<usize, usize> {
        self.permissions
            .binary_search_by(|p| p.caller.as_str().cmp(caller))
    }

    fn callee_permissions(bucket: &Bucket, key: &str) -> Option<Permissions> {
        bucket
            .get(&key)
            .map(|p| <Permissions>::unpacked(&p).unwrap())
    }

    pub fn set(
        user: &str,
        caller: &str,
        callee: &str,
        trust_level: TrustLevel,
        duration: StorageDuration,
    ) {
        let table = tables::permissions(duration);
        let key = format!("{user}:{callee}");

        let mut user_app_perms = Self::callee_permissions(&table, &key).unwrap_or_default();

        match user_app_perms.get_permission_index(caller) {
            Ok(index) => {
                user_app_perms.permissions[index].trust_level = trust_level;
            }
            Err(index) => {
                user_app_perms.permissions.insert(
                    index,
                    Permission {
                        caller: caller.to_string(),
                        trust_level,
                    },
                );
            }
        }

        table.set(&key, &user_app_perms.packed());
    }

    pub fn get(user: &str, caller: &str, callee: &str) -> Option<TrustLevel> {
        let key = format!("{user}:{callee}");

        let session_trust = Self::callee_permissions(&tables::permissions(Session), &key)
            .and_then(|perms| perms.get_trust_level(caller));
        let persistent_trust = Self::callee_permissions(&tables::permissions(Persistent), &key)
            .and_then(|perms| perms.get_trust_level(caller));

        match (session_trust, persistent_trust) {
            (Some(s), Some(p)) => Some(s.max(p)),
            (Some(s), None) => Some(s),
            (None, Some(p)) => Some(p),
            (None, None) => None,
        }
    }
}
