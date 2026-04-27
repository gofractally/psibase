pub const ONE_DAY: u32 = 86400;
pub const ONE_WEEK: u32 = ONE_DAY * 7;
const ONE_YEAR: u32 = ONE_WEEK * 52;

pub const PPM: u32 = 1_000_000;

pub mod token_distributions {
    pub const TOKEN_SUPPLY: u64 = 210_000_000_000;

    pub mod consensus_rewards {
        pub const REWARD_DISTRIBUTION: u64 = super::TOKEN_SUPPLY / 4;
        pub const INITIAL_REWARD_DISTRIBUTION: u64 = REWARD_DISTRIBUTION / 100;
        pub const REMAINING_REWARD_DISTRIBUTION: u64 =
            REWARD_DISTRIBUTION - INITIAL_REWARD_DISTRIBUTION;
    }
}

pub const TOKEN_PRECISION: u8 = 4;
pub const FRACTAL_STREAM_HALF_LIFE: u32 = ONE_YEAR * 25;
pub const MEMBER_STREAM_HALF_LIFE: u32 = ONE_WEEK * 13;
pub const MIN_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS: u32 = ONE_DAY;
pub const MAX_FRACTAL_DISTRIBUTION_INTERVAL_SECONDS: u32 = ONE_WEEK * 8;

pub const DEFAULT_FRACTAL_DISTRIBUTION_INTERVAL: u32 = ONE_WEEK;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FractalRole {
    Legislature = 1,
    Judiciary = 2,
    Executive = 3,
}

impl From<u8> for FractalRole {
    fn from(value: u8) -> Self {
        match value {
            1 => FractalRole::Legislature,
            2 => FractalRole::Judiciary,
            3 => FractalRole::Executive,
            _ => panic!("Invalid FractalRole value: {}", value),
        }
    }
}

impl From<FractalRole> for u8 {
    fn from(value: FractalRole) -> Self {
        value as u8
    }
}
