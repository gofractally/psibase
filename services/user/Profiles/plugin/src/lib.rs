#[allow(warnings)]
mod bindings;

use bindings::exports::profiles::plugin::api::Guest as Api;
use bindings::profiles::plugin::types::Profile as PluginProfile;

use bindings::exports::profiles::plugin::api::File;

use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

struct ProfilesPlugin;

impl Api for ProfilesPlugin {
    fn set_profile(profile: PluginProfile) {
        let packed_profile_args = profiles::action_structs::setProfile {
            display_name: profile.display_name.unwrap_or_default(),
            bio: profile.bio.unwrap_or_default(),
            avatar: profile.avatar,
        }
        .packed();

        add_action_to_transaction("setProfile", &packed_profile_args).unwrap();
    }

    fn upload_avatar(file: File, compression_quality: u8) -> Result<(), Error> {
        bindings::sites::plugin::api::upload(&file, compression_quality)
    }
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ExampleThingData {
    example_thing: String,
}
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ExampleThingResponse {
    data: ExampleThingData,
}

bindings::export!(ProfilesPlugin with_types_in bindings);
