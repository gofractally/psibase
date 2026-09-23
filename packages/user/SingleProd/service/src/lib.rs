#[psibase::service_tables]
pub mod tables {
    use psibase::services::tokens::TID;
    use psibase::*;

    #[table(name = "ConfigTable", index = 0)]
    #[derive(ToSchema, Pack, Unpack)]
    pub struct ConfigRow {
        pub token_id: TID,
    }

    impl ConfigRow {
        #[primary_key]
        fn pk(&self) {}

        pub fn get() -> Option<Self> {
            ConfigTable::read().get_index_pk().get(&())
        }

        pub fn token_id() -> TID {
            Self::get().expect("singleprod not initialized").token_id
        }
    }
}

#[psibase::service(name = "singleprod", tables = "tables")]
mod service {
    use crate::tables::{ConfigRow, ConfigTable};
    use psibase::services::{
        nft::Wrapper as Nft,
        producers::Wrapper as Producers,
        symbol::Wrapper as Symbol,
        tokens::{Precision, Quantity, TokenFlags, Wrapper as Tokens},
        virtual_server::Wrapper as VirtualServer,
    };
    use psibase::FlagsType;
    use psibase::*;

    /// 21 billion tokens, stored at precision 4.
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

    /// Create the untransferable system token and take its issuer NFT.
    #[action]
    fn create_token() {
        if ConfigRow::get().is_some() {
            return;
        }

        let id = Tokens::call().create(Precision::new(PRECISION).unwrap(), MAX_SUPPLY.into());
        let nft_id = Tokens::call().getToken(id).nft_id;
        Nft::call().debit(nft_id, "".into());
        Tokens::call().setTokenConf(id, TokenFlags::UNTRANSFERABLE.index(), true);
        Tokens::call_as(Tokens::SERVICE).setSysToken(id);

        ConfigTable::read_write()
            .put(&ConfigRow { token_id: id })
            .unwrap();
    }

    /// Map the system token to the `psi` symbol.
    #[action]
    fn set_symbol() {
        if Symbol::call().exists(SYSTEM_SYMBOL) {
            return;
        }

        let tid = ConfigRow::token_id();
        Symbol::call_as(Symbol::SERVICE).admin_create(SYSTEM_SYMBOL, Wrapper::SERVICE);

        // `mapSymbol` debits and burns the symbol NFT as the symbol service,
        // so the NFT has to be credited back to that service first. The sender
        // still owns it until the debit inside `mapSymbol`.
        let symbol = Symbol::call().getSymbol(SYSTEM_SYMBOL);
        Nft::call().debit(symbol.ownerNft, "".into());
        Nft::call().credit(symbol.ownerNft, Symbol::SERVICE, "".into());
        Symbol::call().mapSymbol(tid, SYSTEM_SYMBOL);
    }

    /// Point resource fees at the producer. Billing stays disabled.
    #[action]
    fn init_billing() {
        if VirtualServer::call().get_fee_receiver().is_some() {
            return;
        }
        VirtualServer::call_as(VirtualServer::SERVICE).init_billing(producer());
    }

    /// Mint the full supply, fill the producer's resource buffer, and give
    /// the producer the remaining tokens plus the issuer NFT.
    ///
    /// The token is untransferable, so only the issuer-NFT holder can move it.
    /// This service buys the resource buffer while it still holds both, then
    /// hands them to the producer.
    #[action]
    fn fund_producer() {
        assert_eq!(get_sender(), Wrapper::SERVICE, "Unauthorized");
        let tid = ConfigRow::token_id();
        let producer = producer();
        let token = Tokens::call().getToken(tid);

        if token.issued_supply.value == 0 {
            let supply = token.max_issued_supply;
            Tokens::call().mint(tid, supply, "initial mint".into());

            let resources = VirtualServer::call().std_buffer_cost();
            assert!(resources.value > 0, "resource reserve must be non-zero");
            assert!(
                resources.value < supply.value,
                "resource reserve exceeds token supply"
            );

            Tokens::call().credit(tid, VirtualServer::SERVICE, resources, "".into());
            VirtualServer::call().buy_res_for(resources, producer, None);

            let remaining = Quantity::new(supply.value - resources.value);
            Tokens::call().credit(tid, producer, remaining, "system token".into());
            Tokens::call_from(producer).debit(tid, Wrapper::SERVICE, remaining, "".into());
        }

        let nft_id = Tokens::call().getToken(tid).nft_id;
        if Nft::call().getNft(nft_id).owner != producer {
            Nft::call().credit(nft_id, producer, "issuer".into());
            Nft::call_from(producer).debit(nft_id, "".into());
        }
    }

    /// Cap the producer set at 3.
    #[action]
    fn set_max_prods() {
        Producers::call_as(Producers::SERVICE).setMaxProds(MAX_PRODUCERS);
    }
}

#[cfg(test)]
mod tests;
