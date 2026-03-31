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
