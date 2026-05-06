pub mod constants;
pub mod helpers;
pub mod tables;

#[psibase::service(tables = "tables::tables", recursive = true)]
pub mod service {

    use crate::helpers::check_fractal_auth;
    use crate::tables::tables::RewardStream;
    use crate::tables::tables::{Fractal, FractalMember, Occupation, Role};

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

    use psibase::services::fractals::action_structs as FractalActions;

    const ROLE_METHODS: &[(FractalRole, &str)] = &[
        (
            FractalRole::Recruitment,
            FractalActions::add_mem::ACTION_NAME,
        ),
        (
            FractalRole::Judiciary,
            FractalActions::exile_member::ACTION_NAME,
        ),
        (
            FractalRole::Legislature,
            FractalActions::set_r_occ::ACTION_NAME,
        ),
        (
            FractalRole::Legislature,
            FractalActions::set_dist_int::ACTION_NAME,
        ),
        (
            FractalRole::Legislature,
            FractalActions::set_gen_time::ACTION_NAME,
        ),
        (
            FractalRole::Legislature,
            FractalActions::set_dstrat::ACTION_NAME,
        ),
        (
            FractalRole::Legislature,
            FractalActions::set_paid_occ::ACTION_NAME,
        ),
        (
            FractalRole::Legislature,
            FractalActions::init_token::ACTION_NAME,
        ),
    ];

    fn is_banned_method(method: &ServiceMethod) -> bool {
        use psibase::services::accounts as Accounts;
        use psibase::services::setcode as SetCode;
        use psibase::services::staged_tx as StagedTx;

        const BANNED: &[(&AccountNumber, &str)] = &[
            (
                &Accounts::SERVICE,
                Accounts::action_structs::setAuthServ::ACTION_NAME,
            ),
            (
                &SetCode::SERVICE,
                SetCode::action_structs::setCode::ACTION_NAME,
            ),
            (
                &SetCode::SERVICE,
                SetCode::action_structs::setCodeStaged::ACTION_NAME,
            ),
            (
                &StagedTx::SERVICE,
                StagedTx::action_structs::propose::ACTION_NAME,
            ),
            (
                &StagedTx::SERVICE,
                StagedTx::action_structs::accept::ACTION_NAME,
            ),
        ];

        BANNED
            .iter()
            .any(|(svc, name)| **svc == method.service && *name == &method.method.to_string())
    }

    fn get_role_for_method(method: MethodNumber) -> Option<FractalRole> {
        ROLE_METHODS
            .iter()
            .find(|(_, name)| method == MethodNumber::from(*name))
            .map(|(role, _)| *role)
    }

    /// Creates a new account and fractal.
    ///
    /// # Arguments
    /// * `fractal_account` - The account number for the new fractal.
    /// * `legislature` - Legislature role account.
    /// * `judiciary` - Judiciary role account.
    /// * `executive` - Executive role account
    /// * `recruitment` - Recruitment role account.
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
        check_fractal_auth!(fractal, init_token);
        let fractal = Fractal::get_assert(fractal);
        fractal.init_token();
    }

    /// Set Fractal distribution interval
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_interval_secs` - New fractal distribution interval in seconds.
    #[action]
    fn set_dist_int(fractal: AccountNumber, distribution_interval_secs: u32) {
        check_fractal_auth!(fractal, set_dist_int);
        let mut fractal = Fractal::get_assert(fractal);
        fractal.set_distribution_interval(distribution_interval_secs);
    }

    /// Set genesis time for a fractal
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `genesis_time` - New genesis time for the fractal.
    #[action]
    fn set_gen_time(fractal: AccountNumber, genesis_time: u64) {
        check_fractal_auth!(fractal, set_gen_time);
        let mut fractal = Fractal::get_assert(fractal);
        fractal.set_genesis_time(TimePointSec::from(genesis_time as i64));
    }

    /// Set distribution strategy
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_strategy` - Algorithm for weighted distribution.
    #[action]
    fn set_dstrat(fractal: AccountNumber, distribution_strategy: u8) {
        check_fractal_auth!(fractal, set_dstrat);
        let mut fractal = Fractal::get_assert(fractal);
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
        check_fractal_auth!(fractal, exile_member);
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
        check_fractal_auth!(fractal, set_r_occ);
        Role::get_assert(fractal, role_id.into()).set_occupation(new_occupation);
    }

    /// Claim member rewards
    ///
    /// Sends any vested token rewards to the fractal member after applying any pending levies.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `member` - The fractal member claiming rewards.
    #[action]
    fn claim_rew(fractal: AccountNumber, member: AccountNumber) {
        let mut reward_stream = RewardStream::get_assert(fractal, member);
        let (token_id, claimed) = reward_stream.claim();

        if claimed.value > 0 {
            psibase::services::tokens::Wrapper::call().credit(
                token_id,
                member,
                claimed,
                "Reward claim".into(),
            );
        }
    }

    /// Add fractal member
    ///
    /// Adds an account to a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `member` - Account to be added as a member
    /// * `recruiter` - Account of the fractal member that recruited this new member, if applicable.
    #[action]
    fn add_mem(fractal: AccountNumber, member: AccountNumber, recruiter: Option<AccountNumber>) {
        check_fractal_auth!(fractal, add_mem);
        FractalMember::add(fractal, member, recruiter);

        Wrapper::emit().history().joined_fractal(fractal, member);
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
        check_fractal_auth!(fractal, set_paid_occ);
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
        let method = match method {
            None => return check_some(account_policy(account), "account not supported"),
            Some(m) if is_banned_method(&m) => return DynamicAuthPolicy::impossible(),
            Some(m) => m,
        };

        if method.service == get_service() {
            if let Some(role) = get_role_for_method(method.method) {
                if let Some(role_record) = Role::get(account, role) {
                    return role_record.auth_policy();
                }
            }
        }

        check_some(account_policy(account), "account not supported")
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
