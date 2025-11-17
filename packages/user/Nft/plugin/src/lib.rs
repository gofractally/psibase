#[allow(warnings)]
mod bindings;

use bindings::exports::nft::plugin::api::Guest as Api;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;

use psibase::services::nft as Nft;

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Minting
        ",
        Medium => "",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Crediting
            - Burning
        ",
    }
    functions {
        Low => [mint],
        High => [credit, burn],
    }
}

struct NftPlugin;

impl Api for NftPlugin {
    fn credit(nft_id: u32, receiver: String, memo: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::credit)?;

        let packed_args = Nft::action_structs::credit {
            memo,
            nftId: nft_id,
            receiver: receiver.as_str().into(),
        }
        .packed();

        add_action_to_transaction(Nft::action_structs::credit::ACTION_NAME, &packed_args)
    }

    fn mint() -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::mint)?;

        let packed_args = Nft::action_structs::mint {}.packed();

        add_action_to_transaction(Nft::action_structs::mint::ACTION_NAME, &packed_args)
    }

    fn burn(nft_id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::burn)?;

        let packed_args = Nft::action_structs::burn { nftId: nft_id }.packed();

        add_action_to_transaction(Nft::action_structs::burn::ACTION_NAME, &packed_args)
    }
}

bindings::export!(NftPlugin with_types_in bindings);
