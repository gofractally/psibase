use crate::bindings::registry::plugin::types::AppMetadata;
use registry::action_structs::setMetadata;

impl From<AppMetadata> for setMetadata {
    fn from(metadata: AppMetadata) -> Self {
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
        }
    }
}
