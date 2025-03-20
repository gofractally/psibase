#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::AccountNumber;
    use psibase::{Fracpack, SingletonKey, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "ProfileTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Profile {
        #[primary_key]
        pub account: AccountNumber,

        pub display_name: String,
        pub bio: String,
        pub avatar: bool,
    }
}

#[psibase::service(name = "profiles")]
pub mod service {
    use crate::tables::{Profile, ProfileTable};
    use psibase::*;

    #[action]
    fn init() {}

    #[action]
    #[allow(non_snake_case)]
    fn setProfile(display_name: String, bio: String, avatar: bool) {
        let table = ProfileTable::new();

        let caller = get_sender();
        let new_profile = Profile {
            account: caller,
            display_name: display_name.clone(),
            bio: bio.clone(),
            avatar: avatar,
        };

        table.put(&new_profile).unwrap();

        Wrapper::emit()
            .history()
            .profileSet(caller, get_sender().to_string() + &display_name.clone());
    }

    #[action]
    #[allow(non_snake_case)]
    fn getProfile(account: AccountNumber) -> Option<Profile> {
        let table = ProfileTable::new();
        table.get_index_pk().get(&account)
    }

    #[event(history)]
    pub fn profileSet(account: AccountNumber, displayName: String) {}
}

#[cfg(test)]
mod tests;
