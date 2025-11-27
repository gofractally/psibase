use async_graphql::ComplexObject;
use psibase::services::tokens::Quantity;
use psibase::{check_some, AccountNumber, Table};
use std::str::FromStr;

use crate::tables::tables::{
    ConsensusReward, Fractal, FractalMember, FractalMemberTable, FractalTable,
};

use psibase::services::tokens::Decimal;
use psibase::services::tokens::Wrapper as Tokens;
use psibase::services::transact::Wrapper as TransactSvc;

impl Fractal {
    fn new(
        account: AccountNumber,
        name: String,
        mission: String,
        genesis_guild: AccountNumber,
    ) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let max_supply = Decimal::from_str("21000000.0000").unwrap();

        Self {
            account,
            created_at: now,
            mission,
            name,
            judiciary: genesis_guild,
            legislature: genesis_guild,
            token_id: Tokens::call().create(max_supply.precision, max_supply.quantity),
        }
    }

    pub fn add(
        account: AccountNumber,
        name: String,
        mission: String,
        genesis_guild: AccountNumber,
    ) -> Self {
        let new_instance = Self::new(account, name, mission, genesis_guild);
        new_instance.save();
        new_instance
    }

    pub fn init_token(&mut self) {
        let total_supply = Tokens::call().getToken(self.token_id).max_issued_supply;
        let quarter_supply: Quantity = (total_supply.value / 4).into();

        Tokens::call().mint(
            self.token_id,
            quarter_supply,
            "Token intitialisation".into(),
        );

        ConsensusReward::add(self.account, self.token_id, quarter_supply);
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
