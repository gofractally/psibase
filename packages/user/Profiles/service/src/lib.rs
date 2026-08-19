pub const MAX_AVATAR_SIZE: usize = 100 * 1024;

/// On-chain id for an allowed avatar image MIME type.
pub type ImgContentType = u8;

const AVATAR_CONTENT_TYPE_PNG: ImgContentType = 0;
const AVATAR_CONTENT_TYPE_JPEG: ImgContentType = 1;
const AVATAR_CONTENT_TYPE_WEBP: ImgContentType = 2;
const AVATAR_CONTENT_TYPE_GIF: ImgContentType = 3;

fn normalize_content_type(content_type: &str) -> &str {
    content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
}

/// Maps a MIME content-type string to the on-chain id.
pub fn parse_content_type(content_type: &str) -> Option<ImgContentType> {
    match normalize_content_type(content_type)
        .to_ascii_lowercase()
        .as_str()
    {
        "image/png" => Some(AVATAR_CONTENT_TYPE_PNG),
        "image/jpeg" => Some(AVATAR_CONTENT_TYPE_JPEG),
        "image/webp" => Some(AVATAR_CONTENT_TYPE_WEBP),
        "image/gif" => Some(AVATAR_CONTENT_TYPE_GIF),
        _ => None,
    }
}

/// Maps an on-chain content-type id to its MIME string.
pub fn content_type_mime(content_type: ImgContentType) -> Option<&'static str> {
    match content_type {
        AVATAR_CONTENT_TYPE_PNG => Some("image/png"),
        AVATAR_CONTENT_TYPE_JPEG => Some("image/jpeg"),
        AVATAR_CONTENT_TYPE_WEBP => Some("image/webp"),
        AVATAR_CONTENT_TYPE_GIF => Some("image/gif"),
        _ => None,
    }
}

#[psibase::service_tables]
pub mod tables {
    use psibase::AccountNumber;
    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "ProfileTable", index = 0)]
    #[derive(
        Default,
        Fracpack,
        ToSchema,
        async_graphql::SimpleObject,
        Serialize,
        Deserialize,
        Debug,
        Clone,
    )]
    pub struct Profile {
        #[primary_key]
        pub account: AccountNumber,

        pub display_name: String,
        pub bio: String,
    }
}

#[psibase::service(name = "profiles", tables = "tables")]
pub mod service {
    use crate::tables::{Profile, ProfileTable};
    use crate::{content_type_mime, ImgContentType, MAX_AVATAR_SIZE};
    use psibase::services::sites::Wrapper as Sites;
    use psibase::*;

    #[action]
    #[allow(non_snake_case)]
    fn setProfile(display_name: String, bio: String) {
        let table = ProfileTable::new();

        let caller = get_sender();
        let new_profile = Profile {
            account: caller,
            display_name: display_name.clone(),
            bio: bio.clone(),
        };

        table.put(&new_profile).unwrap();
    }

    #[action]
    #[allow(non_snake_case)]
    fn getProfile(account: AccountNumber) -> Option<Profile> {
        ProfileTable::read().get_index_pk().get(&account)
    }

    #[action]
    #[allow(non_snake_case)]
    fn uploadAvatar(image: Vec<u8>, contentType: ImgContentType) {
        assert!(
            image.len() <= MAX_AVATAR_SIZE,
            "Avatar exceeds max file size of {MAX_AVATAR_SIZE} bytes"
        );
        let Some(content_type) = content_type_mime(contentType) else {
            abort_message("Avatar content type not allowed");
        };

        let caller = get_sender();
        Sites::call().storeSys(
            format!("/avatar/{caller}"),
            content_type.to_string(),
            None,
            Hex(image),
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn removeAvatar() {
        let caller = get_sender();
        Sites::call().remove(format!("/avatar/{caller}"));
    }
}
