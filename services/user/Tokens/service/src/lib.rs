pub mod bitflag;
pub mod tables;
pub mod token_balance_settings;
#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{InitRow, InitTable, SharedBalance, Token};
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::{Quantity, *};

    #[action]
    fn init() {
        check_none(Token::get(1), "init already ran");
        // if Token::get(1).is_some() {
        //     return;
        // }
        let table = InitTable::new();
        let init_instance = InitRow { last_used_id: 0 };
        table.put(&init_instance).unwrap();

        let precision: u8 = 4;

        let native_token = Token::add(
            Quantity::from_str("1000000", precision.into()).unwrap(),
            precision,
        );

        check(native_token.id == 1, "expected native token to be ID of 1");
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not initiated",
        );
    }

    #[action]
    fn create(max_supply: Quantity, precision: u8) -> u32 {
        check(max_supply.value > 0, "max supply must be greator than 0");
        let new_token = Token::add(max_supply, precision);

        let creator = get_sender();

        if creator != get_service() {
            Nfts::call().credit(
                new_token.nft_id,
                creator,
                format!("NFT for token ID {}", new_token.id),
            );
        }

        new_token.id
    }

    #[action]
    fn recall(token_id: u32, from: AccountNumber, amount: Quantity, memo: String) {
        check(amount.value > 0, "must be greater than 0");
        let sender = get_sender();
        let mut token = Token::get_assert(token_id);

        let is_recall = sender != from;
        if is_recall {
            check(token.recallable, "token is not recallable");
            check(token.owner() == sender, "must own token NFT");
        } else {
            check(token.burnable, "token is not burnable");
        }

        token.burn(amount, from);
    }

    #[action]
    fn mint(token_id: u32, amount: Quantity, memo: String) {
        check(amount.value > 0, "must be greater than 0");
        let sender = get_sender();

        let mut token = Token::get_assert(token_id);
        check(token.owner() == sender, "must hold the NFT");

        token.mint(amount, sender);
    }

    #[action]
    fn credit(token_id: u32, receiver: AccountNumber, amount: Quantity, memo: String) {
        let mut shared_balance = SharedBalance::get(get_sender(), receiver, token_id);
        shared_balance.credit(amount);
    }

    #[action]
    fn debit(token_id: u32, creditor: AccountNumber, amount: Quantity, memo: String) {
        let mut shared_balance = SharedBalance::get(creditor, get_sender(), token_id);
        shared_balance.debit(amount);
    }

    #[event(history)]
    pub fn credited(token_id: u32, creditor: AccountNumber, debitor: AccountNumber, memo: String) {}

    #[event(history)]
    pub fn debited(token_id: u32, creditor: AccountNumber, debitor: AccountNumber) {}
}

#[cfg(test)]
mod tests;
