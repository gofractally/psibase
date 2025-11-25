use std::collections::HashSet;

use psibase::{abort_message, check, check_none, check_some, AccountNumber, Table};

use crate::helpers::distribute_by_weight;
use crate::tables::tables::{FractalToken, FractalTokenTable, Guild, GuildMember};

use psibase::services::tokens::{Precision, Quantity, Wrapper as Tokens};

use psibase::services::token_stream::Wrapper as TokenStream;

pub fn fibonacci_binet_exact(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    if n == 1 {
        return 1;
    }

    let phi = (1.0 + 5.0_f64.sqrt()) / 2.0;
    let psi = (1.0 - 5.0_f64.sqrt()) / 2.0; // conjugate
    let sqrt5 = 5.0_f64.sqrt();

    // Full Binet: F_n = (φ^n - ψ^n) / √5
    // Since |ψ| < 1, ψ^n is tiny for large n
    let term1 = phi.powi(n as i32);
    let term2 = psi.powi(n as i32);
    ((term1 - term2) / sqrt5).round() as u64
}

impl FractalToken {
    fn new(fractal: AccountNumber, supply: Quantity, precision: Precision) -> Self {
        let token_id = Tokens::call().create(precision, supply);
        Self {
            fractal,
            ranked_guilds: vec![],
            stream_id: TokenStream::call().create(86400 * 7 * 52 * 25, token_id),
            token: token_id,
        }
    }

    pub fn add(fractal: AccountNumber) -> Self {
        check_none(Self::get(fractal), "fractal token already exists");

        let supply: Quantity = 2100000000.into();
        let precision: Precision = 2.try_into().unwrap();
        let new_instance = Self::new(fractal, supply, precision);

        let token_id = new_instance.token;
        Tokens::call().mint(token_id, supply, "memo".into());
        Tokens::call().credit(token_id, TokenStream::SERVICE, supply, "memo".into());
        TokenStream::call().deposit(new_instance.stream_id, supply);

        new_instance.save();
        new_instance
    }

    pub fn distribute_tokens(&self) {
        let claimable = TokenStream::call().claim(self.stream_id);
        if claimable.value == 0 {
            return;
        }
        Tokens::call().debit(
            self.token,
            TokenStream::SERVICE,
            claimable,
            "Reward claim".into(),
        );

        let guild_length = self.ranked_guilds.clone().len() as u64;
        let ranked_guilds = self.ranked_guilds.clone();

        let ranked_guilds = distribute_by_weight(
            &ranked_guilds,
            |index, _| fibonacci_binet_exact(guild_length - index as u64),
            claimable.value,
        );

        for (guild, guild_distribution) in ranked_guilds {
            let members: Vec<(AccountNumber, u32)> = GuildMember::memberships_of_guild(guild)
                .into_iter()
                .map(|member| (member.member, member.score))
                .collect();

            let ranked_members = distribute_by_weight(
                &members,
                |_, (_, score)| fibonacci_binet_exact(*score as u64),
                guild_distribution,
            );

            for ((member, _score), reward) in ranked_members {
                GuildMember::get_assert(guild, member).deposit_stream(
                    self.token,
                    reward.into(),
                    "Guild member reward".into(),
                );
            }
        }
    }

    pub fn set_ranked_guilds(&mut self, guilds: Vec<AccountNumber>) {
        let mut seen = HashSet::new();
        for guild in guilds.clone() {
            if !seen.insert(guild) {
                abort_message("duplicate ranked guild detected");
            }
            check(
                Guild::get_assert(guild).fractal == self.fractal,
                "cannot rank foreign guilds",
            );
        }
        check(guilds.len() <= 12, "only up to 12 guilds can be ranked");
        self.ranked_guilds = guilds;
        self.save();
    }

    pub fn get(fractal: AccountNumber) -> Option<Self> {
        FractalTokenTable::read().get_index_pk().get(&fractal)
    }

    pub fn get_assert(fractal: AccountNumber) -> Self {
        check_some(Self::get(fractal), "fractal token does not exist")
    }

    fn save(&self) {
        FractalTokenTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}
