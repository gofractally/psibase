#[allow(warnings)]
mod bindings;

use bindings::exports::nft::plugin::authorized::Guest as Authorized;
use bindings::exports::nft::plugin::issuer::Guest as Issuer;
use bindings::exports::nft::plugin::user::Guest as User;
use bindings::exports::nft::plugin::user_config::Guest as UserConfig;

use bindings::host::http::api::post_graphql_get_json;
use bindings::host::types::types::Error;
use bindings::transact::plugin::api::add_action_to_transaction;

use psibase::fracpack::Pack;
use psibase::{define_trust, FlagsType};

use psibase::services::nft::{self as Nft, NftHolderFlags};

use bindings::host::types::types::PluginId;
use rand::Rng;
use serde::Deserialize;

define_trust! {
    descriptions {
        Low => "",
        Medium => "
            - Minting
        ",
        High => "
            - Credit, Debit and uncredit.
            - Auto debit toggle
            - Burning
            - Read your NFT transfer history and pending transfers
        ",
    }
    functions {
        None => [guess_id],
        Medium => [mint],
        High => [uncredit, debit, try_debit, enable_user_auto_debit, credit, burn, graphql],
    }
}

#[derive(Deserialize)]
struct ChooseIdResponse {
    data: ChooseIdData,
}

#[derive(Deserialize)]
struct ChooseIdData {
    #[serde(rename = "chooseId")]
    id: u32,
}

fn plugin_error(message: impl Into<String>) -> Error {
    Error {
        code: 1,
        producer: PluginId {
            service: "nft".into(),
            plugin: "plugin".into(),
        },
        message: message.into(),
    }
}

fn choose_id() -> Result<u32, Error> {
    let guess: u32 = rand::rng().random();
    let query = format!("query {{ chooseId(id: {guess}) }}");
    let body = post_graphql_get_json(&query)?;
    serde_json::from_str::<ChooseIdResponse>(&body)
        .map(|response| response.data.id)
        .map_err(|err| plugin_error(err.to_string()))
}

struct NftPlugin;

impl Issuer for NftPlugin {
    fn mint() -> Result<u32, Error> {
        trust::assert_authorized(trust::FunctionName::mint)?;

        let id = choose_id()?;
        let packed_args = Nft::action_structs::mint { nftId: Some(id) }.packed();
        add_action_to_transaction(Nft::action_structs::mint::ACTION_NAME, &packed_args)?;
        Ok(id)
    }

    fn guess_id() -> Result<u32, Error> {
        trust::assert_authorized(trust::FunctionName::guess_id)?;
        choose_id()
    }
}

impl User for NftPlugin {
    fn credit(nft_id: u32, receiver: String, memo: String) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::credit,
            vec!["namemarket".into()],
        )?;

        let packed_args = Nft::action_structs::credit {
            memo: memo.try_into().unwrap(),
            nftId: nft_id,
            debitor: receiver.parse().unwrap(),
        }
        .packed();

        add_action_to_transaction(Nft::action_structs::credit::ACTION_NAME, &packed_args)
    }

    fn uncredit(nft_id: u32, memo: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::uncredit)?;

        let packed_args = Nft::action_structs::uncredit {
            memo: memo.try_into().unwrap(),
            nftId: nft_id,
        }
        .packed();

        add_action_to_transaction(Nft::action_structs::uncredit::ACTION_NAME, &packed_args)
    }

    fn debit(nft_id: u32, memo: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::debit)?;

        let packed_args = Nft::action_structs::debit {
            memo: memo.try_into().unwrap(),
            nftId: nft_id,
        }
        .packed();

        add_action_to_transaction(Nft::action_structs::debit::ACTION_NAME, &packed_args)
    }

    fn try_debit(nft_id: u32, memo: String) -> Result<(), Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::try_debit,
            vec!["namemarket".into()],
        )?;

        let packed_args = Nft::action_structs::try_debit {
            memo: memo.try_into().unwrap(),
            nftId: nft_id,
        }
        .packed();

        add_action_to_transaction(Nft::action_structs::try_debit::ACTION_NAME, &packed_args)
    }

    fn burn(nft_id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::burn)?;

        let packed_args = Nft::action_structs::burn { nftId: nft_id }.packed();

        add_action_to_transaction(Nft::action_structs::burn::ACTION_NAME, &packed_args)
    }
}

impl UserConfig for NftPlugin {
    fn enable_user_auto_debit(enable: bool) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::enable_user_auto_debit)?;

        let packed_args = Nft::action_structs::setUserConf {
            index: NftHolderFlags::AUTO_DEBIT.index(),
            enable,
        }
        .packed();

        add_action_to_transaction(Nft::action_structs::setUserConf::ACTION_NAME, &packed_args)
    }
}

impl Authorized for NftPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        trust::assert_authorized_with_whitelist(
            trust::FunctionName::graphql,
            vec!["homepage".into(), "accounts".into()],
        )?;

        post_graphql_get_json(&query)
    }
}

bindings::export!(NftPlugin with_types_in bindings);
