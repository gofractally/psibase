use registry::service::AppStatusU32 as ServiceAppStatusU32;

use crate::bindings::registry::plugin::types::{AppMetadata, AppStatus};

use registry as RegistryService;

impl From<ServiceAppStatusU32> for AppStatus {
    fn from(status: ServiceAppStatusU32) -> Self {
        match status {
            0 => AppStatus::Draft,
            1 => AppStatus::Published,
            2 => AppStatus::Unpublished,
            _ => panic!("Invalid app status"),
        }
    }
}

impl From<AppMetadata> for RegistryService::action_structs::setMetadata {
    fn from(metadata: AppMetadata) -> Self {
        let owners_vec = metadata
            .owners
            .iter()
            .map(|owner| owner.parse().unwrap())
            .collect();

        Self {
            name: metadata.name,
            short_description: metadata.short_description,
            long_description: metadata.long_description,
            icon: metadata.icon,
            icon_mime_type: metadata.icon_mime_type,
            tos_subpage: metadata.tos_subpage,
            privacy_policy_subpage: metadata.privacy_policy_subpage,
            app_homepage_subpage: metadata.app_homepage_subpage,
            tags: metadata.tags,
            redirect_uris: metadata.redirect_uris,
            owners: owners_vec,
        }
    }
}
