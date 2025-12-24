#[psibase::service_tables]
pub mod tables {
    use psibase::services::tokens::{Quantity, Wrapper as Tokens};
    use psibase::{check, get_sender, AccountNumber};
    use psibase::{
        check_none, check_some,
        services::tokens::{Quantity, TID},
        Fracpack, Table, ToSchema,
    };

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

        pub fn add() -> Self {
            check_none(Self::get(), "config row already added");
            let new_instance = Self {
                last_used_pool_id: 0,
            };
            new_instance.save();
            new_instance
        }

        fn save(&self) {
            ConfigTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "PoolTable", index = 1)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct Pool {
        #[primary_key]
        // pool should be the subid on the sub account......
        pub id: u32,
        pub reserve_a: TID,
        pub reserve_b: TID,
    }

    impl Pool {
        pub fn get(id: u32) -> Option<Self> {
            PoolTable::read().get_index_pk().get(&id)
        }

        pub fn get_assert(id: u32) -> Self {
            check_some(Self::get(id), "pool does not exist")
        }

        fn sub_account_id(&self) -> String {
            self.id.to_string()
        }

        pub fn get_balance(&self, tid: TID) -> Quantity {
            check_some(
                Tokens::call().getSubBal(tid, self.sub_account_id()),
                "expecting missing reserve a balance",
            )
        }

        fn get_amount_out(
            &self,
            incoming_token: TID,
            incoming_amount: Quantity,
        ) -> (TID, Quantity) {
            let outgoing_token = if incoming_token == self.reserve_a {
                self.reserve_b
            } else {
                self.reserve_a
            };

            let incoming_reserve = self.get_balance(incoming_token);
            let outgoing_reserve = self.get_balance(outgoing_token);

            check(incoming_reserve.value > 0, "incoming reserve is zero");
            check(outgoing_reserve.value > 0, "outgoing reserve is zero");

            let incoming_amount = incoming_amount.value as u128;
            let incoming_reserve = incoming_reserve.value as u128;
            let outgoing_reserve = outgoing_reserve.value as u128;

            let numerator = outgoing_reserve.checked_mul(incoming_amount).unwrap();
            let denominator = incoming_reserve.checked_add(incoming_amount).unwrap();

            let amount_out = numerator / denominator;
            (outgoing_token, (amount_out as u64).into())
        }

        fn add_balance(&self, debit_from: AccountNumber, token_id: TID, amount: Quantity) {
            let tokens = Tokens::call();

            tokens.debit(token_id, debit_from, amount, "Swap".into());
            tokens.toSub(token_id, self.sub_account_id(), amount);
        }

        fn subtract_balance(&self, credit_to: AccountNumber, token_id: TID, amount: Quantity) {
            let tokens = Tokens::call();

            tokens.fromSub(token_id, self.sub_account_id(), amount);
            tokens.credit(token_id, credit_to, amount, "Token swap".into());
        }

        pub fn swap(
            &mut self,
            incoming_token: TID,
            incoming_amount: Quantity,
            minimum_return: Quantity,
        ) {
            let sender = get_sender();

            self.add_balance(sender, incoming_token, incoming_amount);

            let (outgoing_token, outgoing_amount) =
                self.get_amount_out(incoming_token, incoming_amount);
            check(outgoing_amount.value > 0, "swap return is zero");
            check(
                outgoing_amount >= minimum_return,
                "does not meet minimum return",
            );

            self.subtract_balance(sender, outgoing_token, outgoing_amount);
        }
    }
}

#[psibase::service(name = "token-swap", tables = "tables")]
pub mod service {
    use crate::tables::{Config, Pool};
    use psibase::{
        services::tokens::{Quantity, TID},
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
    fn new_pool(thing: String) {}

    #[action]
    fn swap(pool_id: u32, token_in: TID, amount_in: Quantity, min_return: Quantity) {
        let pool = Pool::get_assert(pool_id);
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
