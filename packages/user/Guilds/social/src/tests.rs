#![allow(non_snake_case)]

#[test]
fn bid_split_is_110_10_10() {
    use crate::{of_ppm, CUT_PPM, RETURN_PPM};
    let last = 1_000_000u64;
    assert_eq!(of_ppm(last, RETURN_PPM), 1_100_000);
    assert_eq!(of_ppm(last, CUT_PPM), 100_000);
    assert_eq!(crate::next_price(last), 1_300_000);
}

mod chain {
    use crate::next_price;
    use crate::Wrapper;
    use fractals::Wrapper as Fractals;
    use guilds::Wrapper as Guilds;
    use psibase::{Subaccount, *};

    const ALICE: AccountNumber = account!("alice");
    const BOB: AccountNumber = account!("bob");
    const FRACTAL: AccountNumber = account!("testfrac");
    const GUILD: AccountNumber = account!("catsguild");
    const THREAD: AccountNumber = account!("cats");

    fn assert_error(result: ChainEmptyResult, message: &str) {
        let err = result.trace.error.unwrap();
        assert!(
            err.contains(message),
            "Error \"{err}\" does not contain: \"{message}\"",
        );
    }

    fn setup(chain: &mut Chain) -> u32 {
        chain.new_account(ALICE).unwrap();
        chain.new_account(BOB).unwrap();
        Fractals::push_from(chain, ALICE)
            .create_frac(FRACTAL, "Test".into(), "Mission".into())
            .get()
            .unwrap();
        chain.start_block();
        let tid = token_id(chain);
        chain
            .propose::<Fractals>(ALICE, FRACTAL)
            .init_token()
            .get()
            .unwrap();
        Guilds::push_from(chain, ALICE)
            .create_guild(FRACTAL, GUILD, "Cats".into())
            .get()
            .unwrap();
        tid
    }

    fn token_id(chain: &Chain) -> u32 {
        let reply: serde_json::Value = chain
            .graphql(
                Fractals::SERVICE,
                &format!(r#"query {{ fractal(fractal: "{FRACTAL}") {{ tokenId }} }}"#),
            )
            .unwrap();
        reply["data"]["fractal"]["tokenId"].as_u64().unwrap() as u32
    }

    #[psibase::test_case(packages(
        "Guilds",
        "Fractals",
        "AuthDyn",
        "TokenStream",
        "DiffAdjust",
        "Tokens",
        "Nft"
    ))]
    fn next_price_is_at_least_one_above(mut _chain: psibase::Chain) -> Result<(), psibase::Error> {
        assert_eq!(next_price(100), 130);
        assert_eq!(next_price(1), 2);
        Ok(())
    }

    #[psibase::test_case(packages(
        "Guilds",
        "Fractals",
        "AuthDyn",
        "TokenStream",
        "DiffAdjust",
        "Tokens",
        "Nft"
    ))]
    fn an_outsider_cannot_post_in_a_private_thread(
        mut chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        setup(&mut chain);
        chain
            .propose::<Wrapper>(ALICE, GUILD)
            .create_thread(THREAD, "Cats".into(), false)
            .get()?;

        assert_error(
            Wrapper::push_from(&chain, BOB).post(FRACTAL, THREAD, "".into(), "hi".into(), 1_000),
            "thread is not visible to you",
        );
        Ok(())
    }

    #[psibase::test_case(packages(
        "Guilds",
        "Fractals",
        "AuthDyn",
        "TokenStream",
        "DiffAdjust",
        "Tokens",
        "Nft"
    ))]
    fn the_creating_guild_can_adjust_the_posting_fee(
        mut chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        setup(&mut chain);
        chain
            .propose::<Wrapper>(ALICE, GUILD)
            .create_thread(THREAD, "Cats".into(), false)
            .get()?;

        chain
            .propose::<Wrapper>(ALICE, GUILD)
            .set_fee(FRACTAL, THREAD, 86_400, 1, 4, 500, 100_000, 50_000)
            .get()?;

        let legislature = FRACTAL.with_subaccount(Subaccount(1));
        assert_error(
            chain
                .propose::<Wrapper>(ALICE, legislature)
                .set_fee(FRACTAL, THREAD, 86_400, 1, 4, 500, 100_000, 50_000),
            "not a moderator of this thread",
        );
        Ok(())
    }
}
