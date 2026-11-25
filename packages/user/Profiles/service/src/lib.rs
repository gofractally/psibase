pub const MAX_AVATAR_SIZE: usize = 100 * 1024;

pub use psibase::image_content_type::{
    mime as content_type_mime, parse as parse_content_type, ImgContentType,
};

#[psibase::service_tables]
pub mod tables {
    use psibase::AccountNumber;
    use psibase::{Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[table(name = "ProfileTable", index = 0)]
    #[derive(
        Default,
        Pack,
        Unpack,
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

#[cfg(test)]
mod tests;
