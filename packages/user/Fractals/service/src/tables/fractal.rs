use async_graphql::connection::Connection;
use async_graphql::ComplexObject;
use psibase::services::tokens::{Precision, Quantity};

use crate::constants::roles::{JUDICIARY, LEGISLATURE};
use crate::constants::{token_distributions::TOKEN_SUPPLY, TOKEN_PRECISION};
use crate::helpers::distribute_by_weight;
use crate::tables::tables::{
    Fractal, FractalMember, FractalMemberTable, FractalTable, Occupation, RewardConsensus,
    RewardStream, Role,
};
use crate::tables::DistributionStrategy;
use psibase::{
    check_none, check_some, services::auth_dyn::policy::DynamicAuthPolicy, AccountNumber, Table,
};

use psibase::services::fractals::{self, occu_wrapper};
use psibase::services::tokens::Wrapper as Tokens;
use psibase::services::transact::Wrapper as TransactSvc;
use psibase::{check, get_sender, RawKey, TableQuery};

impl Fractal {
    fn new(
        account: AccountNumber,
        legislature: AccountNumber,
        judiciary: AccountNumber,
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
            judiciary,
            legislature,
            dist_strat: DistributionStrategy::Constant as u8,
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

    fn distribution_strategy(&self) -> DistributionStrategy {
        match self.dist_strat {
            0 => DistributionStrategy::Constant,
            1 => DistributionStrategy::Fibonacci,
            _ => panic!("invalid distribution strategy"),
        }
    }

    pub fn set_distribution_strategy(&mut self, strategy: DistributionStrategy) {
        self.dist_strat = strategy as u8;
        self.save();
    }

    pub fn add(
        account: AccountNumber,
        legislature: AccountNumber,
        judiciary: AccountNumber,
        name: String,
        mission: String,
    ) -> Self {
        check_none(Self::get(account), "fractal already exists");
        let new_instance = Self::new(account, judiciary, legislature, name, mission);

        // create two new roles for the judiciary and legislature, with the fractal as the auth manager
        Role::add(account, LEGISLATURE, account);
        Role::add(account, JUDICIARY, account);
        // with auth dynamic create account

        // Save the fractal first prior to creating an account for it
        // as AuthDyn expects `has_policy` to return true when setting the fractals
        // auth service to AuthDyn.
        new_instance.save();
        new_instance.create_account();

        // Create the legislature and judicial accounts of index 1 and index 2
        // Then set auth dynamic for the accounts with fractals as the auth policy manager
        // fractals::get_policy is then used
        // if asked for legislature, then we check the occupation,
        // Role table for the role and the occupation it has.
        // Occuptation::get_policy and return that.

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
        let tokens = psibase::services::tokens::Wrapper::call();

        check(
            tokens.getToken(self.token_id).issued_supply.value == 0,
            "token already initialised",
        );
        let stream = RewardStream::add(self.account, self.token_id);
        let supply = TOKEN_SUPPLY.into();
        tokens.mint(self.token_id, supply, "initial mint".into());
        stream.deposit(supply, "initial stream deposit".into());
    }

    pub fn distribute_tokens(&self) {
        let mut stream = RewardStream::get_assert(self.account);
        let withdrawn = stream.withdraw();
        if withdrawn.value == 0 {
            return;
        }
        // figure out occupations + reward strategy
        let members = FractalMember::get_all(self.account);
        match self.distribution_strategy() {
            DistributionStrategy::Constant => {
                // let members = FractalMember::get_all(self.account);

                let occupations = Occupation::get_all(self.account);

                let (distributions, dust) =
                    distribute_by_weight(occupations, |_, __| 1, withdrawn.value);

                for (occupation_distribution, amount) in distributions {
                    
                    let scores: Vec<(AccountNumber, u32)> =
                        occu_wrapper::call_to(occupation_distribution.occupation)
                            .get_scores(self.account)
                            .into_iter()
                            .filter(|(mem, score)| members.iter().any(|member| member.account == mem))
                            .collect();

                    let (member_distributions, member_dust) =
                        distribute_by_weight(scores, |index, member_score| member_score.1, amount);
                }

                if dust > 0 {
                    stream.deposit(dust.into(), "Dust recycle".into());
                }
            }
            DistributionStrategy::Fibonacci => {}
        }
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
