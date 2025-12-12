use async_graphql::connection::Connection;
use async_graphql::ComplexObject;
use psibase::{
    check_none, check_some, services::auth_dyn::policy::DynamicAuthPolicy, AccountNumber, Table,
};

use crate::tables::tables::{Fractal, FractalMember, FractalMemberTable, FractalTable, Guild};

use psibase::services::transact::Wrapper as TransactSvc;
use psibase::services::{accounts, fractals, sites, transact};
use psibase::{fracpack::Pack, services::auth_dyn};
use psibase::{Action, RawKey, TableQuery};

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
}
