#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use psibase::services::fractals::constants::PPM;
    use psibase::services::fractals::distribute::{allocations, combine_group_scores};
    use psibase::services::fractals::weighted_normalization::fib::continuous_fibonacci;
    use psibase::services::fractals::weighted_normalization::{
        curves::{get_curve, Curve},
        weighted_normalization, HasScore,
    };
    use psibase::services::tokens::{Decimal, Precision};
    use psibase::{account, AccountNumber};

    struct Score(u64);
    impl HasScore for Score {
        fn get_score(&self) -> Decimal {
            Decimal::new(self.0.into(), Precision::new(0).unwrap())
        }
    }

    #[test]
    fn test_weighted_norm_identity() {
        let items = vec![Score(1), Score(3)];
        let identity_norm = weighted_normalization(items.iter(), get_curve(Curve::Identity));

        assert_eq!(identity_norm, vec![25_0000, 75_0000]);
    }

    #[test]
    fn test_weighted_norm_fib() {
        let items = vec![Score(1), Score(2), Score(3), Score(4), Score(5), Score(6)];

        let mut transformed: Vec<Score> = vec![];
        for item in items.iter() {
            transformed.push(Score(continuous_fibonacci(item.get_score()).quantity.value));
        }

        let fib_norm = weighted_normalization(items.iter(), get_curve(Curve::Fibonacci));
        let fib_norm_2 = weighted_normalization(transformed.iter(), get_curve(Curve::Identity));

        assert_eq!(
            fib_norm, fib_norm_2,
            "fib_norm computed normally != computed manually"
        );
    }

    #[test]
    fn test_weighted_norm_const() {
        let items = vec![Score(1), Score(2), Score(3), Score(4), Score(5), Score(6)];
        let transformed = vec![Score(1), Score(1), Score(1), Score(1), Score(1), Score(1)];

        let const_norm = weighted_normalization(items.iter(), get_curve(Curve::Constant));
        let const_norm_2 = weighted_normalization(transformed.iter(), get_curve(Curve::Identity));

        assert_eq!(
            const_norm, const_norm_2,
            "const_norm computed normally != computed manually"
        );
    }

    #[test]
    fn weighted_normalization_sums_to_ppm() {
        let items = vec![Score(1), Score(2), Score(3)];
        let result = weighted_normalization(items.iter(), get_curve(Curve::Fibonacci));

        assert_eq!(result.len(), 3);

        let sum: u32 = result.iter().sum();
        assert!(sum <= PPM);
        assert!(sum > PPM - result.len() as u32); // Each result floored by integer division
    }

    #[test]
    fn test_combine_group_scores() {
        let alice = account!("alice");
        let bob = account!("bob");

        let groups = vec![
            (60_0000u32, vec![(alice, 50_0000u32), (bob, 50_0000)]),
            (40_0000u32, vec![(alice, 1_000_000u32)]),
        ];
        let result = combine_group_scores(groups);
        assert_eq!(result.get(&alice), Some(&70_0000));
        assert_eq!(result.get(&bob), Some(&30_0000));
    }

    #[test]
    fn test_distribution() {
        let shares = vec![
            (account!("alice"), 33_3333),
            (account!("bob"), 33_3333),
            (account!("carol"), 33_3333),
        ];

        let mut deposits: Vec<(AccountNumber, u64)> = vec![];
        let mut dust = 1000u64;
        allocations(shares, 1000).for_each(|(m, a)| {
            dust -= a;
            deposits.push((m, a));
        });

        assert_eq!(deposits.len(), 3);
        assert!(deposits.iter().all(|(_, a)| *a == 333));
        assert_eq!(dust, 1);
    }
}

mod chain {
    use crate::constants::{
        DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL, DEFAULT_MEMBER_DISTRIBUTION_INTERVAL,
        FRACTAL_STREAM_HALF_LIFE,
    };
    use crate::helpers::donation_sub_account;
    use crate::Wrapper;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::tokens::{BalanceFlags, Quantity, Wrapper as Tokens};
    use psibase::*;

    const ALICE: AccountNumber = account!("alice");
    const FRACTAL: AccountNumber = account!("testfrac");
    const LEG: AccountNumber = account!("tlegisla");
    const JUD: AccountNumber = account!("tjudicia");
    const EXE: AccountNumber = account!("texecuti");
    const REC: AccountNumber = account!("trecruit");

    fn assert_error(result: ChainEmptyResult, message: &str) {
        let err = result.trace.error.unwrap();
        assert!(
            err.contains(message),
            "Error \"{err}\" does not contain: \"{message}\"",
        );
    }

    fn pass_time(chain: &Chain, seconds: i64) {
        chain.start_block_after(Seconds::new(seconds).into());
    }

    fn token_id(chain: &Chain) -> u32 {
        let reply: serde_json::Value = chain
            .graphql(
                Wrapper::SERVICE,
                &format!(r#"query {{ fractal(fractal: "{FRACTAL}") {{ tokenId }} }}"#),
            )
            .unwrap();
        reply["data"]["fractal"]["tokenId"]
            .as_u64()
            .expect(&format!("missing tokenId: {reply}")) as u32
    }

    fn pending_donations(chain: &Chain, tid: u32) -> Quantity {
        Tokens::push_from(chain, Wrapper::SERVICE)
            .getSubBal(tid, donation_sub_account(FRACTAL))
            .get()
            .unwrap()
            .unwrap_or(0.into())
    }

    fn credit(chain: &Chain, tid: u32, amount: u64) {
        Tokens::push_from(chain, ALICE)
            .credit(tid, Wrapper::SERVICE, amount.into(), "".into())
            .get()
            .unwrap();
    }

    fn donate(chain: &Chain, tid: u32, amount: u64) {
        Wrapper::push_from(chain, ALICE)
            .donate(tid, amount.into())
            .get()
            .unwrap();
    }

    fn dist_token(chain: &Chain) {
        Wrapper::push_from(chain, ALICE)
            .dist_token(FRACTAL)
            .get()
            .unwrap();
    }

    fn drain_stream(chain: &Chain) {
        pass_time(chain, FRACTAL_STREAM_HALF_LIFE as i64 * 50);
        dist_token(chain);
    }

    fn setup(chain: &mut Chain) -> u32 {
        chain.new_account(ALICE).unwrap();
        Tokens::push_from(chain, ALICE)
            .setUserConf(BalanceFlags::AUTO_DEBIT.index(), true)
            .get()
            .unwrap();

        Wrapper::push_from(chain, ALICE)
            .create_frac(FRACTAL, LEG, JUD, EXE, REC, "Test".into(), "Mission".into())
            .get()
            .unwrap();
        chain.start_block();

        let tid = token_id(chain);
        let nft_id = Tokens::push(chain).getToken(tid).get().unwrap().nft_id;
        Nfts::push_from(chain, Wrapper::SERVICE)
            .debit(nft_id, "".into())
            .get()
            .unwrap();

        chain
            .propose::<Wrapper>(ALICE, FRACTAL)
            .init_token()
            .get()
            .unwrap();

        drain_stream(chain);
        pass_time(chain, DEFAULT_MEMBER_DISTRIBUTION_INTERVAL as i64);
        Wrapper::push_from(chain, ALICE)
            .claim_rew(FRACTAL, ALICE)
            .get()
            .unwrap();
        // Claiming applies the recruitment levy into the fractal stream; drain it
        // so later dist_token can observe donations (or income) in isolation.
        drain_stream(chain);

        tid
    }

    #[psibase::test_case(packages("Fractals", "AuthDyn", "TokenStream"))]
    fn donate_requires_credit(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        let tid = setup(&mut chain);
        assert_error(
            Wrapper::push_from(&chain, ALICE).donate(tid, 1.into()),
            "Shared balance does not exist",
        );
        Ok(())
    }

    #[psibase::test_case(packages("Fractals", "AuthDyn", "TokenStream"))]
    fn donate_accumulates_and_distributes(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        let tid = setup(&mut chain);

        credit(&chain, tid, 1000);
        donate(&chain, tid, 400);
        credit(&chain, tid, 2000);
        donate(&chain, tid, 2000);
        assert_eq!(pending_donations(&chain, tid).value, 2400);

        pass_time(&chain, DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL as i64);
        dist_token(&chain);
        assert_eq!(pending_donations(&chain, tid).value, 0);

        pass_time(&chain, DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL as i64);
        assert_error(
            Wrapper::push_from(&chain, ALICE).dist_token(FRACTAL),
            "nothing to distribute",
        );

        credit(&chain, tid, 500);
        donate(&chain, tid, 500);
        assert_eq!(pending_donations(&chain, tid).value, 500);
        dist_token(&chain);
        assert_eq!(pending_donations(&chain, tid).value, 0);

        Ok(())
    }

    #[psibase::test_case(packages("Fractals", "AuthDyn", "TokenStream"))]
    fn income_increases_later_withdrawal(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        let tid = setup(&mut chain);

        let income_amount: u64 = 1_000_000_000;
        credit(&chain, tid, income_amount);
        Wrapper::push_from(&chain, ALICE)
            .income(tid, income_amount.into())
            .get()?;

        pass_time(&chain, DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL as i64);
        dist_token(&chain);

        pass_time(&chain, DEFAULT_MEMBER_DISTRIBUTION_INTERVAL as i64);
        let before = Tokens::push(&chain).getBalance(tid, ALICE).get()?.value;
        Wrapper::push_from(&chain, ALICE)
            .claim_rew(FRACTAL, ALICE)
            .get()?;
        let after = Tokens::push(&chain).getBalance(tid, ALICE).get()?.value;
        assert!(
            after > before,
            "income should increase a later member claim ({before} -> {after})",
        );

        Ok(())
    }
}
