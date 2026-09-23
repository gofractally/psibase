#[psibase::service(name = "singleprod")]
mod service {
    use psibase::services::{
        nft::Wrapper as Nft,
        producers::Wrapper as Producers,
        symbol::Wrapper as Symbol,
        tokens::{Precision, Quantity, TokenFlags, TokenRecord, Wrapper as Tokens},
        virtual_server::Wrapper as VirtualServer,
    };
    use psibase::FlagsType;
    use psibase::*;

    const MAX_SUPPLY: u64 = 21_000_000_000_0000;
    const PRECISION: u8 = 4;
    const SYSTEM_SYMBOL: AccountNumber = account!("psi");
    const MAX_PRODUCERS: u8 = 3;

    fn producer() -> AccountNumber {
        *Producers::call()
            .getProducers()
            .first()
            .expect("no producer")
    }

    fn sys_token() -> TokenRecord {
        Tokens::call().getSysToken().expect("system token not set")
    }

    /// Create the untransferable system token and take its issuer NFT.
    #[action]
    fn create_token() {
        let id = Tokens::call().create(Precision::new(PRECISION).unwrap(), MAX_SUPPLY.into());
        let nft_id = Tokens::call().getToken(id).nft_id;
        Nft::call().debit(nft_id, "".into());
        Tokens::call().setTokenConf(id, TokenFlags::UNTRANSFERABLE.index(), true);
        Tokens::call_as(Tokens::SERVICE).setSysToken(id);
    }

    /// Map the system token to the `psi` symbol.
    #[action]
    fn set_symbol() {
        let tid = sys_token().id;
        Symbol::call_as(Symbol::SERVICE).admin_create(SYSTEM_SYMBOL, Wrapper::SERVICE);

        let symbol = Symbol::call().getSymbol(SYSTEM_SYMBOL);
        Nft::call().debit(symbol.ownerNft, "".into());
        Nft::call().credit(symbol.ownerNft, Symbol::SERVICE, "".into());
        Symbol::call().mapSymbol(tid, SYSTEM_SYMBOL);
    }

    /// Point resource fees at the producer. Billing stays disabled.
    #[action]
    fn init_billing() {
        VirtualServer::call_as(VirtualServer::SERVICE).init_billing(producer());
    }

    /// Mint the full supply, fill the producer's resource buffer, and give
    /// the producer the remaining tokens plus the issuer NFT.
    #[action]
    fn fund_producer() {
        assert_eq!(get_sender(), Wrapper::SERVICE, "Unauthorized");
        let token = sys_token();
        let tid = token.id;
        let producer = producer();
        let supply = token.max_issued_supply;
        Tokens::call().mint(tid, supply, "initial mint".into());

        let resources = VirtualServer::call().std_buffer_cost();
        Tokens::call().credit(tid, VirtualServer::SERVICE, resources, "".into());
        VirtualServer::call().buy_res_for(resources, producer, None);

        let remaining = Quantity::new(supply.value - resources.value);
        Tokens::call().credit(tid, producer, remaining, "system token".into());
        Tokens::call_from(producer).debit(tid, Wrapper::SERVICE, remaining, "".into());

        Nft::call().credit(token.nft_id, producer, "issuer".into());
        Nft::call_from(producer).debit(token.nft_id, "".into());
    }

    /// Cap the producer set at 3.
    #[action]
    fn set_max_prods() {
        Producers::call_as(Producers::SERVICE).setMaxProds(MAX_PRODUCERS);
    }
}

#[cfg(test)]
mod tests;
