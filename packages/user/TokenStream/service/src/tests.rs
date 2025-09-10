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

    /// Creates alice, bob, charlie, and alice mints a new token with supply 1000_0000.
    fn setup_env(chain: &psibase::Chain) -> u32 {
        chain.new_account(ALICE).unwrap();
        chain.new_account(BOB).unwrap();
        chain.new_account(CHARLIE).unwrap();

        let supply = Quantity::from(1000_0000);

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
        token_id
    }

    // λ = ln(2) / half_life_seconds
    fn rate(half_life_seconds: u32) -> f64 {
        std::f64::consts::LN_2 / half_life_seconds as f64
    }

    // Δt > (1/λ) * ln(P(0))
    pub fn full_vesting_time(half_life_seconds: u32, balance: u64) -> i64 {
        if balance == 0 {
            return 0;
        }

        let factor = 1.0 / rate(half_life_seconds);
        let t = factor * ((balance as f64).ln());

        t.ceil() as i64
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

    struct TestHelper {
        chain: psibase::Chain,
        token_id: u32,
    }

    impl TestHelper {
        const HALF_LIFE: u32 = 10000;

        fn new(mut chain: psibase::Chain) -> Self {
            chain.set_auto_block_start(false);
            reset_clock(&chain);
            let token_id = setup_env(&chain);
            Self { chain, token_id }
        }

        fn credit(&self, creditor: AccountNumber, debitor: AccountNumber, amount: u64) {
            tokens_credit(&self.chain, self.token_id, creditor, debitor, amount);
        }

        fn get_balance(&self, account: AccountNumber) -> Quantity {
            get_balance(&self.chain, self.token_id, account)
        }

        fn create_stream(&self, owner: AccountNumber, deposit_amount: u64) -> u32 {
            let id = create_stream(&self.chain, owner, Self::HALF_LIFE, self.token_id);
            self.deposit(owner, id, deposit_amount);
            id
        }

        fn deposit(&self, sender: AccountNumber, stream_nft_id: u32, amount: u64) {
            self.credit(sender, TOKEN_STREAM, amount);
            TokenStream::push_from(&self.chain, sender)
                .deposit(stream_nft_id)
                .get()
                .unwrap();
        }

        fn transfer_stream_ownership(
            &self,
            sender: AccountNumber,
            recipient: AccountNumber,
            stream_nft_id: u32,
        ) {
            Nfts::push_from(&self.chain, sender).credit(
                stream_nft_id,
                recipient,
                "Giving tokenstream NFT".to_string(),
            );
            Nfts::push_from(&self.chain, recipient)
                .debit(stream_nft_id, "claiming tokenstream NFT".to_string());
        }

        fn stream(&self, stream_nft_id: u32) -> Stream {
            get_stream(&self.chain, stream_nft_id)
        }

        fn claim(&self, recipient: AccountNumber, stream_nft_id: u32) {
            TokenStream::push_from(&self.chain, recipient)
                .claim(stream_nft_id)
                .get()
                .unwrap();
        }

        fn pass_time(&self, seconds: i64) {
            self.chain.start_block_after(Seconds::new(seconds).into());
        }
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn test_basics(mut chain: psibase::Chain) {
        chain.set_auto_block_start(false);
        reset_clock(&chain);
        let token_id = setup_env(&chain);

        let id = create_stream(&chain, ALICE, TestHelper::HALF_LIFE, token_id);

        // Test zero deposit fails
        let result = TokenStream::push_from(&chain, ALICE).deposit(id).get();
        assert!(result.is_err(), "Depositing zero should fail");
        assert_eq!(
            get_stream(&chain, id).total_deposited,
            0.into(),
            "No tokens should be deposited"
        );

        // Test claim fails since there's been no deposit
        let err = TokenStream::push_from(&chain, ALICE)
            .claim(id)
            .get()
            .unwrap_err();
        assert!(err
            .to_string()
            .contains("credit quantity must be greater than 0"));

        // Make deposit
        tokens_credit(&chain, token_id, ALICE, TOKEN_STREAM, 500);
        TokenStream::push_from(&chain, ALICE)
            .deposit(id)
            .get()
            .unwrap();

        // Check claim fails when no vesting has yet occured
        Nfts::push_from(&chain, ALICE).credit(id, BOB, "memo".to_string());
        Nfts::push_from(&chain, BOB).debit(id, "memo".to_string());
        assert!(TokenStream::push_from(&chain, BOB)
            .claim(id)
            .get()
            .unwrap_err()
            .to_string()
            .contains("credit quantity must be greater than 0"));

        // Check total deposited is correct
        chain.start_block();
        assert_eq!(get_stream(&chain, id).total_deposited, 500.into());
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn test_full_vesting_time(chain: psibase::Chain) {
        let test = TestHelper::new(chain);
        let stream = test.create_stream(ALICE, 500);

        let alice_balance_before = test.get_balance(ALICE);

        // Wait for 1 less than the full vesting time
        let expected_full_vesting_wait_time = full_vesting_time(TestHelper::HALF_LIFE, 500);
        test.pass_time(expected_full_vesting_wait_time - 1);
        test.claim(ALICE, stream);
        let total_claimed = test.get_balance(ALICE) - alice_balance_before;
        assert!(
            total_claimed == 499.into(),
            "Alice should not have claimed the full balance. She claimed {} of 500",
            total_claimed.value
        );

        // Finish waiting full vesting time
        test.pass_time(1);
        test.claim(ALICE, stream);
        let total_claimed = test.get_balance(ALICE) - alice_balance_before;
        assert_eq!(total_claimed, 500.into());
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn claiming_sparsely_is_same_as_regularly(chain: psibase::Chain) {
        let test = TestHelper::new(chain);

        test.credit(ALICE, BOB, 100_000);
        let stream1 = test.create_stream(BOB, 100_000);

        test.credit(ALICE, CHARLIE, 100_000);
        let stream2 = test.create_stream(CHARLIE, 100_000);

        for _ in 0..8 {
            test.pass_time(50);
            test.claim(BOB, stream1);
        }

        test.claim(CHARLIE, stream2);

        assert_eq!(
            test.get_balance(BOB).value,
            test.get_balance(CHARLIE).value,
            "Balances should match after claims"
        );
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn multiple_deposits_same_stream(chain: psibase::Chain) {
        let test = TestHelper::new(chain);
        let stream = test.create_stream(ALICE, 300);

        // Check second deposit works
        test.pass_time(50);
        test.deposit(ALICE, stream, 200);
        assert_eq!(test.stream(stream).total_deposited, 500.into());

        // Check claim still works
        test.pass_time(50);
        test.claim(ALICE, stream);
        assert!(
            test.get_balance(ALICE).value > 0,
            "Alice should have claimed some tokens"
        );
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn stream_transfer_preserves_vesting(chain: psibase::Chain) {
        let test = TestHelper::new(chain);
        let stream = test.create_stream(ALICE, 500);

        test.pass_time(50);

        test.transfer_stream_ownership(ALICE, BOB, stream);
        test.transfer_stream_ownership(BOB, CHARLIE, stream);

        test.pass_time(50);

        test.claim(CHARLIE, stream);
        assert!(
            test.get_balance(CHARLIE).value > 0,
            "Charlie should claim vested tokens"
        );
        assert_eq!(
            test.stream(stream).total_deposited,
            500.into(),
            "Total deposited should remain unchanged"
        );
    }

    #[psibase::test_case(packages("TokenStream"))]
    fn precision_check(chain: psibase::Chain) {
        let test = TestHelper::new(chain);
        let stream_nft_id = test.create_stream(ALICE, 80_000);

        let alice_balance_before = test.get_balance(ALICE);
        test.pass_time(TestHelper::HALF_LIFE as i64 * 3);
        test.claim(ALICE, stream_nft_id);
        let total_claimed = test.get_balance(ALICE) - alice_balance_before;

        assert!(
            (69_999..=70_001).contains(&total_claimed.value),
            "Claimed amount {} not in expected range 69_999..=70_001",
            total_claimed.value
        );
    }
}
