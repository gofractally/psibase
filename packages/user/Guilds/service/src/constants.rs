pub const ONE_DAY: u32 = 86400;
pub const ONE_WEEK: u32 = ONE_DAY * 7;
const ONE_YEAR: u32 = ONE_WEEK * 52;

pub const MAX_GUILD_INVITES_PER_MEMBER: u8 = 5;
pub const COUNCIL_SEATS: u8 = 6;

pub const MIN_GROUP_SIZE: u8 = 4;
pub const MAX_GROUP_SIZE: u8 = 10;

pub const GUILD_EVALUATION_GROUP_SIZE: u8 = 6;

pub const DEFAULT_RANKED_GUILD_SLOT_COUNT: u8 = 12;

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
