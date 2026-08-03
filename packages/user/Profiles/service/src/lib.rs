pub const ALLOWED_AVATAR_CONTENT_TYPES: &[&str] =
    &["image/png", "image/jpeg", "image/webp", "image/gif"];

pub fn normalize_content_type(content_type: &str) -> &str {
    content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
}

pub fn is_allowed_content_type(content_type: &str) -> bool {
    let content_type = normalize_content_type(content_type);
    ALLOWED_AVATAR_CONTENT_TYPES
        .iter()
        .any(|allowed| content_type.eq_ignore_ascii_case(allowed))
}

#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::AccountNumber;
    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "ProfileTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
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
}
