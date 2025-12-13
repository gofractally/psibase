use async_graphql::connection::Connection;
use async_graphql::ComplexObject;
use psibase::services::tokens::{Precision, Quantity};

use crate::constants::{
    DEFAULT_MINIMUM_REQUIRED_SCORERS, MAX_MINIMUM_REQUIRED_SCORERS, MIN_MINIMUM_REQUIRED_SCORERS,
    TOKEN_PRECISION, TOKEN_SUPPLY,
};
use crate::tables::tables::{
    Fractal, FractalMember, FractalMemberTable, FractalTable, RewardConsensus,
};
use psibase::{
    check_none, check_some, services::auth_dyn::policy::DynamicAuthPolicy, AccountNumber, Table,
};

use crate::tables::tables::Guild;

use psibase::services::tokens::Wrapper as Tokens;
use psibase::services::transact::Wrapper as TransactSvc;
use psibase::services::{accounts, fractals, sites, transact};
use psibase::{check, get_sender, Action, RawKey, TableQuery};
use psibase::{fracpack::Pack, services::auth_dyn};

impl Fractal {
    fn new(
        account: AccountNumber,
        name: String,
        mission: String,
        genesis_guild: AccountNumber,
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
            judiciary: genesis_guild,
            legislature: genesis_guild,
            minimum_required_scorers: DEFAULT_MINIMUM_REQUIRED_SCORERS,
        }
    }

    fn create_account(&self) {
        let fractal_account = self.account;
        accounts::Wrapper::call().newAccount(fractal_account, "auth-any".into(), true);

        let set_proxy = Action {
            sender: fractal_account,
            service: sites::SERVICE,
            method: sites::action_structs::setProxy::ACTION_NAME.into(),
            rawData: sites::action_structs::setProxy {
                proxy: "fractal-core".into(),
            }
            .packed()
            .into(),
        };

        let set_policy = Action {
            sender: fractal_account,
            service: auth_dyn::SERVICE,
            method: auth_dyn::action_structs::set_mgmt::ACTION_NAME.into(),
            rawData: auth_dyn::action_structs::set_mgmt {
                account: fractal_account,
                manager: crate::Wrapper::SERVICE,
            }
            .packed()
            .into(),
        };

        let set_auth_serv = Action {
            sender: fractal_account,
            service: accounts::SERVICE,
            method: accounts::action_structs::setAuthServ::ACTION_NAME.into(),
            rawData: accounts::action_structs::setAuthServ {
                authService: auth_dyn::Wrapper::SERVICE,
            }
            .packed()
            .into(),
        };

        transact::Wrapper::call().runAs(set_proxy, vec![]);
        transact::Wrapper::call().runAs(set_policy, vec![]);
        transact::Wrapper::call().runAs(set_auth_serv, vec![]);
    }

    pub fn add(
        account: AccountNumber,
        name: String,
        mission: String,
        genesis_guild: AccountNumber,
    ) -> Self {
        check_none(Self::get(account), "fractal already exists");
        let new_instance = Self::new(account, name, mission, genesis_guild);
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

    pub fn set_minimum_required_scorers(&mut self, minimum_required_scorers: u8) {
        check_none(
            RewardConsensus::get(self.account),
            "reward consensus is already enabled, this setting is now redundant",
        );
        check(
            minimum_required_scorers >= MIN_MINIMUM_REQUIRED_SCORERS,
            "minimum scorers is too low",
        );
        check(
            minimum_required_scorers <= MAX_MINIMUM_REQUIRED_SCORERS,
            "maximum scorers is too high",
        );
        self.minimum_required_scorers = minimum_required_scorers;
        self.save();
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

    async fn legislature(&self) -> Guild {
        Guild::get_assert(self.legislature)
    }

    async fn judiciary(&self) -> Guild {
        Guild::get_assert(self.judiciary)
    }

    async fn consensus_reward(&self) -> Option<RewardConsensus> {
        RewardConsensus::get(self.account)
    }
}
