use async_graphql::connection::Connection;
use async_graphql::ComplexObject;
use psibase::services::sites;
use psibase::services::tokens::{Precision, Quantity};

use crate::constants::{token_distributions::TOKEN_SUPPLY, TOKEN_PRECISION};
use crate::constants::{
    DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL, MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
    MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
};
use psibase::services::fractals::distribute::{allocations, combine_group_scores};
use psibase::services::fractals::weighted_normalization::{
    curves::{get_curve, Curve},
    weighted_normalization,
};
use psibase::services::fractals::FractalRole::{
    self, Executive, Judiciary, Legislature, Recruitment,
};

use crate::helpers::create_managed_account;
use crate::tables::tables::{
    Fractal, FractalMember, FractalMemberTable, FractalTable, Occupation, RewardStream, Role,
    RoleTable,
};
use psibase::{
    account, services::auth_dyn::policy::DynamicAuthPolicy, AccountNumber, ServiceWrapper, Table,
};

use psibase::services::fractals::{self, occu_wrapper};
use psibase::services::tokens::Wrapper as Tokens;
use psibase::services::transact::Wrapper as TransactSvc;
use psibase::{get_sender, RawKey, TableQuery, TimePointSec};

impl Fractal {
    fn new(account: AccountNumber, name: String, mission: String) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        let max_supply: Quantity = TOKEN_SUPPLY.into();
        let precision: Precision = TOKEN_PRECISION.try_into().unwrap();

        Self {
            token_id: Tokens::call().create(precision, max_supply),
            account,
            created_at: now,
            mission,
            name,
            dist_strat: Curve::Constant as u8,
            genesis_time: now,
            dist_interval_secs: DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL,
        }
    }

    pub fn set_distribution_interval(&mut self, seconds: u32) {
        assert!(
            seconds >= MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
            "distribution interval too short",
        );
        assert!(
            seconds <= MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
            "distribution interval too long",
        );
        self.dist_interval_secs = seconds;
        self.save();
    }

    pub fn set_distribution_strategy(&mut self, strategy: Curve) {
        self.dist_strat = strategy as u8;
        self.save();
    }

    pub fn by_sender() -> Self {
        let sender = get_sender();
        Self::get_assert(sender)
    }

    pub fn add(
        fractal: AccountNumber,
        legislature: AccountNumber,
        judiciary: AccountNumber,
        executive: AccountNumber,
        recruitment: AccountNumber,
        name: String,
        mission: String,
    ) -> Self {
        assert!(Self::get(fractal).is_none(), "fractal already exists");
        let new_instance = Self::new(fractal, name, mission);

        // Save the fractal first prior to creating an account for it
        // as AuthDyn expects `has_policy` to return true when setting the fractals
        // auth service to AuthDyn.
        new_instance.save();

        let defacto_service = account!("fractals+2");

        let create_role = |role_account: AccountNumber, role: FractalRole| {
            Role::add(fractal, role_account, role, defacto_service)
        };

        create_role(legislature, Legislature);
        create_role(judiciary, Judiciary);
        create_role(executive, Executive);
        create_role(recruitment, Recruitment);

        create_managed_account(fractal, || {
            sites::Wrapper::call_as(fractal).setProxy(account!("fractal-cr"));
        });

        FractalMember::add(fractal, get_sender(), None);

        new_instance
    }

    pub fn set_genesis_time(&mut self, new_time: TimePointSec) {
        // Genesis time can only be moved earlier, not later, to prevent abuse / delay of token distribution
        assert!(
            new_time.seconds < self.genesis_time.seconds,
            "genesis time can only be moved earlier, not later",
        );
        self.genesis_time = new_time;
        self.save();
    }

    fn role_account(&self, role: FractalRole) -> AccountNumber {
        Role::get_assert(self.account, role).account
    }

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        FractalTable::read().get_index_pk().get(&(fractal))
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        Self::get(fractal).expect(&format!("fractal {} does not exist", fractal.to_string()))
    }

    pub fn init_token(&self) {
        let tokens = psibase::services::tokens::Wrapper::call();

        assert_eq!(
            tokens.getToken(self.token_id).issued_supply.value,
            0,
            "token already initialised",
        );
        let stream = RewardStream::add_fractal(self.account, self.token_id);
        let supply = TOKEN_SUPPLY.into();
        tokens.mint(self.token_id, supply, "initial mint".into());
        stream.deposit(supply, "initial stream deposit".into());
    }

    fn reward_stream(&self) -> RewardStream {
        RewardStream::get(self.account, self.account).expect("fractal does not have reward stream")
    }

    pub fn distribute_tokens(&self) {
        let mut stream = self.reward_stream();
        let (_, withdrawn) = stream.claim();
        if withdrawn.value == 0 {
            return;
        }

        let mut dust = withdrawn.value;
        allocations(self.member_reward_shares(), withdrawn.value).for_each(|(member, amount)| {
            dust -= amount;
            RewardStream::get_assert(self.account, member)
                .deposit(amount.into(), "Fractal reward".into());
        });

        if dust > 0 {
            stream.deposit(dust.into(), "Dust recycle".into());
        }
    }

    fn member_reward_shares(&self) -> std::collections::HashMap<AccountNumber, u32> {
        let members = FractalMember::get_all(self.account);
        let is_member = |acc: &AccountNumber| members.iter().any(|m| m.account == *acc);

        let ranked_occ = Occupation::get_ordered(self.account);
        let weights = weighted_normalization(ranked_occ.iter(), get_curve(self.dist_strat.into()));

        let groups = ranked_occ.into_iter().zip(weights).map(|(occ, w)| {
            let member_scores = occu_wrapper::call_to(occ.occupation)
                .get_scores(self.account)
                .into_iter()
                .filter(|(m, _)| is_member(m));
            (w, member_scores)
        });

        combine_group_scores(groups)
    }

    fn save(&self) {
        FractalTable::read_write()
            .put(&self)
            .expect("failed to save");
    }

    pub fn auth_policy(&self) -> DynamicAuthPolicy {
        DynamicAuthPolicy::from_sole_authorizer(self.role_account(FractalRole::Legislature))
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

    async fn roles(
        &self,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<RawKey, Role>> {
        TableQuery::subindex::<AccountNumber>(
            RoleTable::with_service(fractals::SERVICE).get_index_pk(),
            &(self.account),
        )
        .first(first)
        .last(last)
        .before(before)
        .after(after)
        .query()
        .await
    }

    async fn legislature(&self) -> Role {
        Role::get_assert(self.account, Legislature)
    }

    async fn judiciary(&self) -> Role {
        Role::get_assert(self.account, Judiciary)
    }

    async fn executive(&self) -> Role {
        Role::get_assert(self.account, Executive)
    }

    async fn recruitment(&self) -> Role {
        Role::get_assert(self.account, Recruitment)
    }

    async fn stream(&self) -> Option<RewardStream> {
        RewardStream::get(self.account, self.account)
    }
}
