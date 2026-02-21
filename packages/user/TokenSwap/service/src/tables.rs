#[psibase::service_tables]
pub mod tables {

    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::services::nft::NID;
    use psibase::services::token_swap::{swap, Wrapper as TokenSwap, PPM};
    use psibase::services::tokens::{Decimal, Quantity, TokenRecord, Wrapper as Tokens, TID};
    use psibase::{
        abort_message, check, check_none, check_some, get_sender, AccountNumber, Fracpack, Memo,
        Table, ToSchema,
    };

    use crate::helpers::{mul_div, sqrt};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}

        fn new() -> Self {
            Self {}
        }

        pub fn get() -> Option<Self> {
            InitTable::read().get_index_pk().get(&())
        }

        pub fn init() {
            check_none(Self::get(), "init row already exists");
            Self::new().save();
        }

        fn save(&self) {
            InitTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "PoolTable", index = 1)]
    #[derive(Serialize, Deserialize, SimpleObject, ToSchema, Fracpack, Debug)]
    #[graphql(complex)]
    pub struct Pool {
        #[primary_key]
        pub liquidity_token: TID,
        pub admin_nft: NID,
    }

    #[table(name = "ReserveTable", index = 2)]
    #[derive(Serialize, Deserialize, SimpleObject, ToSchema, Fracpack, Debug)]
    #[graphql(complex)]
    pub struct Reserve {
        pub pool_id: TID,
        pub token_id: TID,
        pub fee_ppm: u32,
    }

    impl Reserve {
        #[primary_key]
        pub fn pk(&self) -> (TID, TID) {
            (self.pool_id, self.token_id)
        }

        #[secondary_key(1)]
        fn by_token(&self) -> (TID, u32) {
            (self.token_id, self.pool_id)
        }

        fn new(pool_id: TID, token_id: TID, fee_ppm: u32) -> Self {
            Self {
                pool_id,
                fee_ppm,
                token_id,
            }
        }

        fn get_pool(&self) -> Pool {
            Pool::get_assert(self.pool_id)
        }

        pub fn get(pool_id: TID, token_id: TID) -> Option<Self> {
            ReserveTable::read()
                .get_index_pk()
                .get(&(pool_id, token_id))
        }

        pub fn get_assert(pool_id: TID, token_id: TID) -> Self {
            check_some(
                Self::get(pool_id, token_id),
                format!("reserve does not exist").as_str(),
            )
        }

        pub fn get_reserves_of_pool(pool_id: TID) -> (Self, Self) {
            let table = ReserveTable::read();
            let index = table.get_index_pk();

            let mut iter = index.range((pool_id, 0)..=(pool_id, u32::MAX));

            (iter.next().unwrap(), iter.next().unwrap())
        }

        pub fn set_fee(&mut self, fee_ppm: u32) {
            check(
                get_sender() == self.get_pool().administration_nft_owner(),
                "Must own administration NFT to set fee",
            );
            check(fee_ppm < PPM as u32, "fee too high");
            self.fee_ppm = fee_ppm;
            self.save();
        }

        pub fn add(pool_id: TID, token_id: TID) {
            Reserve::new(pool_id, token_id, 0).save();
        }

        pub fn balance(&self) -> Quantity {
            check_some(
                Tokens::call().getSubBal(self.token_id, self.pool_sub_account_id()),
                "reserve balance not found",
            )
        }

        pub fn debit_from_sender(&self, amount: Quantity) {
            let sender = get_sender();
            let tokens = Tokens::call();
            tokens.debit(self.token_id, sender, amount, "".into());
            tokens.reject(self.token_id, sender, "Dust".into());
        }

        pub fn pool_token_entitlement(
            &self,
            pool_tokens: Quantity,
            pool_token_supply: Quantity,
        ) -> Quantity {
            mul_div(pool_tokens, self.balance(), pool_token_supply)
        }

        fn pool_sub_account_id(&self) -> String {
            self.pool_id.to_string()
        }

        pub fn deposit_into_reserve(&self, amount: Quantity) {
            Tokens::call().toSub(self.token_id, self.pool_sub_account_id(), amount);
        }

        pub fn withdraw_from_reserve(&self, amount: Quantity) {
            Tokens::call().fromSub(self.token_id, self.pool_sub_account_id(), amount);
        }

        pub fn withdraw_and_credit_to_sender(&self, amount: Quantity, memo: Memo) {
            let token_id = self.token_id;
            let tokens = Tokens::call();
            tokens.fromSub(token_id, self.pool_sub_account_id(), amount);
            tokens.credit(token_id, get_sender(), amount, memo);
        }

        fn save(&self) {
            ReserveTable::read_write().put(&self).unwrap();
        }
    }

    #[ComplexObject]
    impl Reserve {
        #[graphql(name = "balance")]
        pub async fn balance_dec(&self) -> Decimal {
            let amount = TokenSwap::call().get_reserve(self.pool_id, self.token_id);
            let precision = Tokens::call().getToken(self.token_id).precision;
            Decimal::new(amount, precision)
        }

        pub async fn symbol(&self) -> Option<AccountNumber> {
            psibase::services::symbol::Wrapper::call()
                .getByToken(self.token_id)
                .map(|s| s.symbolId)
        }

        pub async fn pool(&self) -> Pool {
            Pool::get_assert(self.pool_id)
        }
    }

    impl Pool {
        pub fn get(id: u32) -> Option<Self> {
            PoolTable::read().get_index_pk().get(&id)
        }

        pub fn get_assert(liquidity_token: u32) -> Self {
            check_some(
                Self::get(liquidity_token),
                format!("pool does not exist, liquidity id: {}", liquidity_token).as_str(),
            )
        }

        pub fn administration_nft_owner(&self) -> AccountNumber {
            psibase::services::nft::Wrapper::call()
                .getNft(self.admin_nft)
                .owner
        }

        pub fn set_admin_nft(&mut self, nft_id: NID) {
            check(
                get_sender() == self.administration_nft_owner(),
                "Must own administration NFT to set new administration NFT",
            );
            check(
                psibase::services::nft::Wrapper::call().exists(nft_id),
                "new NFT does not exist",
            );
            self.admin_nft = nft_id;
            self.save();
        }

        fn pool_token(&self) -> TokenRecord {
            Tokens::call().getToken(self.liquidity_token)
        }

        fn pool_token_supply(&self) -> Quantity {
            let token = self.pool_token();
            token.issued_supply - token.burned_supply
        }

        pub fn get_reserve(&self, token_id: TID) -> Reserve {
            Reserve::get_assert(self.liquidity_token, token_id)
        }

        fn new(token_a_id: TID, token_b_id: TID, nft_id: Option<NID>) -> Self {
            check(
                token_a_id != token_b_id,
                "reserve tokens cannot be the same",
            );
            let tokens = psibase::services::tokens::Wrapper::call();
            tokens.getToken(token_a_id);
            tokens.getToken(token_b_id);

            let nft = psibase::services::nft::Wrapper::call();
            let sender = get_sender();

            let liquidity_token = tokens.create(4.try_into().unwrap(), u64::MAX.into());
            nft.debit(
                tokens.getToken(liquidity_token).nft_id,
                "Liquidity token creation".into(),
            );

            let mint_and_send_back = |memo| {
                let id = nft.mint();
                nft.credit(id, sender, memo);
                id
            };

            Reserve::add(liquidity_token, token_a_id);
            Reserve::add(liquidity_token, token_b_id);

            Self {
                liquidity_token: liquidity_token,
                admin_nft: nft_id.unwrap_or_else(|| {
                    mint_and_send_back("Pool administration".try_into().unwrap())
                }),
            }
        }

        fn reserves(&self) -> (Reserve, Reserve) {
            let (first, second) = Reserve::get_reserves_of_pool(self.liquidity_token);

            if first.token_id < second.token_id {
                (first, second)
            } else {
                (second, first)
            }
        }

        fn reserves_with_first(&self, first_token: TID) -> (Reserve, Reserve) {
            let (first, second) = Reserve::get_reserves_of_pool(self.liquidity_token);

            if first.token_id == first_token {
                (first, second)
            } else if second.token_id == first_token {
                (second, first)
            } else {
                abort_message("Token does not exist in pool reserve");
            }
        }

        pub fn reserves_in_order(&self, a_token: TID, b_token: TID) -> (Reserve, Reserve) {
            let (first, second) = Reserve::get_reserves_of_pool(self.liquidity_token);

            if first.token_id == a_token && second.token_id == b_token {
                (first, second)
            } else if first.token_id == b_token && second.token_id == a_token {
                (second, first)
            } else {
                abort_message("One or both tokens do not exist in pool reserve");
            }
        }

        fn quote_pool_token_contribution(
            &self,
            amount_a: Quantity,
            amount_b: Quantity,
            reserve_a_balance: Quantity,
            reserve_b_balance: Quantity,
        ) -> Quantity {
            let total_liquidity = self.pool_token_supply();

            let lp_tokens_from_a_deposit = mul_div(amount_a, total_liquidity, reserve_a_balance);
            let lp_tokens_from_b_deposit = mul_div(amount_b, total_liquidity, reserve_b_balance);

            lp_tokens_from_a_deposit.min(lp_tokens_from_b_deposit)
        }

        fn balance_liquidity_contribution_ratio(
            amount_a_desired: Quantity,
            amount_b_desired: Quantity,
            reserve_a_balance: Quantity,
            reserve_b_balance: Quantity,
        ) -> (Quantity, Quantity) {
            let amount_a_optimal = mul_div(amount_b_desired, reserve_a_balance, reserve_b_balance);
            let amount_b_optimal = mul_div(amount_a_desired, reserve_b_balance, reserve_a_balance);

            if amount_b_optimal <= amount_b_desired {
                (amount_a_desired, amount_b_optimal)
            } else {
                (amount_a_optimal, amount_b_desired)
            }
        }

        pub fn add_liquidity(
            &self,
            token_a_id: TID,
            token_b_id: TID,
            amount_a_deposit: Quantity,
            amount_b_deposit: Quantity,
        ) {
            check(amount_a_deposit.value > 0, "amount a must be non-zero");
            check(amount_b_deposit.value > 0, "amount b must be non-zero");

            let (reserve_a, reserve_b) = self.reserves_in_order(token_a_id, token_b_id);

            let reserve_a_balance = reserve_a.balance();
            let reserve_b_balance = reserve_b.balance();

            check(
                reserve_a_balance.value > 0 && reserve_b_balance.value > 0,
                "pool does not have sufficient reserves",
            );

            let (amount_a, amount_b) = Self::balance_liquidity_contribution_ratio(
                amount_a_deposit,
                amount_b_deposit,
                reserve_a_balance,
                reserve_b_balance,
            );

            let lp_tokens_to_mint = self.quote_pool_token_contribution(
                amount_a,
                amount_b,
                reserve_a_balance,
                reserve_b_balance,
            );

            check(lp_tokens_to_mint.value > 0, "no liquidity to mint");

            reserve_a.debit_from_sender(amount_a);
            reserve_b.debit_from_sender(amount_b);

            reserve_a.deposit_into_reserve(amount_a);
            reserve_b.deposit_into_reserve(amount_b);

            self.mint_pool_tokens(lp_tokens_to_mint);
            self.credit_sender_pool_tokens(lp_tokens_to_mint);
            if token_a_id < token_b_id {
                self.on_liquidity_mod(true, token_a_id, token_b_id, amount_a, amount_b);
            } else {
                self.on_liquidity_mod(true, token_b_id, token_a_id, amount_b, amount_a);
            }
        }

        fn on_liquidity_mod(
            &self,
            is_add: bool,
            token_a_id: TID,
            token_b_id: TID,
            amount_a: Quantity,
            amount_b: Quantity,
        ) {
            let tokens = psibase::services::tokens::Wrapper::call();

            crate::Wrapper::emit().history().liq_modified(
                self.liquidity_token,
                get_sender(),
                is_add,
                Decimal::new(amount_a, tokens.getToken(token_a_id).precision).to_string(),
                Decimal::new(amount_b, tokens.getToken(token_b_id).precision).to_string(),
            );
        }

        pub fn remove_liquidity(&self, liquidity_amount: Quantity) {
            check(
                liquidity_amount.value > 0,
                "liquidity amount must be positive",
            );
            self.debit_lp_tokens_from_sender(liquidity_amount);

            let pool_token_supply = self.pool_token_supply();
            let (a_reserve, b_reserve) = self.reserves();

            let a_amount = a_reserve.pool_token_entitlement(liquidity_amount, pool_token_supply);
            let b_amount = b_reserve.pool_token_entitlement(liquidity_amount, pool_token_supply);

            check(a_amount.value > 0, "no a token reserve balance to return");
            check(b_amount.value > 0, "no b token reserve balance to return");

            a_reserve.withdraw_and_credit_to_sender(a_amount, "Withdrawal 1/2".into());
            b_reserve.withdraw_and_credit_to_sender(b_amount, "Withdrawal 2/2".into());
            self.burn_lp_tokens(liquidity_amount);

            self.on_liquidity_mod(
                false,
                a_reserve.token_id,
                b_reserve.token_id,
                a_amount,
                b_amount,
            )
        }

        fn debit_lp_tokens_from_sender(&self, liquidity_amount: Quantity) {
            Tokens::call().debit(
                self.liquidity_token,
                get_sender(),
                liquidity_amount,
                format!("Remove pool: {} liquidity", self.liquidity_token)
                    .as_str()
                    .into(),
            );
        }

        fn mint_pool_tokens(&self, amount: Quantity) {
            Tokens::call().mint(self.liquidity_token, amount, "".into());
        }

        fn credit_sender_pool_tokens(&self, amount: Quantity) {
            Tokens::call().credit(
                self.liquidity_token,
                get_sender(),
                amount,
                "Pool tokens".into(),
            )
        }

        fn burn_lp_tokens(&self, amount: Quantity) {
            Tokens::call().burn(self.liquidity_token, amount, "Liquidity withdrawal".into());
        }

        pub fn add(
            a_token: TID,
            b_token: TID,
            a_amount: Quantity,
            b_amount: Quantity,
            nft_id: Option<NID>,
        ) -> Self {
            let pool = Self::new(a_token, b_token, nft_id);

            let (reserve_a, reserve_b) = pool.reserves_in_order(a_token, b_token);
            reserve_a.debit_from_sender(a_amount);
            reserve_a.deposit_into_reserve(a_amount);

            reserve_b.debit_from_sender(b_amount);
            reserve_b.deposit_into_reserve(b_amount);

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
            pool.mint_pool_tokens(initial_lp_tokens);
            pool.credit_sender_pool_tokens(initial_lp_tokens - dead_tokens);

            pool.save();
            pool
        }

        fn save(&self) {
            PoolTable::read_write().put(&self).unwrap();
        }

        pub fn swap(&mut self, incoming_token: TID, incoming_amount: Quantity) -> (TID, Quantity) {
            let (incoming_reserve, outgoing_reserve) = self.reserves_with_first(incoming_token);

            let outgoing_amount = swap(
                incoming_amount,
                incoming_reserve.balance(),
                outgoing_reserve.balance(),
                incoming_reserve.fee_ppm,
            );
            check(outgoing_amount.value > 0, "outgoing amount is 0");

            incoming_reserve.deposit_into_reserve(incoming_amount);
            outgoing_reserve.withdraw_from_reserve(outgoing_amount);
            self.save();
            (outgoing_reserve.token_id, outgoing_amount)
        }
    }

    #[ComplexObject]
    impl Pool {
        pub async fn liquidity_token_supply(&self) -> Decimal {
            let token = Tokens::call().getToken(self.liquidity_token);
            Decimal::new(token.issued_supply - token.burned_supply, token.precision)
        }

        pub async fn reserve_a(&self) -> Reserve {
            let (a, _) = self.reserves();
            a
        }

        pub async fn reserve_b(&self) -> Reserve {
            let (_, b) = self.reserves();
            b
        }
    }
}
