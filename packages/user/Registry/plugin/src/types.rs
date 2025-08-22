use crate::bindings::registry::plugin::types::AppMetadata;
use registry::action_structs::setMetadata;

impl From<AppMetadata> for setMetadata {
    fn from(metadata: AppMetadata) -> Self {
        Self {
            name: metadata.name,
            short_description: metadata.short_desc,
            long_description: metadata.long_desc,
            icon: metadata.icon,
            icon_mime_type: metadata.icon_mime_type,
            tags: metadata.tags,
        }
    }
}
