mod constants {
    pub const PPM: u128 = 1_000_000;
}
mod uniswap;

#[psibase::service_tables]
pub mod tables {
    use psibase::services::nft::{self, NID};
    use psibase::services::tokens::Wrapper as Tokens;
    use psibase::services::tokens::{Quantity, TokenRecord, Wrapper as Tokens, TID};
    use psibase::{abort_message, check, get_sender, AccountNumber};
    use psibase::{check_none, check_some, Fracpack, Table, ToSchema};

    use crate::uniswap::{mul_div, quote, swap, PPM};
    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct Config {
        last_used_pool_id: u32,
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

        pub fn add() -> Self {
            check_none(Self::get(), "config row already added");
            let new_instance = Self {
                last_used_pool_id: 0,
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

        fn save(&self) {
            ConfigTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "PoolTable", index = 1)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct Pool {
        #[primary_key]
        pub id: u32,
        pub liquidity_token: TID,
        pub token_a: TID,
        pub token_a_tariff_ppm: u32,
        pub token_a_admin: NID,
        pub token_b: TID,
        pub token_b_tariff_ppm: u32,
        pub token_b_admin: NID,
    }

    impl Pool {
        pub fn get(id: u32) -> Option<Self> {
            PoolTable::read().get_index_pk().get(&id)
        }

        pub fn get_assert(id: u32) -> Self {
            check_some(Self::get(id), "pool does not exist")
        }

        fn get_liquidity_token(&self) -> TokenRecord {
            Tokens::call().getToken(self.liquidity_token)
        }

        pub fn get_lp_supply(&self) -> Quantity {
            let token = self.get_liquidity_token();
            token.issued_supply - token.burned_supply
        }

        fn new(token_a: TID, token_b: TID) -> Self {
            check(token_a != token_b, "reserve tokens cannot be the same");

            let nft = psibase::services::nft::Wrapper::call();
            let sender = get_sender();

            let mint_and_send_back = |memo| {
                let id = nft.mint();
                nft.credit(id, sender, memo);
                id
            };

            Self {
                id: Config::next_pool_id(),
                liquidity_token: Tokens::call().create(4.try_into().unwrap(), u64::MAX.into()),
                token_a,
                token_b,
                token_a_tariff_ppm: 0,
                token_b_tariff_ppm: 0,
                token_a_admin: mint_and_send_back("Token A administration".into()),
                token_b_admin: mint_and_send_back("Token B administration".into()),
            }
        }

        pub fn add_liquidity(
            &self,
            amount_a_desired: Quantity,
            amount_b_desired: Quantity,
            amount_a_min: Quantity,
            amount_b_min: Quantity,
        ) {
            let reserve_a = self.get_balance(self.token_a);
            let reserve_b = self.get_balance(self.token_b);

            let pool_is_empty = reserve_a.value == 0 || reserve_b.value == 0;
            check(!pool_is_empty, "pool is empty");

            let amount_a_optimal = quote(amount_b_desired, reserve_b, reserve_a);
            let amount_b_optimal = quote(amount_a_desired, reserve_a, reserve_b);

            let (amount_a_use, amount_b_use) = if amount_a_optimal <= amount_a_desired {
                (amount_a_optimal, amount_b_desired)
            } else {
                (amount_a_desired, amount_b_optimal)
            };
            check(amount_a_use >= amount_a_min, "amount a below minimum");
            check(amount_b_use >= amount_b_min, "amount b below minimum");

            self.debit_reserve_tokens_from_sender(amount_a_use, amount_b_use);

            let total_liquidity = self.get_lp_supply();

            let liquidity_from_a_deposit = mul_div(amount_a_use, total_liquidity, reserve_a);
            let liquidity_from_b_deposit = mul_div(amount_b_use, total_liquidity, reserve_b);
            let lp_tokens_to_mint = liquidity_from_a_deposit.min(liquidity_from_b_deposit);

            check(lp_tokens_to_mint.value > 0, "no liquidity to mint");

            self.mint_sender_lp_tokens(lp_tokens_to_mint)
        }

        pub fn remove_liquidity(&self, liquidity_amount: Quantity) {
            Tokens::call().debit(
                self.liquidity_token,
                get_sender(),
                liquidity_amount,
                "Liquidity withdrawal".into(),
            );
            let lp_supply = self.get_lp_supply();

            let lp_share_ppm = (liquidity_amount.value as u128) * PPM / (lp_supply.value as u128);

            let a_reserve = self.get_balance(self.token_a).value as u128;
            let b_reserve = self.get_balance(self.token_b).value as u128;

            let a_share: Quantity = ((a_reserve * lp_share_ppm / PPM) as u64).into();
            let b_share: Quantity = ((b_reserve * lp_share_ppm / PPM) as u64).into();

            self.withdraw_reserves(a_share, b_share);
            self.credit_reserve_tokens_to_sender(a_share, b_share);

            self.burn_sender_lp_tokens(liquidity_amount);
        }

        fn withdraw_reserves(&self, a_amount: Quantity, b_amount: Quantity) {
            self.withdraw_from_reserves(self.token_a, a_amount);
            self.withdraw_from_reserves(self.token_b, b_amount);
        }

        pub fn debit_reserve_tokens_from_sender(&self, amount_a: Quantity, amount_b: Quantity) {
            let tokens = Tokens::call();
            let sender = get_sender();
            tokens.debit(self.token_a, sender, amount_a, "memo".into());
            tokens.debit(self.token_b, sender, amount_b, "memo".into());
            tokens.reject(self.token_a, sender, "memo".into());
            tokens.reject(self.token_b, sender, "memo".into());
        }

        pub fn credit_reserve_tokens_to_sender(&self, amount_a: Quantity, amount_b: Quantity) {
            let tokens = Tokens::call();
            let sender = get_sender();
            tokens.credit(self.token_a, sender, amount_a, "memo".into());
            tokens.credit(self.token_b, sender, amount_b, "memo".into());
        }

        pub fn mint_sender_lp_tokens(&self, amount: Quantity) {
            let tokens = Tokens::call();
            tokens.mint(self.liquidity_token, amount, "LP Token".into());
            tokens.credit(
                self.liquidity_token,
                get_sender(),
                amount,
                "LP Token".into(),
            )
        }

        pub fn burn_sender_lp_tokens(&self, amount: Quantity) {
            let tokens = psibase::services::tokens::Wrapper::call();
            tokens.burn(self.liquidity_token, amount, "Liquidity withdrawal".into());
        }

        pub fn add(a_token: TID, b_token: TID, a_amount: Quantity, b_amount: Quantity) -> Self {
            let pool = Self::new(a_token, b_token);

            pool.debit_reserve_tokens_from_sender(a_amount, b_amount);
            pool.deposit_into_reserves(a_token, a_amount);
            pool.deposit_into_reserves(b_token, b_amount);

            let initial_lp_tokens: Quantity = {
                let product = a_amount.value as u128 * b_amount.value as u128;
                let sqrt_approx = (product as f64).sqrt() as u128;
                (sqrt_approx as u64).into()
            };
            check(
                initial_lp_tokens.value > 100,
                "not enough initial liquidity",
            );
            pool.mint_sender_lp_tokens(initial_lp_tokens);

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

            let is_token_a = self.token_a == token;

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

        pub fn get_balance(&self, tid: TID) -> Quantity {
            check_some(
                Tokens::call().getSubBal(tid, self.pool_sub_account_id()),
                "expecting missing reserve a balance",
            )
        }

        fn deposit_into_reserves(&self, token_id: TID, amount: Quantity) {
            Tokens::call().toSub(token_id, self.pool_sub_account_id(), amount);
        }

        fn withdraw_from_reserves(&self, token_id: TID, amount: Quantity) {
            Tokens::call().fromSub(token_id, self.pool_sub_account_id(), amount);
        }

        pub fn includes_token(&self, token_id: TID) -> bool {
            self.token_a == token_id || self.token_b == token_id
        }

        pub fn swap(&mut self, incoming_token: TID, incoming_amount: Quantity) -> (TID, Quantity) {
            check(self.includes_token(incoming_token), "path token mismatch");

            self.deposit_into_reserves(incoming_token, incoming_amount);

            let outgoing_token = if incoming_token == self.token_a {
                self.token_b
            } else {
                self.token_a
            };

            let incoming_reserve = self.get_balance(incoming_token);
            let outgoing_reserve = self.get_balance(outgoing_token);

            let tariff_ppm = if incoming_token == self.token_a {
                self.token_a_tariff_ppm
            } else {
                self.token_b_tariff_ppm
            };

            let quantity_out = swap(
                incoming_amount,
                incoming_reserve,
                outgoing_reserve,
                tariff_ppm as u128,
            );

            self.withdraw_from_reserves(outgoing_token, quantity_out);
            self.save();
            (outgoing_token, quantity_out)
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
            Config::add();
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
    fn new_pool(
        token_a: TID,
        token_b: TID,
        token_a_amount: Quantity,
        token_b_amount: Quantity,
    ) -> (u32, NID, NID) {
        let pool = Pool::add(token_a, token_b, token_a_amount, token_b_amount);
        (pool.id, pool.token_a_admin, pool.token_b_admin)
    }

    #[action]
    fn set_tarriff(pool_id: u32, token: TID, ppm: u32) {
        Pool::get_assert(pool_id).set_tarriff(token, ppm)
    }

    #[action]
    fn add_liquidity(
        pool_id: u32,
        amount_a_desired: Quantity,
        amount_b_desired: Quantity,
        amount_a_min: Quantity,
        amount_b_min: Quantity,
    ) {
        check(amount_a_desired.value > 0, "amount a must be non-zero");
        check(amount_b_desired.value > 0, "amount b must be non-zero");

        Pool::get_assert(pool_id).add_liquidity(
            amount_a_desired,
            amount_b_desired,
            amount_a_min,
            amount_b_min,
        );
    }

    #[action]
    fn remove_liquidity(pool_id: u32, lp_amount: Quantity) {
        Pool::get_assert(pool_id).remove_liquidity(lp_amount);
    }

    #[action]
    fn swap(pools: Vec<u32>, token_in: TID, amount_in: Quantity, min_return: Quantity) {
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
