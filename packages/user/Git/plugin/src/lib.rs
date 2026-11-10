#[allow(warnings)]
mod bindings;

use bindings::exports::git::plugin::api::Guest as Api;
use bindings::git::plugin::types::{GitObject as PluginObject, RefUpdate as PluginRefUpdate};
use bindings::host::types::types::Error;
use bindings::transact::plugin::api::add_action_to_transaction;
use git::action_structs;
use git::service::{GitObject, RefUpdate};
use psibase::define_trust;
use psibase::fracpack::Pack;
use psibase::Hex;

define_trust! {
    descriptions {
        Low => "",
        Medium => "
            - Open and close pull requests
            - Merge pull requests
        ",
        High => "",
    }
    functions {
        Medium => [open_pr, close_pr, merge_pr],
    }
}

struct GitPlugin;

impl Api for GitPlugin {
    fn open_pr(owner: String, name: String, source: String, base: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::open_pr)?;

        let packed = action_structs::openPr {
            owner: owner.parse().unwrap(),
            name,
            source,
            base,
        }
        .packed();

        add_action_to_transaction(action_structs::openPr::ACTION_NAME, &packed)
    }

    fn close_pr(owner: String, name: String, id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::close_pr)?;

        let packed = action_structs::closePr {
            owner: owner.parse().unwrap(),
            name,
            id,
        }
        .packed();

        add_action_to_transaction(action_structs::closePr::ACTION_NAME, &packed)
    }

    fn merge_pr(
        owner: String,
        name: String,
        id: u32,
        objects: Vec<PluginObject>,
        updates: Vec<PluginRefUpdate>,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::merge_pr)?;

        let owner_acct = owner.parse().unwrap();

        if !objects.is_empty() {
            let packed = action_structs::putObjects {
                owner: owner_acct,
                name: name.clone(),
                objects: objects
                    .into_iter()
                    .map(|o| GitObject {
                        oid: o.oid,
                        data: Hex::from(o.data),
                    })
                    .collect(),
            }
            .packed();
            add_action_to_transaction(action_structs::putObjects::ACTION_NAME, &packed)?;
        }

        let packed = action_structs::updateRefs {
            owner: owner_acct,
            name: name.clone(),
            updates: updates
                .into_iter()
                .map(|u| RefUpdate {
                    refname: u.refname,
                    old_oid: u.old_oid,
                    new_oid: u.new_oid,
                })
                .collect(),
        }
        .packed();
        add_action_to_transaction(action_structs::updateRefs::ACTION_NAME, &packed)?;

        let packed = action_structs::closePr {
            owner: owner_acct,
            name,
            id,
        }
        .packed();
        add_action_to_transaction(action_structs::closePr::ACTION_NAME, &packed)
    }
}

bindings::export!(GitPlugin with_types_in bindings);
