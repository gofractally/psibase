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

    fn check_balance(
        chain: &psibase::Chain,
        token_id: u32,
        account: AccountNumber,
        value: Option<u64>,
    ) -> Quantity {
        let res = Tokens::push(&chain)
            .getBalance(token_id, account)
            .get()
            .unwrap();

        if value.is_some() {
            assert_eq!(res.value, value.unwrap())
        }

        res
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
        chain.new_account(ALICE)?;
        chain.new_account(BOB)?;
        chain.new_account(CHARLIE)?;

        let supply = Quantity::from(10000000);

        let token_id = Tokens::push_from(&chain, ALICE)
            .create(4.try_into().unwrap(), supply)
            .get()
            .unwrap();
        assert_eq!(token_id, 2);

        Tokens::push_from(&chain, ALICE).mint(
            token_id,
            supply,
            "memo".to_string().try_into().unwrap(),
        );
        Ok(token_id)
    }

    pub fn full_vesting_time(half_life_seconds: u32, balance: u64) -> i64 {
        if balance == 0 {
            return 0;
        }
        let t = half_life_seconds as f64 * ((2.0 * balance as f64).ln() / std::f64::consts::LN_2);
        t.ceil() as i64 + 1
    }

    fn reset_clock(chain: &psibase::Chain) {
        let time: i64 = 1000;
        chain.start_block_at(TimePointSec { seconds: time }.microseconds());
    }

    fn create_stream(
        chain: &psibase::Chain,
        author: AccountNumber,
        half_life_seconds: u32,
        token_id: u32,
    ) -> u32 {
        TokenStream::push_from(&chain, author)
            .create(half_life_seconds, token_id)
            .get()
            .unwrap()
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn test_basics(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.set_auto_block_start(false);
        chain.start_block();

        reset_clock(&chain);

        let token_id = setup_env(&chain)?;

        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 500);

        let stream_nft_id = create_stream(&chain, ALICE, 10000, token_id);

        check_balance(&chain, token_id, TOKEN_STREAM, Some(0));

        assert_eq!(
            get_shared_balance(&chain, token_id, ALICE, TOKEN_STREAM),
            500.into()
        );

        TokenStream::push_from(&chain, ALICE)
            .deposit(stream_nft_id)
            .get()
            .unwrap();

        assert_eq!(
            get_stream(&chain, stream_nft_id).total_deposited,
            500.into()
        );

        Nfts::push_from(&chain, ALICE).credit(stream_nft_id, BOB, "memo".to_string());
        Nfts::push_from(&chain, BOB).debit(stream_nft_id, "memo".to_string());

        // Claim fails because no vesting has yet occured.
        assert_eq!(
            TokenStream::push_from(&chain, BOB)
                .claim(stream_nft_id)
                .get()
                .unwrap_err()
                .to_string(),
            "service 'tokens' aborted with message: credit quantity must be greater than 0"
                .to_string()
        );

        check_balance(&chain, token_id, BOB, Some(0));

        let expected_full_vesting_wait_time = full_vesting_time(10000, 500);

        chain.start_block_after(Seconds::new(expected_full_vesting_wait_time).into());

        TokenStream::push_from(&chain, BOB)
            .claim(stream_nft_id)
            .get()
            .unwrap();
        check_balance(&chain, token_id, BOB, Some(500));

        Ok(())
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn claiming_sparsely_is_same_as_regularly(chain: psibase::Chain) -> Result<(), psibase::Error> {
        reset_clock(&chain);

        let token_id = setup_env(&chain)?;
        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 100000);
        let first_stream = create_stream(&chain, ALICE, 10000, token_id);
        TokenStream::push_from(&chain, ALICE)
            .deposit(first_stream)
            .get()
            .unwrap();

        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 100000);
        let second_stream = create_stream(&chain, ALICE, 10000, token_id);
        TokenStream::push_from(&chain, ALICE)
            .deposit(second_stream)
            .get()
            .unwrap();

        Nfts::push_from(&chain, ALICE).credit(first_stream, BOB, "memo".to_string());
        Nfts::push_from(&chain, ALICE).credit(second_stream, CHARLIE, "memo".to_string());

        let mut bob_total_claimed = 0;
        for _ in 0..8 {
            chain.start_block_after(Seconds::new(50).into());

            TokenStream::push_from(&chain, BOB)
                .claim(first_stream)
                .get()
                .unwrap();
            let bob_balance = check_balance(&chain, token_id, BOB, None);
            bob_total_claimed += bob_balance.value - bob_total_claimed;
        }
        let bob_balance = check_balance(&chain, token_id, BOB, None);
        assert_eq!(bob_balance.value, bob_total_claimed);

        TokenStream::push_from(&chain, CHARLIE)
            .claim(second_stream)
            .get()
            .unwrap();
        let charlie_balance = check_balance(&chain, token_id, CHARLIE, None);

        assert_eq!(
            bob_balance, charlie_balance,
            "Balances should match after claims"
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn dust_eventually_rounds_to_zero(chain: psibase::Chain) -> Result<(), psibase::Error> {
        reset_clock(&chain);
        let token_id = setup_env(&chain)?;

        tokens_credit(&chain, token_id, ALICE, BOB, 100);
        tokens_credit(&chain, token_id, BOB, TOKEN_STREAM, 100);

        let first_stream = TokenStream::push_from(&chain, BOB)
            .create(100, token_id)
            .get()
            .unwrap();

        TokenStream::push_from(&chain, BOB)
            .deposit(first_stream)
            .get()
            .unwrap();

        chain.start_block_after(Seconds::new(9999999999).into());

        TokenStream::push_from(&chain, BOB)
            .claim(first_stream)
            .get()
            .unwrap();

        check_balance(&chain, token_id, BOB, Some(100));
        Ok(())
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn multiple_deposits_same_stream(chain: psibase::Chain) -> Result<(), psibase::Error> {
        reset_clock(&chain);

        let token_id = setup_env(&chain)?;
        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 300);

        let stream_nft_id = TokenStream::push_from(&chain, ALICE)
            .create(10000, token_id)
            .get()
            .unwrap();

        // First deposit
        TokenStream::push_from(&chain, ALICE)
            .deposit(stream_nft_id)
            .get()
            .unwrap();

        chain.start_block_after(Seconds::new(50).into());

        // Second deposit after some time
        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 200);
        TokenStream::push_from(&chain, ALICE)
            .deposit(stream_nft_id)
            .get()
            .unwrap();

        // Transfer NFT to Bob
        Nfts::push_from(&chain, ALICE).credit(stream_nft_id, BOB, "memo".to_string());

        // Claim after another time increment
        chain.start_block_after(Seconds::new(50).into());

        TokenStream::push_from(&chain, BOB)
            .claim(stream_nft_id)
            .get()
            .unwrap();

        let bob_balance = check_balance(&chain, token_id, BOB, None);
        let stream = get_stream(&chain, stream_nft_id);
        assert_eq!(
            stream.total_deposited,
            500.into(),
            "Total deposited should be 500"
        );
        assert!(bob_balance.value > 0, "Bob should have claimed some tokens");

        Ok(())
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn zero_deposit_fails(chain: psibase::Chain) -> Result<(), psibase::Error> {
        reset_clock(&chain);

        let token_id = setup_env(&chain)?;

        let stream_nft_id = TokenStream::push_from(&chain, ALICE)
            .create(10000, token_id)
            .get()
            .unwrap();

        // Attempt to deposit zero
        let result = TokenStream::push_from(&chain, ALICE)
            .deposit(stream_nft_id)
            .get();

        assert!(result.is_err(), "Depositing zero should fail");
        assert_eq!(
            get_stream(&chain, stream_nft_id).total_deposited,
            0.into(),
            "No tokens should be deposited"
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn claim_without_deposit(chain: psibase::Chain) -> Result<(), psibase::Error> {
        reset_clock(&chain);

        let token_id = setup_env(&chain)?;
        let stream_nft_id = TokenStream::push_from(&chain, ALICE)
            .create(10000, token_id)
            .get()
            .unwrap();

        Nfts::push_from(&chain, ALICE).credit(stream_nft_id, BOB, "memo".to_string());

        chain.start_block_after(Seconds::new(100).into());

        let err = TokenStream::push_from(&chain, BOB)
            .claim(stream_nft_id)
            .get()
            .unwrap_err();

        assert_eq!(
            err.to_string(),
            "service 'tokens' aborted with message: credit quantity must be greater than 0"
                .to_string()
        );

        let bob_balance = check_balance(&chain, token_id, BOB, None);
        assert_eq!(
            bob_balance,
            0.into(),
            "No tokens should be claimable without deposit"
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn stream_transfer_preserves_vesting(chain: psibase::Chain) -> Result<(), psibase::Error> {
        reset_clock(&chain);

        let token_id = setup_env(&chain)?;
        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 500);

        let stream_nft_id = TokenStream::push_from(&chain, ALICE)
            .create(10000, token_id)
            .get()
            .unwrap();

        TokenStream::push_from(&chain, ALICE)
            .deposit(stream_nft_id)
            .get()
            .unwrap();

        chain.start_block_after(Seconds::new(50).into());

        Nfts::push_from(&chain, ALICE).credit(stream_nft_id, BOB, "memo".to_string());
        Nfts::push_from(&chain, BOB).credit(stream_nft_id, CHARLIE, "memo".to_string());

        chain.start_block_after(Seconds::new(50).into());

        TokenStream::push_from(&chain, CHARLIE)
            .claim(stream_nft_id)
            .get()
            .unwrap();

        let charlie_balance = check_balance(&chain, token_id, CHARLIE, None);
        assert!(
            charlie_balance.value > 0,
            "Charlie should claim vested tokens"
        );
        assert_eq!(
            get_stream(&chain, stream_nft_id).total_deposited,
            500.into(),
            "Total deposited should remain unchanged"
        );

        Ok(())
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn precision_check(chain: psibase::Chain) -> Result<(), psibase::Error> {
        reset_clock(&chain);

        let token_id = setup_env(&chain)?;
        let alice_balance_before = check_balance(&chain, token_id, ALICE, None);

        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 80000);

        let half_life_seconds = 10000 as u32;
        let stream_nft_id = TokenStream::push_from(&chain, ALICE)
            .create(half_life_seconds, token_id)
            .get()
            .unwrap();

        TokenStream::push_from(&chain, ALICE)
            .deposit(stream_nft_id)
            .get()
            .unwrap();

        chain.start_block_after(Seconds::new((half_life_seconds * 3) as i64).into());

        TokenStream::push_from(&chain, ALICE)
            .claim(stream_nft_id)
            .get()
            .unwrap();

        let alice_balance_after = check_balance(&chain, token_id, ALICE, None);

        let dust = 1;
        assert_eq!(
            (alice_balance_before - alice_balance_after).value,
            10000 - dust
        );

        Ok(())
    }
}
