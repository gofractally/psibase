mod tables;

// enum HookData {
//     OnPublish {
//         hook_name: String,
//         data: action_structs::on_publish,
//     },
//     OnUnpublish {
//         hook_name: String,
//         data: action_structs::on_unpublish,
//     },
//     Unknown,
// }

// use psibase::{fracpack::Unpack, *};

// // impl HookData {
// //     fn from_hook(hook_name: &str, hook_data: &[u8]) -> Self {
// //         match hook_name {
// //             action_structs::on_publish::ACTION_NAME => HookData::OnPublish {
// //                 hook_name: hook_name.to_string(),
// //                 data: <action_structs::on_publish>::unpacked(hook_data).unwrap(),
// //             },
// //             action_structs::on_unpublish::ACTION_NAME => HookData::OnUnpublish {
// //                 hook_name: hook_name.to_string(),
// //                 data: <action_structs::on_unpublish>::unpacked(hook_data).unwrap(),
// //             },
// //             _ => HookData::Unknown,
// //         }
// //     }

// //     fn execute(self) {
// //         // let s = ServiceCaller {
// //         //     sender: Wrapper::SERVICE,
// //         //     service: Wrapper::SERVICE,
// //         // };

// //         match self {
// //             HookData::OnPublish { hook_name, data } => {

// //                 //s.call_returns_nothing(MethodNumber::from(hook_name.as_str()), data);
// //             }
// //             HookData::OnUnpublish { hook_name, data } => {
// //                 //s.call_returns_nothing(MethodNumber::from(hook_name.as_str()), data);
// //             }
// //             HookData::Unknown => {
// //                 // No-op for unrecognized hooks
// //             }
// //         }
// //     }
// // }

#[psibase::service(name = "web-registry", tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::*;
    use psibase::services::registry::Wrapper as Registry;
    use psibase::services::transact::Wrapper as Transact;
    use psibase::{
        fracpack::{Pack, Unpack},
        *,
    };

    #[action]
    fn init() {}

    #[action]
    fn handle_hook(hook_name: String, hook_data: Vec<u8>) {
        check(
            get_sender() == services::registry::Wrapper::SERVICE,
            "Invalid sender",
        );

        if hook_name == "on_publish" || hook_name == "on_unpublish" {
            psibase::services::transact::Wrapper::call().runAs(
                psibase::Action {
                    sender: get_sender(),
                    service: Wrapper::SERVICE,
                    method: MethodNumber::from(hook_name.as_str()),
                    rawData: Hex(hook_data),
                },
                vec![],
            );
        }
    }

    #[action]
    fn set_metadata(
        app: AccountNumber,
        icon: String,
        icon_mime_type: String,
        tos_subpage: String,
        privacy_policy_subpage: String,
        app_homepage_subpage: String,
        redirect_uris: Vec<String>,
    ) {
    }

    // Hooks:

    #[pre_action(exclude(handle_hook, set_metadata))]
    fn sender_check() {
        check(get_sender() == get_service(), "Invalid sender");
    }

    #[action]
    fn on_publish(app: AccountNumber) {
        check(
            get_sender() == services::registry::Wrapper::SERVICE,
            "Invalid sender",
        );
        // Check that it has valid properties
    }

    #[action]
    fn on_unpublish(app: AccountNumber) {
        check(
            get_sender() == services::registry::Wrapper::SERVICE,
            "Invalid sender",
        );
        // Check that it has valid properties
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}
