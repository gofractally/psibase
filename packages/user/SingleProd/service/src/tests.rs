#[cfg(test)]
mod tests {
    use psibase::services::{
        nft::Wrapper as Nft,
        producers::Wrapper as Producers,
        symbol::Wrapper as Symbol,
        tokens::{Precision, TokenFlags, Wrapper as Tokens},
        virtual_server::Wrapper as VirtualServer,
    };
    use psibase::FlagsType;
    use psibase::*;

    #[psibase::test_case(packages("SingleProd"))]
    fn sets_up_private_network(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let producer = Producers::push(&chain).getProducers().get()?[0];
        let token = Tokens::push(&chain)
            .getSysToken()
            .get()?
            .expect("system token");

        assert_eq!(token.precision, Precision::new(4).unwrap());
        assert_eq!(token.max_issued_supply.value, 21_000_000_000_0000);
        assert_eq!(token.issued_supply.value, token.max_issued_supply.value);
        assert!(Tokens::push(&chain)
            .getTokenConf(token.id, TokenFlags::UNTRANSFERABLE.index())
            .get()?);

        let mapping = Symbol::push(&chain)
            .getMapBySym(account!("psi"))
            .get()?
            .expect("psi mapping");
        assert_eq!(mapping.tokenId, token.id);

        let nft = Nft::push(&chain).getNft(token.nft_id).get()?;
        assert_eq!(nft.owner, producer);
        assert_eq!(nft.issuer, Tokens::SERVICE);

        let balance = Tokens::push(&chain).getBalance(token.id, producer).get()?;
        let reserve = Tokens::push_from(&chain, VirtualServer::SERVICE)
            .getSubBal(token.id, producer.to_string())
            .get()?
            .expect("producer resource reserve");
        assert!(reserve.value > 0);
        assert_eq!(balance.value + reserve.value, token.max_issued_supply.value);

        assert_eq!(
            VirtualServer::push(&chain).get_fee_receiver().get()?,
            Some(producer)
        );
        assert!(!VirtualServer::push(&chain).is_billing_enabled().get()?);
        assert_eq!(Producers::push(&chain).getMaxProds().get()?, 3);

        Ok(())
    }
}
