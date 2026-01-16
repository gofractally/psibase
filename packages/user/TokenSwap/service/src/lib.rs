mod uniswap;

#[psibase::service_tables]
pub mod tables {

    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::services::nft::NID;
    use psibase::services::token_swap::{swap, Wrapper as TokenSwap, PPM};
    use psibase::services::tokens::{Decimal, Quantity, TokenRecord, Wrapper as Tokens, TID};
    use psibase::{
        check, check_none, check_some, get_sender, AccountNumber, Fracpack, Table, ToSchema,
    };

    use crate::uniswap::{mul_div, sqrt};
    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct Config {
        last_used_pool_id: u32,
        pub global_fee_ppm: u32,
    }

    impl Config {
        #[primary_key]
        fn pk(&self) {}

        pub fn get() -> Option<Self> {
            ConfigTable::read().get_index_pk().get(&())
        }

        pub fn get_assert() -> Self {
            check_some(Self::get(), "config does not exist")
        }

        pub fn add(global_fee_ppm: u32) -> Self {
            check_none(Self::get(), "config row already added");
            let new_instance = Self {
                last_used_pool_id: 0,
                global_fee_ppm,
            };
            new_instance.save();
            new_instance
        }

        pub fn next_pool_id() -> u32 {
            let mut instance = Self::get_assert();
            let next_id = check_some(
                instance.last_used_pool_id.checked_add(1),
                "last used pool id overflow",
            );
            instance.last_used_pool_id = next_id;
            instance.save();
            next_id
        }

        pub fn set_global_fee(&mut self, fee_ppm: u32) {
            check(fee_ppm <= 250000, "fee cannot be greater than 25%");
            self.global_fee_ppm = fee_ppm;
            self.save();
        }

        fn save(&self) {
            ConfigTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "PoolTable", index = 1)]
    #[derive(Serialize, Deserialize, SimpleObject, ToSchema, Fracpack, Debug)]
    #[graphql(complex)]
    pub struct Pool {
        #[primary_key]
        pub id: u32,
        pub liquidity_token: TID,
        pub token_a_id: TID,
        pub token_a_tariff_ppm: u32,
        pub token_a_admin: NID,
        pub token_b_id: TID,
        pub token_b_tariff_ppm: u32,
        pub token_b_admin: NID,
    }

    impl Pool {
        pub fn get(id: u32) -> Option<Self> {
            PoolTable::read().get_index_pk().get(&id)
        }

        pub fn get_assert(id: u32) -> Self {
            check_some(
                Self::get(id),
                format!("pool does not exist id: {}", id).as_str(),
            )
        }

        fn get_liquidity_token(&self) -> TokenRecord {
            Tokens::call().getToken(self.liquidity_token)
        }

        pub fn get_lp_supply(&self) -> Quantity {
            let token = self.get_liquidity_token();
            token.issued_supply - token.burned_supply
        }

        fn new(is_managed_pool: bool, token_a_id: TID, token_b_id: TID) -> Self {
            check(
                token_a_id != token_b_id,
                "reserve tokens cannot be the same",
            );

            let nft = psibase::services::nft::Wrapper::call();
            let tokens = psibase::services::tokens::Wrapper::call();
            let sender = get_sender();

            let mint_and_send_back = |memo| {
                let id = nft.mint();
                nft.credit(id, sender, memo);
                id
            };

            let liquidity_token = tokens.create(4.try_into().unwrap(), u64::MAX.into());
            nft.debit(
                tokens.getToken(liquidity_token).nft_id,
                "Liquidity token creation".into(),
            );

            Self {
                id: Config::next_pool_id(),
                liquidity_token,
                token_a_id,
                token_b_id,
                token_a_tariff_ppm: 0,
                token_b_tariff_ppm: 0,
                token_a_admin: if is_managed_pool {
                    0
                } else {
                    mint_and_send_back("Token A administration".into())
                },
                token_b_admin: if is_managed_pool {
                    0
                } else {
                    mint_and_send_back("Token B administration".into())
                },
            }
        }

        pub fn add_liquidity(&self, amount_a_desired: Quantity, amount_b_desired: Quantity) {
            let (reserve_a, reserve_b) = self.get_reserves();

            let pool_has_reserves = reserve_a.value > 0 && reserve_b.value > 0;
            check(pool_has_reserves, "pool does not have sufficient reserves");

            let amount_a_optimal = mul_div(amount_b_desired, reserve_a, reserve_b);
            let amount_b_optimal = mul_div(amount_a_desired, reserve_b, reserve_a);

            let (amount_a_use, amount_b_use) = if amount_b_optimal <= amount_b_desired {
                (amount_a_desired, amount_b_optimal)
            } else {
                (amount_a_optimal, amount_b_desired)
            };

            let total_liquidity = self.get_lp_supply();

            let lp_tokens_from_a_deposit = mul_div(amount_a_use, total_liquidity, reserve_a);
            let lp_tokens_from_b_deposit = mul_div(amount_b_use, total_liquidity, reserve_b);

            let lp_tokens_to_mint = lp_tokens_from_a_deposit.min(lp_tokens_from_b_deposit);

            check(lp_tokens_to_mint.value > 0, "no liquidity to mint");

            self.debit_reserves_from_sender(amount_a_use, amount_b_use);
            self.deposit_into_reserve(self.token_a_id, amount_a_use);
            self.deposit_into_reserve(self.token_b_id, amount_b_use);
            self.mint_lp_tokens(lp_tokens_to_mint);
            self.credit_sender_lp_tokens(lp_tokens_to_mint);
        }

        pub fn remove_liquidity(&self, liquidity_amount: Quantity) {
            check(
                liquidity_amount.value > 0,
                "liquidity amount must be positive",
            );
            self.debit_lp_tokens_from_sender(liquidity_amount);

            let (a_reserve, b_reserve) = self.get_reserves();
            let lp_supply = self.get_lp_supply();

            let a_amount = mul_div(liquidity_amount, a_reserve, lp_supply);
            let b_amount = mul_div(liquidity_amount, b_reserve, lp_supply);

            check(a_amount.value > 0, "no a token reserve balance to return");
            check(b_amount.value > 0, "no b token reserve balance to return");

            self.withdraw_reserves_to_sender(a_amount, b_amount);
            self.burn_lp_tokens(liquidity_amount);
        }

        fn withdraw_reserves_to_sender(&self, a_amount: Quantity, b_amount: Quantity) {
            self.withdraw_from_reserve(self.token_a_id, a_amount);
            self.withdraw_from_reserve(self.token_b_id, b_amount);
            let tokens = Tokens::call();
            let sender = get_sender();
            tokens.credit(self.token_a_id, sender, a_amount, "memo".into());
            tokens.credit(self.token_b_id, sender, b_amount, "memo".into());
        }

        pub fn debit_lp_tokens_from_sender(&self, liquidity_amount: Quantity) {
            Tokens::call().debit(
                self.liquidity_token,
                get_sender(),
                liquidity_amount,
                "Liquidity withdrawal".into(),
            );
        }

        pub fn debit_reserves_from_sender(&self, amount_a: Quantity, amount_b: Quantity) {
            let tokens = Tokens::call();
            let sender = get_sender();
            tokens.debit(self.token_a_id, sender, amount_a, "memo".into());
            tokens.debit(self.token_b_id, sender, amount_b, "memo".into());
            tokens.reject(self.token_a_id, sender, "memo".into());
            tokens.reject(self.token_b_id, sender, "memo".into());
        }

        pub fn mint_lp_tokens(&self, amount: Quantity) {
            Tokens::call().mint(self.liquidity_token, amount, "LP Token".into());
        }

        pub fn credit_sender_lp_tokens(&self, amount: Quantity) {
            Tokens::call().credit(
                self.liquidity_token,
                get_sender(),
                amount,
                "LP Token".into(),
            )
        }

        pub fn burn_lp_tokens(&self, amount: Quantity) {
            Tokens::call().burn(self.liquidity_token, amount, "Liquidity withdrawal".into());
        }

        pub fn add(
            is_managed_pool: bool,
            a_token: TID,
            b_token: TID,
            a_amount: Quantity,
            b_amount: Quantity,
        ) -> Self {

            // TODO: If this pool is managed AND there is already a managed pool of this pair, then abort.

            let pool = Self::new(is_managed_pool, a_token, b_token);

            pool.debit_reserves_from_sender(a_amount, b_amount);
            pool.deposit_into_reserve(a_token, a_amount);
            pool.deposit_into_reserve(b_token, b_amount);

            let initial_lp_tokens: Quantity = {
                let product = a_amount.value as u128 * b_amount.value as u128;
                let sqrt_approx = sqrt(product);
                (sqrt_approx as u64).into()
            };
            check(
                initial_lp_tokens.value > 100,
                "not enough initial liquidity",
            );

            // Keep a tiny amount of liquidity tokens for the service as dead / stale tokens
            // so it keeps the pool permanently functional.
            // tokens aren't burned as that will reduce the total supply which negates this intended affect
            let dead_tokens: Quantity = 10.into();
            check(
                initial_lp_tokens > dead_tokens,
                "initial too small for dead tokens",
            );
            pool.mint_lp_tokens(initial_lp_tokens);
            pool.credit_sender_lp_tokens(initial_lp_tokens - dead_tokens);

            pool.save();
            pool
        }

        fn account_owns_nft(nft: NID, account: AccountNumber) -> bool {
            psibase::services::nft::Wrapper::call().getNft(nft).owner == account
        }

        fn check_sender_owns_nft(&self, nft_id: NID) {
            check(
                Self::account_owns_nft(nft_id, get_sender()),
                "must own administration nft",
            );
        }

        pub fn set_tarriff(&mut self, token: TID, fee_ppm: u32) {
            check(fee_ppm < PPM as u32, "fee too high");
            check(self.includes_token(token), "token not supported in pool");

            let is_token_a = self.token_a_id == token;

            if is_token_a {
                self.check_sender_owns_nft(self.token_a_admin);
            } else {
                self.check_sender_owns_nft(self.token_b_admin);
            };

            if is_token_a {
                self.token_a_tariff_ppm = fee_ppm;
            } else {
                self.token_b_tariff_ppm = fee_ppm
            }
            self.save();
        }

        fn save(&self) {
            PoolTable::read_write().put(&self).unwrap();
        }

        fn pool_sub_account_id(&self) -> String {
            self.id.to_string()
        }

        pub fn get_reserve(&self, tid: TID) -> Quantity {
            check(self.includes_token(tid), "token not supported in reserve");
            check_some(
                Tokens::call().getSubBal(tid, self.pool_sub_account_id()),
                "reserve balance not found",
            )
        }

        pub fn get_reserves(&self) -> (Quantity, Quantity) {
            (
                self.get_reserve(self.token_a_id),
                self.get_reserve(self.token_b_id),
            )
        }

        fn deposit_into_reserve(&self, token_id: TID, amount: Quantity) {
            Tokens::call().toSub(token_id, self.pool_sub_account_id(), amount);
        }

        fn withdraw_from_reserve(&self, token_id: TID, amount: Quantity) {
            Tokens::call().fromSub(token_id, self.pool_sub_account_id(), amount);
        }

        pub fn includes_token(&self, token_id: TID) -> bool {
            self.token_a_id == token_id || self.token_b_id == token_id
        }

        pub fn swap(&mut self, incoming_token: TID, incoming_amount: Quantity) -> (TID, Quantity) {
            check(self.includes_token(incoming_token), "path token mismatch");

            let outgoing_token = if incoming_token == self.token_a_id {
                self.token_b_id
            } else {
                self.token_a_id
            };

            let incoming_reserve = self.get_reserve(incoming_token);
            let outgoing_reserve = self.get_reserve(outgoing_token);

            let tariff_ppm = if self.token_a_admin == 0 {
                Config::get_assert().global_fee_ppm
            } else {
                if incoming_token == self.token_a_id {
                    self.token_a_tariff_ppm
                } else {
                    self.token_b_tariff_ppm
                }
            };

            let outgoing_amount = swap(
                incoming_amount,
                incoming_reserve,
                outgoing_reserve,
                tariff_ppm,
            );
            check(outgoing_amount.value > 0, "outgoing amount is 0");

            self.deposit_into_reserve(incoming_token, incoming_amount);
            self.withdraw_from_reserve(outgoing_token, outgoing_amount);
            self.save();
            (outgoing_token, outgoing_amount)
        }
    }

    #[ComplexObject]
    impl Pool {
        pub async fn a_balance(&self) -> Decimal {
            let amount = TokenSwap::call().get_reserve(self.id, self.token_a_id);
            let precision = Tokens::call().getToken(self.token_a_id).precision;
            Decimal::new(amount, precision)
        }

        pub async fn b_balance(&self) -> Decimal {
            let amount = TokenSwap::call().get_reserve(self.id, self.token_b_id);
            let precision = Tokens::call().getToken(self.token_b_id).precision;
            Decimal::new(amount, precision)
        }

        pub async fn liquidity_token_supply(&self) -> Decimal {
            let token = Tokens::call().getToken(self.liquidity_token);
            Decimal::new(token.issued_supply - token.burned_supply, token.precision)
        }

        pub async fn token_a(&self) -> TokenRecord {
            Tokens::call().getToken(self.token_a_id)
        }

        pub async fn token_a_symbol(&self) -> Option<AccountNumber> {
            psibase::services::symbol::Wrapper::call()
                .getByToken(self.id)
                .map(|s| s.symbolId)
        }

        pub async fn token_b(&self) -> TokenRecord {
            Tokens::call().getToken(self.token_b_id)
        }

        pub async fn token_b_symbol(&self) -> Option<AccountNumber> {
            psibase::services::symbol::Wrapper::call()
                .getByToken(self.id)
                .map(|s| s.symbolId)
        }

        pub async fn is_managed(&self) -> bool {
            self.token_a_admin == 0
        }
    }
}

#[psibase::service(name = "token-swap", tables = "tables")]
pub mod service {
    use crate::tables::{Config, Pool};
    use psibase::{
        services::{
            nft::NID,
            tokens::{Quantity, TID},
        },
        *,
    };

    #[action]
    fn init() {
        if Config::get().is_none() {
            Config::add(3_000); // 0.3%
            use psibase::services::nft as Nft;
            use psibase::services::tokens as Tokens;

            Tokens::Wrapper::call().setUserConf(Tokens::BalanceFlags::MANUAL_DEBIT.index(), true);
            Nft::Wrapper::call().setUserConf(Nft::NftHolderFlags::MANUAL_DEBIT.index(), true);
        }
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check_some(Config::get(), "service not inited");
    }

    #[action]
    fn set_global_fee(ppm: u32) {
        check(get_sender() == get_service(), "only service can update");
        Config::get_assert().set_global_fee(ppm);
    }

    #[action]
    fn new_pool(
        is_managed: bool,
        token_a: TID,
        token_b: TID,
        token_a_amount: Quantity,
        token_b_amount: Quantity,
    ) -> (u32, NID, NID) {
        let pool = Pool::add(is_managed, token_a, token_b, token_a_amount, token_b_amount);

        (pool.id, pool.token_a_admin, pool.token_b_admin)
    }

    #[action]
    fn set_tarriff(pool_id: u32, token: TID, ppm: u32) {
        Pool::get_assert(pool_id).set_tarriff(token, ppm)
    }

    #[action]
    fn get_reserve(pool_id: u32, token_id: TID) -> Quantity {
        Pool::get_assert(pool_id).get_reserve(token_id)
    }

    #[action]
    fn add_liquidity(pool_id: u32, amount_a: Quantity, amount_b: Quantity) {
        check(amount_a.value > 0, "amount a must be non-zero");
        check(amount_b.value > 0, "amount b must be non-zero");

        Pool::get_assert(pool_id).add_liquidity(amount_a, amount_b);
    }

    #[action]
    fn remove_liquidity(pool_id: u32, lp_amount: Quantity) {
        Pool::get_assert(pool_id).remove_liquidity(lp_amount);
    }

    #[action]
    fn swap(pools: Vec<u32>, token_in: TID, amount_in: Quantity, min_return: Quantity) {
        check(pools.len() > 0, "pools length must be at least 1");
        let sender = get_sender();
        let tokens_service = psibase::services::tokens::Wrapper::call();
        tokens_service.debit(token_in, sender, amount_in, "Swap".into());

        let mut current_token = token_in;
        let mut current_amount = amount_in;

        for pool_id in pools {
            let (token_out, amount_out) =
                Pool::get_assert(pool_id).swap(current_token, current_amount);

            current_token = token_out;
            current_amount = amount_out;
        }

        check(current_amount >= min_return, "does not meet minimum return");
        tokens_service.credit(current_token, sender, current_amount, "Token swap".into());
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
