use std::collections::HashMap;
use std::u64;

use async_graphql::connection::Connection;
use async_graphql::ComplexObject;
use psibase::services::sites;
use psibase::services::tokens::{Precision, Quantity};

use crate::constants::{token_distributions::TOKEN_SUPPLY, TOKEN_PRECISION};
use crate::constants::{
    DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL, MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
    MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
};
use crate::helpers::weighted_normalization::{weighted_normalization, Algorithm};
use psibase::services::fractals::FractalRole::{
    self, Executive, Judiciary, Legislature, Recruitment,
};

use crate::helpers::{create_managed_account, distribute_by_weight};
use crate::tables::tables::{
    Fractal, FractalMember, FractalMemberTable, FractalTable, Occupation, RewardStream, Role,
    RoleTable,
};
use psibase::{
    check_none, check_some, services::auth_dyn::policy::DynamicAuthPolicy, AccountNumber, Table,
};

use psibase::services::fractals::{self, occu_wrapper};
use psibase::services::tokens::Wrapper as Tokens;
use psibase::services::transact::Wrapper as TransactSvc;
use psibase::{check, get_sender, RawKey, TableQuery, TimePointSec};

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
            dist_strat: Algorithm::Constant as u8,
            genesis_time: now,
            dist_interval_secs: DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL,
        }
    }

    pub fn set_distribution_interval(&mut self, seconds: u32) {
        check(
            seconds >= MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
            "distribution interval too short",
        );
        check(
            seconds <= MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS,
            "distribution interval too long",
        );
        self.dist_interval_secs = seconds;
        self.save();
    }

    pub fn set_distribution_strategy(&mut self, strategy: Algorithm) {
        self.dist_strat = strategy as u8;
        self.save();
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
        check_none(Self::get(fractal), "fractal already exists");
        let new_instance = Self::new(fractal, name, mission);

        // Save the fractal first prior to creating an account for it
        // as AuthDyn expects `has_policy` to return true when setting the fractals
        // auth service to AuthDyn.
        new_instance.save();

        let defacto_service = "de-facto".into();

        let create_role = |role_account: AccountNumber, role: FractalRole| {
            Role::add(fractal, role_account, role, defacto_service)
        };

        create_role(legislature, Legislature);
        create_role(judiciary, Judiciary);
        create_role(executive, Executive);
        create_role(recruitment, Recruitment);

        create_managed_account(fractal, || {
            sites::Wrapper::call_as(fractal).setProxy("fractal-core".into());
        });

        FractalMember::add(fractal, get_sender(), None);

        new_instance
    }

    pub fn get_by_role_account(role_account: AccountNumber) -> Option<Self> {
        Role::get_by_role_account(role_account).and_then(|role| Fractal::get(role.fractal))
    }

    pub fn by_sender() -> Self {
        Self::get_assert(get_sender())
    }

    pub fn set_genesis_time(&mut self, new_time: TimePointSec) {
        check(
            new_time.seconds < self.genesis_time.seconds,
            "genesis time can only be moved earlier, not later",
        );
        self.genesis_time = new_time;
        self.save();
    }

    fn role_account(&self, role: FractalRole) -> AccountNumber {
        Role::get_assert(self.account, role).account
    }

    pub fn check_sender_is_legislature(&self) {
        check(
            self.role_account(FractalRole::Legislature) == get_sender(),
            "Requires legislature authority",
        );
    }

    pub fn check_sender_is_judiciary(&self) {
        check(
            self.role_account(FractalRole::Judiciary) == get_sender(),
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
        let tokens = psibase::services::tokens::Wrapper::call();

        check(
            tokens.getToken(self.token_id).issued_supply.value == 0,
            "token already initialised",
        );
        let stream = RewardStream::add_fractal(self.account, self.token_id);
        let supply = TOKEN_SUPPLY.into();
        tokens.mint(self.token_id, supply, "initial mint".into());
        stream.deposit(supply, "initial stream deposit".into());
    }

    pub fn reward_stream(&self) -> RewardStream {
        check_some(
            RewardStream::get(self.account, self.account),
            "fractal does not have reward stream",
        )
    }

    fn get_weighted_occupations(
        &self,
        total_distribution: Quantity,
    ) -> (Vec<(Occupation, u64)>, u64) {
        distribute_by_weight(
            weighted_normalization(
                self.dist_strat.into(),
                Occupation::get_ordered(self.account),
            ),
            total_distribution.value,
        )
    }

    pub fn distribute_tokens(&self) {
        let mut stream = self.reward_stream();
        let (_, withdrawn) = stream.claim();
        if withdrawn.value == 0 {
            return;
        }
        let members = FractalMember::get_all(self.account);

        let mut total_dust = 0u64;
        let mut payable_members = HashMap::new();

        let (occupation_distributions, dust) = self.get_weighted_occupations(withdrawn);

        total_dust += dust;

        for (occupation_distribution, distribution_dust) in occupation_distributions {
            let scores: Vec<(AccountNumber, u64)> =
                occu_wrapper::call_to(occupation_distribution.occupation)
                    .get_scores(self.account)
                    .into_iter()
                    .filter(|(mem, _)| members.iter().any(|member| member.account == *mem))
                    .map(|(item, score)| (item, score as u64))
                    .collect();

            let (member_distributions, member_dust) =
                distribute_by_weight(scores, distribution_dust);
            total_dust += member_dust;

            for (member, amount) in member_distributions {
                if amount > 0 {
                    let new_balance =
                        *payable_members.entry(member).or_insert(0.into()) + amount.into();
                    payable_members.insert(member, new_balance);
                }
            }
        }

        if total_dust > 0 {
            stream.deposit(total_dust.into(), "Dust recycle".into());
        }

        for (member, amount) in payable_members {
            RewardStream::get_assert(self.account, member).deposit(amount, "Fractal reward".into());
        }
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
