#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("Difficulty"))]
    fn test_set_thing(mut chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.set_auto_block_start(false);

        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let nft_id = Wrapper::push_from(&chain, alice)
            .create(3000.into(), 60, 5, 500.into(), 5)
            .get()?;

        // price does not increase after 4
        for _ in 0..4 {
            Wrapper::push_from(&chain, alice).increment(nft_id);
        }
        assert_eq!(Wrapper::push(&chain).get_price(nft_id).get()?, 3000.into());

        // Reduces after a minute
        chain.start_block_after(Seconds::new(60).into());

        assert_eq!(Wrapper::push(&chain).get_price(nft_id).get()?, 2850.into());

        for _ in 0..6 {
            Wrapper::push_from(&chain, alice).increment(nft_id);
            chain.start_block_after(Seconds::new(2).into());
        }

        // 6 sales increases the price by 5%
        assert_eq!(Wrapper::push(&chain).get_price(nft_id).get()?, 2992.into());

        Ok(())
    }
}
