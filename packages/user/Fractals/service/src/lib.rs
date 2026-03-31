pub mod helpers;
mod scoring;
pub mod tables;

pub mod constants {
    pub const ONE_DAY: u32 = 86400;
    pub const ONE_WEEK: u32 = ONE_DAY * 7;
    const ONE_YEAR: u32 = ONE_WEEK * 52;

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

    use crate::tables::tables::{Fractal, FractalMember, RewardConsensus};

    use psibase::services::{
        auth_dyn::{self, policy::DynamicAuthPolicy},
        transact::ServiceMethod,
    };
    use psibase::*;

    /// Creates a new account and fractal.
    ///
    /// # Arguments
    /// * `fractal_account` - The account number for the new fractal.
    /// * `guild_account` - The account number for the associated guild.
    /// * `name` - The name of the fractal.
    /// * `mission` - The mission statement of the fractal.
    #[action]
    fn create_fractal(
        fractal_account: AccountNumber,
        guild_account: AccountNumber,
        name: String,
        mission: String,
    ) {
        Fractal::add(fractal_account, name, mission, guild_account);

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
        Fractal::get_assert(fractal).init_token();
    }

    /// Set Fractal distribution interval
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `distribution_interval_secs` - New fractal distribution interval in seconds.
    #[action]
    fn set_dist_int(fractal: AccountNumber, distribution_interval_secs: u32) {
        Fractal::get_assert(fractal).check_sender_is_legislature();

        RewardConsensus::get_assert(fractal).set_distribution_interval(distribution_interval_secs);
    }

    /// Set token threshold.
    ///
    /// Sets the required amount of active members in the legislature guild before the token can be initialised.  
    ///
    /// # Arguments
    /// * `fractal` - Fractal to update.
    /// * `threshold` - The minimum amount of active members required.
    #[action]
    fn set_tkn_thrs(fractal: AccountNumber, threshold: u8) {
        let mut fractal = Fractal::get_assert(fractal);
        fractal.check_sender_is_legislature();
        fractal.set_token_threshold(threshold);
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

    /// Set ranked guild slots.
    ///
    /// Must be called by legislature.  
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `slots_count` - The number of ranked guild slots.
    #[action]
    fn set_rank_g_s(fractal: AccountNumber, slots_count: u8) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        RewardConsensus::get_assert(fractal).set_ranked_guild_slot_count(slots_count);
    }

    /// Distribute token for a fractal.
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    #[action]
    fn dist_token(fractal: AccountNumber) {
        RewardConsensus::get_assert(fractal).distribute_tokens();
    }

    /// Rank guilds for a fractal
    ///
    /// This action assigns the fractal's consensus reward distribution to the provided
    /// ordered list of guilds using a **Fibonacci-weighted distribution**, where earlier
    /// guilds in the vector receive progressively larger shares.
    ///
    /// Must be called by the legislature.  
    ///
    /// # Arguments
    /// * `fractal` - The account number of the fractal.
    /// * `guilds` - Ranked guilds, from highest rewarded to lowest.
    #[action]
    fn rank_guilds(fractal: AccountNumber, guilds: Vec<AccountNumber>) {
        Fractal::get_assert(fractal).check_sender_is_legislature();
        RewardConsensus::get_assert(fractal).set_ranked_guilds(guilds);
    }

    fn account_policy(account: AccountNumber) -> Option<auth_dyn::policy::DynamicAuthPolicy> {
        Fractal::get(account).map(|fractal| fractal.auth_policy())
        // .or(Guild::get(account).map(|guild| guild.guild_auth()))
        // .or(Guild::get_by_rep_role(account).map(|guild| guild.rep_role_auth()))
        // .or(Guild::get_by_council_role(account).map(|guild| guild.council_role_auth()))
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
