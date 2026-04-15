pub mod helpers;
mod scoring;
pub mod tables;

pub mod constants {
    pub const ONE_DAY: u32 = 86400;
    pub const ONE_WEEK: u32 = ONE_DAY * 7;
    const ONE_YEAR: u32 = ONE_WEEK * 52;

    pub const PPM: u32 = 1_000_000;

    pub mod roles {
        pub const LEGISLATURE: u8 = 1;
        pub const JUDICIARY: u8 = 2;
        pub const EXECUTIVE: u8 = 3;
    }
    pub mod token_distributions {
        pub const TOKEN_SUPPLY: u64 = 210_000_000_000;

        pub mod consensus_rewards {
            pub const REWARD_DISTRIBUTION: u64 = super::TOKEN_SUPPLY / 4;
            pub const INITIAL_REWARD_DISTRIBUTION: u64 = REWARD_DISTRIBUTION / 100;
            pub const REMAINING_REWARD_DISTRIBUTION: u64 =
                REWARD_DISTRIBUTION - INITIAL_REWARD_DISTRIBUTION;
        }
    }

    pub const MAX_GUILD_INVITES_PER_MEMBER: u8 = 5;
    pub const TOKEN_PRECISION: u8 = 4;
    pub const FRACTAL_STREAM_HALF_LIFE: u32 = ONE_YEAR * 25;
    pub const MEMBER_STREAM_HALF_LIFE: u32 = ONE_WEEK * 13;
    pub const MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS: u32 = ONE_DAY;
    pub const MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS: u32 = ONE_WEEK * 8;
    pub const COUNCIL_SEATS: u8 = 6;

    pub const MIN_GROUP_SIZE: u8 = 4;
    pub const MAX_GROUP_SIZE: u8 = 10;

    pub const GUILD_EVALUATION_GROUP_SIZE: u8 = 6;

    pub const DEFAULT_RANKED_GUILD_SLOT_COUNT: u8 = 12;
    pub const DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL: u32 = ONE_WEEK;

    pub const DEFAULT_RANK_ORDERING_THRESHOLD: u8 = 8;
    pub const MIN_RANK_ORDERING_THRESHOLD: u8 = 4;

    pub const DEFAULT_TOKEN_INIT_THRESHOLD: u8 = 8;
    pub const MIN_TOKEN_INIT_THRESHOLD: u8 = 4;

    // Simple limitation + also related to fibonacci function limit.
    pub const MAX_RANKED_GUILDS: u8 = 25;

    // Expected scaling for use of the continuous_fibonacci func
    pub const SCORE_SCALE: u32 = 10_000;

    // Determine score sensitivity
    pub const EMA_ALPHA_DENOMINATOR: u32 = 6;

    // Candidacy cool down determines how long a guild member must wait
    // before he can make himself a candidate again.
    pub const DEFAULT_CANDIDACY_COOLDOWN: u32 = ONE_WEEK;
    pub const MAX_CANDIDACY_COOLDOWN: u32 = ONE_YEAR / 4;

    pub const GUILD_APP_ENDORSEMENT_THRESHOLD: u8 = 3;
    pub const GUILD_APP_REJECT_THRESHOLD: u8 = 3;
}

#[psibase::service(tables = "tables::tables", recursive = true)]
pub mod service {

    use crate::tables::tables::{Fractal, FractalMember, Occupation, RewardStream, Role};

    use psibase::services::fractals::occu_wrapper;
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
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    #[action]
    fn create_frac(
        fractal_account: AccountNumber,
        legislature: AccountNumber,
        judiciary: AccountNumber,
        executive: AccountNumber,
        name: String,
        mission: String,
    ) {
        Fractal::add(
            fractal_account,
            legislature,
            judiciary,
            executive,
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

    /// Sets the occupation for a fractal role.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `role_id` - Role ID for fractal
    /// * `new_occupation` - New occupation to set for role
    #[action]
    fn set_rol_oc(fractal: AccountNumber, role_id: u8, new_occupation: AccountNumber) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        Role::get_assert(fractal, role_id).set_occupation(new_occupation);
    }

    /// Claim member rewards
    ///
    /// Sends any vested token rewards to the fractal member after applying any pending levies.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn cl_mem_rwds(fractal: AccountNumber) {
        FractalMember::get_assert(fractal, get_sender()).claim_member_rewards();
    }

    /// Set ordered occupations
    ///
    /// Payment for each ordered occupation will be according to the fractals payment strategy.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `ordered_occupations` - Ordered occupations to set for the fractal
    #[action]
    fn set_paid_occupations(fractal: AccountNumber, ordered_occupations: Vec<AccountNumber>) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        Occupation::set_ordered_occupations(fractal, ordered_occupations);
    }

    /// Get fratal by role
    ///
    /// This action is temp until the arrival of sub-accounts.
    ///
    /// # Arguments
    /// * `account` - Account role to lookup.
    #[action]
    fn frac_by_role(role_account: AccountNumber) -> Option<AccountNumber> {
        Role::get_by_account(role_account).map(|role| role.account)
    }

    fn account_policy(account: AccountNumber) -> Option<auth_dyn::policy::DynamicAuthPolicy> {
        Fractal::get(account)
            .map(|fractal| fractal.auth_policy())
            .or(Role::get_by_account(account).map(|role| {
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

    #[event(history)]
    pub fn evaluation_finished(guild: AccountNumber, evaluation_id: u32) {}

    #[event(history)]
    pub fn scheduled_evaluation(
        fractal: AccountNumber,
        guild: AccountNumber,
        evaluation_id: u32,
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
    ) {
    }
}
