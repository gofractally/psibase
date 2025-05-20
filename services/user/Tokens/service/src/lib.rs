pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{Balance, InitRow, InitTable, SharedBalance, Token};
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::{Quantity, *};

    #[action]
    fn init() {
        check_none(Token::get(1), "init already ran");
        let table = InitTable::new();
        let init_instance = InitRow { last_used_id: 0 };
        table.put(&init_instance).unwrap();

        // Create the native token.
        Token::add(Quantity::from_str("21000000", 4.into()).unwrap());
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
    fn create(max_supply: Quantity) -> u64 {
        check(max_supply.value > 0, "max supply must be greator than 0");
        let new_token = Token::add(max_supply);

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
    fn credit(token_id: u64, receiver: AccountNumber, amount: Quantity, memo: String) {
        let mut balance = Balance::get(get_sender(), token_id);
        balance.transfer(receiver, amount);
    }

    #[action]
    fn debit(token_id: u64, creditor: AccountNumber, amount: Quantity) {
        let debitor = get_sender();
        let mut shared_balance = SharedBalance::get(creditor, debitor, token_id);
        shared_balance.transfer(debitor, amount);
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
