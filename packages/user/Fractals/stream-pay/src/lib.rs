#[psibase::service_tables]
pub mod tables {
    use psibase::{
        check_some,
        services::tokens::{Quantity, TID},
        AccountNumber, Fracpack, Table, ToSchema,
    };

    use async_graphql::SimpleObject;

    use serde::{Deserialize, Serialize};

    const ONE_DAY: u32 = 86400;
    const ONE_WEEK: u32 = ONE_DAY * 7;
    const ONE_YEAR: u32 = ONE_WEEK * 52;
    pub const FRACTAL_STREAM_HALF_LIFE: u32 = ONE_YEAR * 25;

    #[table(name = "StreamTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Stream {
        pub fractal: AccountNumber,
        pub member: AccountNumber,
        pub nft_id: u32,
        pub token_id: TID,
    }

    impl Stream {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, TID) {
            (self.fractal, self.member, self.token_id)
        }

        pub fn get(fractal: AccountNumber, member: AccountNumber, token_id: TID) -> Option<Self> {
            StreamTable::read()
                .get_index_pk()
                .get(&(fractal, member, token_id))
        }

        pub fn get_assert(fractal: AccountNumber, member: AccountNumber, token_id: TID) -> Self {
            check_some(
                Self::get(fractal, member, token_id),
                "stream does not exist",
            )
        }

        pub fn get_or_create(fractal: AccountNumber, member: AccountNumber, token_id: TID) -> Self {
            Self::get(fractal, member, token_id)
                .unwrap_or_else(|| Self::add(fractal, member, token_id))
        }

        pub fn deposit(&self, amount: Quantity) {
            psibase::services::token_stream::Wrapper::call().deposit(self.nft_id, amount);
        }

        fn new(fractal: AccountNumber, member: AccountNumber, token_id: TID, nft_id: u32) -> Self {
            Self {
                fractal,
                member,
                token_id,
                nft_id,
            }
        }

        fn add(fractal: AccountNumber, member: AccountNumber, token_id: u32) -> Self {
            let nft_id = psibase::services::token_stream::Wrapper::call()
                .create(FRACTAL_STREAM_HALF_LIFE, token_id);
            let new_instance = Self::new(fractal, member, token_id, nft_id);
            new_instance.save();
            new_instance
        }

        fn save(&self) {
            StreamTable::read_write().put(&self).unwrap();
        }
    }
}

#[psibase::service(name = "stream-pay", tables = "tables")]
pub mod service {
    use psibase::{
        services::tokens::{Quantity, TID},
        *,
    };

    use crate::tables::Stream;

    #[action]
    fn on_payment(fractal: AccountNumber, member: AccountNumber, token_id: TID, amount: Quantity) {
        psibase::services::tokens::Wrapper::call().debit(
            token_id,
            psibase::services::fractals::SERVICE,
            amount,
            "".into(),
        );
        Stream::get_or_create(fractal, member, token_id).deposit(amount);
    }

    #[action]
    fn is_supported(fractal: AccountNumber) -> bool {
        ::fractals::tables::tables::FractalTable::read()
            .get_index_pk()
            .get(&fractal)
            .is_some()
    }
}
