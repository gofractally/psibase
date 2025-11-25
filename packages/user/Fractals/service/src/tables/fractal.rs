use async_graphql::ComplexObject;
use psibase::{check_none, check_some, AccountNumber, Table, ToServiceSchema};

use crate::tables::tables::{Fractal, FractalMember, FractalMemberTable, FractalTable};

use psibase::services::token_stream::Wrapper as TokenStream;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::services::transact::Wrapper as TransactSvc;

impl Fractal {
    fn new(
        account: AccountNumber,
        name: String,
        mission: String,
        genesis_guild: AccountNumber,
    ) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            account,
            created_at: now,
            mission,
            name,
            judiciary: genesis_guild,
            legislature: genesis_guild,
            ranked_guilds: vec![],
            token: None,
            stream_id: None,
        }
    }

    pub fn add(
        account: AccountNumber,
        name: String,
        mission: String,
        genesis_guild: AccountNumber,
    ) {
        Self::new(account, name, mission, genesis_guild).save();
    }

    pub fn init_token(&mut self) {
        check_none(self.token, "fractal already has a token");
        check_none(self.stream_id, "fractal already has a stream");
        let token_supply = Quantity::from(2100000000);

        let token_id = Tokens::call().create(2.try_into().unwrap(), token_supply);
        Tokens::call().mint(token_id, token_supply, "Fractal token initiation".into());
        let stream_id = TokenStream::call().create(86400 * 7 * 52 * 25, token_id);
        Tokens::call().credit(
            token_id,
            TokenStream::SERVICE,
            token_supply,
            "Stream".into(),
        );
        TokenStream::call().deposit(stream_id, token_supply);

        self.stream_id = Some(stream_id);
        self.token = Some(token_id);
        self.save();
    }

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        FractalTable::read().get_index_pk().get(&(fractal))
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        check_some(Self::get(fractal), "fractal does not exist")
    }

    fn save(&self) {
        FractalTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn members(&self) -> Vec<FractalMember> {
        FractalMemberTable::read()
            .get_index_pk()
            .range(
                (self.account, AccountNumber::new(0))
                    ..=(self.account, AccountNumber::new(u64::MAX)),
            )
            .collect()
    }
}

#[ComplexObject]
impl Fractal {
    async fn memberships(&self) -> Vec<FractalMember> {
        self.members()
    }
}
