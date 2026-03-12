#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    // use crate::Wrapper;
    // use psibase::services::nft::Wrapper as Nfts;
    // use psibase::services::tokens::{Precision, Quantity, Wrapper as Tokens};
    // use psibase::*;

    // Creates a system token and distributes it to alice and bob
    // fn initial_setup(chain: &psibase::Chain) -> Result<(), psibase::Error> {
    //     let tokens_service = Tokens::SERVICE;
    //     let symbol = account!("symbol");
    //     let alice = account!("alice");
    //     let bob = account!("bob");

    //     chain.new_account(alice).unwrap();
    //     chain.new_account(bob).unwrap();

    //     let supply: u64 = 10_000_000_000_000_0000u64.into();
    //     let sys = Tokens::push_from(chain, symbol)
    //         .create(Precision::new(4).unwrap(), Quantity::from(supply))
    //         .get()?;

    //     let nid = Tokens::push(&chain).getToken(sys).get()?.nft_id;
    //     Nfts::push_from(chain, symbol).debit(nid, "".into()).get()?;

    //     Tokens::push_from(chain, tokens_service)
    //         .setSysToken(sys)
    //         .get()?;

    //     Tokens::push_from(chain, symbol)
    //         .mint(sys, Quantity::from(supply), "".into())
    //         .get()?;

    //     Tokens::push_from(chain, symbol)
    //         .credit(sys, alice, 100_000_0000u64.into(), "".into())
    //         .get()?;

    //     Tokens::push_from(chain, symbol)
    //         .credit(sys, bob, 100_000_0000u64.into(), "".into())
    //         .get()?;

    //     Ok(())
    // }

    #[psibase::test_case(packages("PremAccounts"))] //, "Tokens", "Nft"))]
    fn test_buy_account(_chain: psibase::Chain) -> Result<(), psibase::Error> {
        println!("test_buy_account().top");

        // initial_setup(&chain)?;

        // use psibase::services::http_server;
        // http_server::Wrapper::push_from(&chain, Wrapper::SERVICE); //.registerServer(Wrapper::SERVICE);
        // println!("Chain initialized");
        Ok(())
        // Wrapper::push(&chain).init();
        // println!("Wrapper::push(&chain).init();");

        // let alice = AccountNumber::from("alice");
        // chain.new_account(alice).unwrap();
        // // println!("chain.new_account(alice).unwrap();");

        // //let result = Wrapper::push(&chain).add(3, 4);
        // // Set up system token
        // // Create token from symbol service (or we can use a test account)
        // let symbol_service = account!("symbol");
        // let sys_token_id = Tokens::push_from(&chain, symbol_service)
        //     .create(
        //         Precision::new(4).unwrap(),
        //         Quantity::from(1_000_000_000_0000),
        //     )
        //     .get()?;
        // println!("Tokens::push_from(&chain, symbol_service).create(Precision::new(4).unwrap(), Quantity::from(1_000_000_000_0000)).get()?;");
        // // Debit the NFT from symbol service
        // let token_info = Tokens::push(&chain).getToken(sys_token_id).get()?;
        // Nfts::push_from(&chain, symbol_service)
        //     .debit(token_info.nft_id, "".to_string().try_into().unwrap());
        // println!("Nfts::push_from(&chain, symbol_service).debit(token_info.nft_id, \"\".to_string().try_into().unwrap());");
        // Tokens::push(&chain).setSysToken(sys_token_id).get()?;
        // println!("Tokens::push(&chain).setSysToken(sys_token_id).get()?;");
        // let mint_amount = Quantity::from(1_000_000_000_0000);
        // Tokens::push_from(&chain, symbol_service)
        //     .mint(
        //         sys_token_id,
        //         mint_amount,
        //         "memo".to_string().try_into().unwrap(),
        //     )
        //     .get()?;
        // println!("Tokens::push_from(&chain, symbol_service).mint(sys_token_id, mint_amount, \"memo\".to_string().try_into().unwrap()).get()?;");
        // Tokens::push_from(&chain, symbol_service)
        //     .setTokenConf(sys_token_id, 0, false) // 0 = untransferable flag
        //     .get()?;
        // println!("Tokens::push_from(&chain, symbol_service).setTokenConf(sys_token_id, 0, false).get()?;");
        // let alice_amount = Quantity::from(1001_0000); // 1001 with 4 decimal precision
        // Tokens::push_from(&chain, symbol_service)
        //     .credit(
        //         sys_token_id,
        //         alice,
        //         alice_amount,
        //         "memo".to_string().try_into().unwrap(),
        //     )
        //     .get()?;
        // println!("Tokens::push_from(&chain, symbol_service).credit(sys_token_id, alice, alice_amount, \"memo\".to_string().try_into().unwrap()).get()?;");
        // // Test buying a short account name (1-9 characters)
        // Wrapper::push_from(&chain, alice)
        //     .buy("test".to_string(), 1001)
        //     .get()?;
        // println!("Wrapper::push_from(&chain, alice).buy(\"test\".to_string(), 1001).get()?;");
        // Ok(())
    }
}
