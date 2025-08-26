#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::tables::Stream;
    use crate::Wrapper;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::tokens::{Quantity, Wrapper as Tokens};
    use psibase::*;

    fn get_balance(chain: &psibase::Chain, token_id: u32, account: AccountNumber) -> Quantity {
        Tokens::push(&chain)
            .getBalance(token_id, account)
            .get()
            .unwrap()
    }

    fn get_shared_balance(
        chain: &psibase::Chain,
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
    ) -> Quantity {
        Tokens::push(&chain)
            .getSharedBal(token_id, creditor, debitor)
            .get()
            .unwrap()
    }

    fn get_stream(chain: &psibase::Chain, nft_id: u32) -> Stream {
        Wrapper::push(&chain)
            .get_stream(nft_id)
            .get()
            .unwrap()
            .unwrap()
    }

    fn tokens_credit(
        chain: &psibase::Chain,
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: u64,
    ) {
        Tokens::push_from(&chain, creditor)
            .credit(
                token_id,
                debitor,
                amount.into(),
                "memo".to_string().try_into().unwrap(),
            )
            .get()
            .unwrap();
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn test_basics(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        let bob = account!("bob");

        let token_stream = account!("token-stream");

        chain.new_account(alice)?;
        chain.new_account(bob)?;

        chain.start_block();

        let mut x = TimePointSec { seconds: 100 };
        chain.start_block_at(x.microseconds());

        let token_id = Tokens::push_from(&chain, alice)
            .create(4.try_into().unwrap(), 10000000.try_into().unwrap())
            .get()
            .unwrap();

        Tokens::push_from(&chain, alice).mint(
            token_id,
            10000000.into(),
            "memo".to_string().try_into().unwrap(),
        );

        tokens_credit(&chain, token_id, alice, token_stream, 500);

        assert_eq!(token_id, 2);

        let stream_nft_id = Wrapper::push_from(&chain, alice)
            .create(10000, token_id)
            .get()
            .unwrap();

        assert_eq!(get_balance(&chain, token_id, token_stream), 0.into());

        assert_eq!(
            get_shared_balance(&chain, token_id, alice, token_stream),
            500.into()
        );

        Wrapper::push_from(&chain, alice)
            .deposit(stream_nft_id, 500.into())
            .get()
            .unwrap();

        assert_eq!(
            get_stream(&chain, stream_nft_id).total_deposited,
            500.into()
        );

        Nfts::push_from(&chain, alice).credit(stream_nft_id, bob, "memo".to_string());
        Nfts::push_from(&chain, bob).debit(stream_nft_id, "memo".to_string());

        Wrapper::push_from(&chain, bob)
            .claim(stream_nft_id)
            .get()
            .unwrap();

        assert_eq!(get_balance(&chain, token_id, bob), 20.into());

        chain.start_block_at(
            TimePointSec {
                seconds: 3600 * 7 * 52 * 20,
            }
            .microseconds(),
        );
        Wrapper::push_from(&chain, bob)
            .claim(stream_nft_id)
            .get()
            .unwrap();

        assert_eq!(get_balance(&chain, token_id, bob), 500.into());

        Ok(())
    }
}
