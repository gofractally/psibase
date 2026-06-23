pub mod constants;
pub mod helpers;
pub mod tables;

macro_rules! ban {
    ($svc:ident, $action:ident) => {
        (&$svc::SERVICE, $svc::action_structs::$action::ACTION_NAME)
    };
}

#[psibase::service(tables = "tables::tables", recursive = true)]
pub mod service {

    use crate::tables::tables::{Fractal, FractalMember, Occupation, RewardStream, Role};

    use psibase::{
        services::{
            accounts as Accounts,
            auth_dyn::{self, policy::DynamicAuthPolicy},
            fractals::{action_structs as Actns, occu_wrapper, FractalRole},
            setcode as SetCode, staged_tx as StagedTx,
            transact::ServiceMethod,
        },
        *,
    };
    use FractalRole::*;

    const ROLE_METHODS: &[(FractalRole, &str)] = &[
        (Recruitment, Actns::add_mem::ACTION_NAME),
        (Judiciary, Actns::exile_member::ACTION_NAME),
        (Legislature, Actns::set_r_occ::ACTION_NAME),
        (Legislature, Actns::set_dist_int::ACTION_NAME),
        (Legislature, Actns::set_gen_time::ACTION_NAME),
        (Legislature, Actns::set_dstrat::ACTION_NAME),
        (Legislature, Actns::set_paid_occ::ACTION_NAME),
        (Legislature, Actns::init_token::ACTION_NAME),
    ];

    const BANNED: &[(&AccountNumber, &str)] = &[
        ban!(Accounts, setAuthServ),
        ban!(SetCode, setCode),
        ban!(SetCode, setCodeStaged),
        ban!(StagedTx, propose),
        ban!(StagedTx, accept),
    ];

    fn method_policy(
        account: AccountNumber,
        method: Option<ServiceMethod>,
    ) -> Option<DynamicAuthPolicy> {
        // #1. Root sub account #1
        //   #2. Legislative child account
        //   #3. Judiciary child account
        //   #4. Executive child account
        //      #5. Recruitment child account

        // All the sub accounts you want
        // But initially legislature gets to set a vector for a fractal
        // Each account in the vector has a weight of 1, inside of a 2/3+1 vote
        // which authorises role account 1, which has all the undelegated actions.

        let method = method?;

        let is_banned = BANNED.iter().any(|&(svc, name)| {
            *svc == method.service && method.method == MethodNumber::from(name)
        });

        if is_banned {
            return Some(DynamicAuthPolicy::impossible());
        }
        if method.service == get_service() {
            let role = ROLE_METHODS
                .iter()
                .find(|(_, name)| method.method == MethodNumber::from(*name))
                .map(|(role, _)| *role);
            if let Some(role) = role {
                return Some(Role::get_assert(account, role).auth_policy());
            }
        }
        None
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
    fn init_token() {
        // StagedTX execution check
        // Action execution check
        Fractal::by_sender_root().init_token();
    }

    /// Set Fractal distribution interval
    ///
    /// Used in conjunction with genesis time to determine when fractal token distribution can be triggered.
    ///
    /// # Arguments
    /// * `distribution_interval_secs` - New fractal distribution interval in seconds.
    #[action]
    fn set_dist_int(distribution_interval_secs: u32) {
        Fractal::by_sender().set_distribution_interval(distribution_interval_secs);
    }

    /// Set genesis time for a fractal
    ///
    /// Genesis time sets the starting point of when fractal token rewards can be claimed.
    /// Subsequent claims are according to the distribution interval set for the fractal.
    ///
    /// # Arguments
    /// * `genesis_time` - New genesis time for the fractal.
    #[action]
    fn set_gen_time(genesis_time: u64) {
        Fractal::by_sender().set_genesis_time(TimePointSec::from(genesis_time as i64));
    }

    /// Set distribution strategy
    ///
    /// # Arguments
    /// * `distribution_strategy` - Algorithm for weighted distribution.
    #[action]
    fn set_dstrat(distribution_strategy: u8) {
        Fractal::by_sender().set_distribution_strategy(distribution_strategy.into());
    }

    /// Exile a fractal member.
    ///
    /// # Arguments
    /// * `member` - The fractal member to be exiled.
    #[action]
    fn exile_member(member: AccountNumber) {
        FractalMember::get_assert(get_sender(), member).exile();
    }

    /// Distribute token for a fractal.
    #[action]
    fn dist_token(fractal: AccountNumber) {
        Fractal::get_assert(fractal).distribute_tokens();
    }

    /// Sets the occupation used to authorize the specified fractal role.
    ///
    /// # Arguments
    /// * `role_id` - Role ID for fractal
    /// * `new_occupation` - New occupation to set for role
    #[action]
    fn set_r_occ(role_id: u8, new_occupation: AccountNumber) {
        Role::get_assert(get_sender(), role_id.into()).set_occupation(new_occupation);
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
    /// * `member` - Account to be added as a member
    /// * `recruiter` - Account of the fractal member that recruited this new member, if applicable.
    #[action]
    fn add_mem(member: AccountNumber, recruiter: Option<AccountNumber>) {
        let fractal = get_sender();
        FractalMember::add(fractal, member, recruiter);

        Wrapper::emit().history().joined_fractal(fractal, member);
    }

    /// Set ordered occupations
    ///
    /// Payment for each ordered occupation will be according to the fractals payment strategy.
    ///
    /// # Arguments
    /// * `paid_occupations` - Ordered occupations to set for the fractal
    #[action]
    fn set_paid_occ(paid_occupations: Vec<AccountNumber>) {
        Occupation::set_ordered_occupations(get_sender(), paid_occupations);
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
        let policy = method_policy(account, method).or_else(|| account_policy(account));
        check_some(policy, "account not supported")
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

#[cfg(test)]
mod tests;
