use async_graphql::connection::Connection;
use async_graphql::ComplexObject;
use psibase::services::tokens::{Precision, Quantity};

use crate::constants::{token_distributions::TOKEN_SUPPLY, TOKEN_PRECISION};
use crate::tables::tables::{
    Fractal, FractalMember, FractalMemberTable, FractalTable, RewardConsensus,
};
use psibase::{
    check_none, check_some, services::auth_dyn::policy::DynamicAuthPolicy, AccountNumber, Table,
};

use psibase::services::fractals;
use psibase::services::tokens::Wrapper as Tokens;
use psibase::services::transact::Wrapper as TransactSvc;
use psibase::{check, get_sender, RawKey, TableQuery};

impl Fractal {
    fn new(
        account: AccountNumber,
        initial_occupation: AccountNumber,
        name: String,
        mission: String,
    ) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let max_supply: Quantity = TOKEN_SUPPLY.into();
        let precision: Precision = TOKEN_PRECISION.try_into().unwrap();

        Self {
            token_id: Tokens::call().create(precision, max_supply),
            account,
            created_at: now,
            mission,
            name,
            judiciary: initial_occupation,
            legislature: initial_occupation,
        }
    }

    fn create_account(&self) {
        let fractal_account = self.account;

        use psibase::services::{accounts, auth_dyn, sites};
        if !accounts::Wrapper::call().exists(fractal_account) {
            accounts::Wrapper::call().newAccount(fractal_account, "auth-any".into(), true);
        }

        sites::Wrapper::call_as(fractal_account).setProxy("fractal-core".into());
        auth_dyn::Wrapper::call_as(fractal_account)
            .set_mgmt(fractal_account, crate::Wrapper::SERVICE);
        accounts::Wrapper::call_as(fractal_account).setAuthServ(auth_dyn::Wrapper::SERVICE)
    }

    pub fn add(
        account: AccountNumber,
        initial_occupation: AccountNumber,
        name: String,
        mission: String,
    ) -> Self {
        check_none(Self::get(account), "fractal already exists");
        let new_instance = Self::new(account, initial_occupation, name, mission);

        // Save the fractal first prior to creating an account for it
        // as AuthDyn expects `has_policy` to return true when setting the fractals
        // auth service to AuthDyn.
        new_instance.save();
        new_instance.create_account();
        new_instance
    }

    pub fn check_sender_is_legislature(&self) {
        check(
            self.legislature == get_sender(),
            "Requires legislature authority",
        );
    }

    pub fn check_sender_is_judiciary(&self) {
        check(
            self.judiciary == get_sender(),
            "Requires judiciary authority",
        );
    }

    pub fn check_sender_is_fractal(&self) {
        check(self.account == get_sender(), "Requires fractal authority");
    }

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        FractalTable::read().get_index_pk().get(&(fractal))
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        check_some(
            Self::get(fractal),
            &format!("fractal {} does not exist", fractal.to_string()),
        )
    }

    pub fn init_token(&self) {
        // let legislature_guild = Guild::get_assert(self.legislature);

        // let reward_consensus = RewardConsensus::get(self.account);

        // let is_first_distribution = reward_consensus.is_none();

        // if is_first_distribution {
        //     check(
        //         legislature_guild.active_member_count() >= self.token_init_threshold.into(),
        //         "active member count does not meet token init threshold",
        //     );
        //     RewardConsensus::add(self.account, INITIAL_REWARD_DISTRIBUTION.into());
        // } else {
        //     check(
        //         legislature_guild.is_rank_ordering(),
        //         "cannot distribute remaining tokens until rank ordering is enabled",
        //     );

        //     let reward_consensus = reward_consensus.unwrap();

        //     let supply = psibase::services::token_stream::Wrapper::call()
        //         .get_stream(reward_consensus.reward_stream_id)
        //         .unwrap();
        //     let is_second_distrbution = supply.total_deposited < REWARD_DISTRIBUTION.into();

        //     check(
        //         is_second_distrbution,
        //         "remaining consensus rewards already distributed",
        //     );
        //     reward_consensus.deposit(
        //         REMAINING_REWARD_DISTRIBUTION.into(),
        //         "Consensus rewards for ranked evaluations".into(),
        //     );
        // }
    }

    fn save(&self) {
        FractalTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn auth_policy(&self) -> DynamicAuthPolicy {
        DynamicAuthPolicy::from_sole_authorizer(self.legislature)
    }
}

#[ComplexObject]
impl Fractal {
    async fn memberships(
        &self,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<RawKey, FractalMember>> {
        TableQuery::subindex::<AccountNumber>(
            FractalMemberTable::with_service(fractals::SERVICE).get_index_pk(),
            &(self.account),
        )
        .first(first)
        .last(last)
        .before(before)
        .after(after)
        .query()
        .await
    }

    async fn consensus_reward(&self) -> Option<RewardConsensus> {
        RewardConsensus::get(self.account)
    }
}
