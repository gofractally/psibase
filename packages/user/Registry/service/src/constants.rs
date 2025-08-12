// An App can't have more than 3 tags
pub const MAX_APP_TAGS: usize = 3;
pub const MAX_TAG_LENGTH: usize = 30;
pub const MAX_NAME_SIZE: usize = 30;
pub const MAX_SHORT_DESC_SIZE: usize = 100;
pub const MAX_LONG_DESC_SIZE: usize = 1000;

pub const ICON_MIME_TYPES: [&str; 5] = [
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "image/x-icon",
    "image/vnd.microsoft.icon",
];

pub mod app_status {
    pub const DRAFT: u32 = 0;
    pub const PUBLISHED: u32 = 1;
    pub const UNPUBLISHED: u32 = 2;
}
