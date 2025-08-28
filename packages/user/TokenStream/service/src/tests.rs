#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::tables::Stream;
    use crate::Wrapper as TokenStream;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::tokens::{Quantity, Wrapper as Tokens};
    use psibase::*;

    static ALICE: AccountNumber = account!("alice");
    static BOB: AccountNumber = account!("bob");
    static CHARLIE: AccountNumber = account!("charlie");
    static TOKEN_STREAM: AccountNumber = account!("token-stream");

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
        TokenStream::push(&chain)
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

    fn setup_env(chain: &psibase::Chain) -> Result<u32, psibase::Error> {
        let token_stream = account!("token-stream");

        let alice = account!("alice");
        let bob = account!("bob");
        let charlie = account!("charlie");

        chain.new_account(alice)?;
        chain.new_account(bob)?;
        chain.new_account(charlie)?;

        let supply = Quantity::from(10000000);

        let token_id = Tokens::push_from(&chain, alice)
            .create(4.try_into().unwrap(), supply)
            .get()
            .unwrap();
        assert_eq!(token_id, 2);

        Tokens::push_from(&chain, alice).mint(
            token_id,
            supply,
            "memo".to_string().try_into().unwrap(),
        );
        Ok(token_id)
    }

    fn decay_rate_from_half_life(days: f64) -> u32 {
        let rate = std::f64::consts::LN_2 / (days * 86_400.0);
        (rate * 1_000_000.0).round() as u32
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn test_basics(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.start_block();

        let x = TimePointSec { seconds: 100 };
        chain.start_block_at(x.microseconds());

        let token_id = setup_env(&chain)?;

        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 500);

        let stream_nft_id = TokenStream::push_from(&chain, ALICE)
            .create(10000, token_id)
            .get()
            .unwrap();

        assert_eq!(get_balance(&chain, token_id, TOKEN_STREAM), 0.into());

        assert_eq!(
            get_shared_balance(&chain, token_id, ALICE, TOKEN_STREAM),
            500.into()
        );

        TokenStream::push_from(&chain, ALICE)
            .deposit(stream_nft_id, 500.into())
            .get()
            .unwrap();

        assert_eq!(
            get_stream(&chain, stream_nft_id).total_deposited,
            500.into()
        );

        Nfts::push_from(&chain, ALICE).credit(stream_nft_id, BOB, "memo".to_string());
        Nfts::push_from(&chain, BOB).debit(stream_nft_id, "memo".to_string());

        TokenStream::push_from(&chain, BOB)
            .claim(stream_nft_id)
            .get()
            .unwrap();

        assert_eq!(get_balance(&chain, token_id, BOB), 20.into());

        chain.start_block_at(
            TimePointSec {
                seconds: 3600 * 7 * 52 * 20,
            }
            .microseconds(),
        );
        TokenStream::push_from(&chain, BOB)
            .claim(stream_nft_id)
            .get()
            .unwrap();

        assert_eq!(get_balance(&chain, token_id, BOB), 500.into());

        Ok(())
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn claiming_sparsely_is_same_as_regularly(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let mut time: i64 = 1000;
        chain.start_block_at(TimePointSec { seconds: time }.microseconds());

        let token_id = setup_env(&chain)?;
        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 200000);

        let first_stream = TokenStream::push_from(&chain, ALICE)
            .create(10000, token_id)
            .get()
            .unwrap();
        let second_stream = TokenStream::push_from(&chain, ALICE)
            .create(10000, token_id)
            .get()
            .unwrap();

        TokenStream::push_from(&chain, ALICE)
            .deposit(first_stream, 100.into())
            .get()
            .unwrap();
        TokenStream::push_from(&chain, ALICE)
            .deposit(second_stream, 100.into())
            .get()
            .unwrap();

        Nfts::push_from(&chain, ALICE).credit(first_stream, BOB, "memo".to_string());
        Nfts::push_from(&chain, ALICE).credit(second_stream, CHARLIE, "memo".to_string());

        let mut bob_total_claimed = 0;
        for i in 0..8 {
            time += 50;
            chain.start_block_at(TimePointSec { seconds: time }.microseconds());
            TokenStream::push_from(&chain, BOB)
                .claim(first_stream)
                .get()
                .unwrap();
            let bob_balance = get_balance(&chain, token_id, BOB);
            bob_total_claimed += bob_balance.value - bob_total_claimed;
        }
        let bob_balance = get_balance(&chain, token_id, BOB);
        assert_eq!(bob_balance.value, bob_total_claimed);

        TokenStream::push_from(&chain, CHARLIE)
            .claim(second_stream)
            .get()
            .unwrap();
        let charlie_balance = get_balance(&chain, token_id, CHARLIE);

        assert_eq!(
            bob_balance, charlie_balance,
            "Balances should match after claims"
        );

        Ok(())
    }
}
