pub mod constants;
pub mod helpers;
pub mod tables;

#[psibase::service(tables = "tables::tables", recursive = true)]
pub mod service {

    use crate::tables::tables::{Fractal, FractalMember, Occupation, RewardStream, Role};

    use psibase::services::fractals::occu_wrapper;
    use psibase::services::fractals::FractalRole;
    use psibase::*;
    use psibase::{
        services::{
            auth_dyn::{self, policy::DynamicAuthPolicy},
            transact::ServiceMethod,
        },
        AccountNumber,
    };

    /// Creates a new account and fractal.
    ///
    /// # Arguments
    /// * `fractal_account` - The account number for the new fractal.
    /// * `legislature` - Legislature role account.
    /// * `judiciary` - Judiciary role account.
    /// * `executive` - Executive role account
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    #[action]
    fn create_frac(
        fractal_account: AccountNumber,
        legislature: AccountNumber,
        judiciary: AccountNumber,
        executive: AccountNumber,
        recruitment: AccountNumber,
        name: String,
        mission: String,
    ) {
        Fractal::add(
            fractal_account,
            legislature,
            judiciary,
            executive,
            recruitment,
            name,
            mission,
        );

        Wrapper::emit().history().created_fractal(fractal_account);
    }

    /// Initialise a token for a fractal.
    ///
    /// Called only once per fractal.
    /// Must be called by legislature.  
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn init_token(fractal: AccountNumber) {
        let fractal = Fractal::get_assert(fractal);
        fractal.check_sender_is_legislature();
        fractal.init_token();
    }

    /// Set Fractal distribution interval
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_interval_secs` - New fractal distribution interval in seconds.
    #[action]
    fn set_dist_int(fractal: AccountNumber, distribution_interval_secs: u32) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        RewardStream::get_assert(fractal).set_distribution_interval(distribution_interval_secs);
    }

    /// Set distribution strategy
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_strategy` - Algorithm for weighted distribution.
    #[action]
    fn set_dstrat(fractal: AccountNumber, distribution_strategy: u8) {
        let mut fractal = Fractal::get_assert(fractal);
        fractal.check_sender_is_legislature();
        fractal.set_distribution_strategy(distribution_strategy.into());
    }

    /// Exile a fractal member.
    ///
    /// Must be called by judiciary.  
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `member` - The fractal member to be exiled.
    #[action]
    fn exile_member(fractal: AccountNumber, member: AccountNumber) {
        Fractal::get_assert(fractal).check_sender_is_judiciary();
        FractalMember::get_assert(fractal, member).exile();
    }

    /// Distribute token for a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn dist_token(fractal: AccountNumber) {
        Fractal::get_assert(fractal).distribute_tokens();
    }

    /// Sets occupation on a fractal role.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `role_id` - Role ID for fractal
    /// * `new_occupation` - New occupation to set for role
    #[action]
    fn set_r_occ(fractal: AccountNumber, role_id: u8, new_occupation: AccountNumber) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        Role::get_assert(fractal, role_id.into()).set_occupation(new_occupation);
    }

    /// Claim member rewards
    ///
    /// Sends any vested token rewards to the fractal member after applying any pending levies.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn claim_rew(fractal: AccountNumber) {
        FractalMember::get_assert(fractal, get_sender()).claim_member_rewards();
    }

    /// Add fractal member
    ///
    /// Adds an account to a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `member` - Account to be added as a member
    #[action]
    fn add_mem(fractal: AccountNumber, member: AccountNumber) {
        // check who the sender is, who should be "guilds"
        // we determine that guilds is the correct acocunt by checking which occupation sits in it
        let auth = psibase::services::auth_dyn::Wrapper::call();

        check(
            auth.isAuthSys(
                fractal,
                vec![get_sender()],
                Some(ServiceMethod::new(
                    get_service(),
                    psibase::services::fractals::action_structs::add_mem::ACTION_NAME.into(),
                )),
                None,
            ),
            "bad authhh",
        );

        FractalMember::add(fractal, member);
    }

    /// Set ordered occupations
    ///
    /// Payment for each ordered occupation will be according to the fractals payment strategy.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `paid_occupations` - Ordered occupations to set for the fractal
    #[action]
    fn set_paid_occ(fractal: AccountNumber, paid_occupations: Vec<AccountNumber>) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        Occupation::set_ordered_occupations(fractal, paid_occupations);
    }

    fn account_policy(account: AccountNumber) -> Option<auth_dyn::policy::DynamicAuthPolicy> {
        Fractal::get(account)
            .map(|fractal| fractal.auth_policy())
            .or(Role::get_by_role_account(account).map(|role| {
                occu_wrapper::call_to(role.occupation).role_policy(role.fractal, role.role_id)
            }))
    }

    /// Get policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    /// * `method` - Optional method being checked.
    #[action]
    fn get_policy(
        account: AccountNumber,
        method: Option<ServiceMethod>,
    ) -> auth_dyn::policy::DynamicAuthPolicy {
        use psibase::services::accounts as Accounts;
        use psibase::services::setcode as SetCode;
        use psibase::services::staged_tx as StagedTx;

        let policy = check_some(account_policy(account), "account not supported");

        if method.is_some_and(|method| {
            let banned_service_methods: Vec<ServiceMethod> = vec![
                ServiceMethod::new(
                    Accounts::SERVICE,
                    Accounts::action_structs::setAuthServ::ACTION_NAME.into(),
                ),
                ServiceMethod::new(
                    SetCode::SERVICE,
                    SetCode::action_structs::setCode::ACTION_NAME.into(),
                ),
                ServiceMethod::new(
                    SetCode::SERVICE,
                    SetCode::action_structs::setCodeStaged::ACTION_NAME.into(),
                ),
                ServiceMethod::new(
                    StagedTx::SERVICE,
                    StagedTx::action_structs::propose::ACTION_NAME.into(),
                ),
                ServiceMethod::new(
                    StagedTx::SERVICE,
                    StagedTx::action_structs::accept::ACTION_NAME.into(),
                ),
            ];

            banned_service_methods
                .iter()
                .any(|sm| sm.method == method.method && sm.service == method.service)
        }) {
            DynamicAuthPolicy::impossible()
        } else if method.is_some_and(|method| {
            method.method
                == psibase::services::fractals::action_structs::add_mem::ACTION_NAME.into()
                && method.service == get_service()
        }) {
            Role::get_assert(account, FractalRole::Recruitment).auth_policy()
        } else {
            policy
        }
    }

    /// Has policy action used by AuthDyn service.
    ///
    /// # Arguments
    /// * `account` - Account being checked.
    #[action]
    fn has_policy(account: AccountNumber) -> bool {
        account_policy(account).is_some()
    }

    #[event(history)]
    pub fn created_fractal(fractal_account: AccountNumber) {}

    #[event(history)]
    pub fn joined_fractal(fractal_account: AccountNumber, account: AccountNumber) {}
}
