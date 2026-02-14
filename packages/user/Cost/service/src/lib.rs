use psibase::services::tokens::Quantity;

const SECONDS_IN_WEEK: u64 = 7 * 24 * 3600;
const SECONDS_IN_YEAR: u64 = 365 * 24 * 3600;

fn calculate_fee(annual_fee_ppm: u32, seconds_elapsed: u64, value_amount: Quantity) -> Quantity {
    let ppm_denominator: u128 = 1_000_000;
    let seconds_in_year: u128 = SECONDS_IN_YEAR as u128;

    // Use u128 to avoid overflow during multiplication
    let numerator: u128 =
        (value_amount.value as u128) * (annual_fee_ppm as u128) * (seconds_elapsed as u128);
    let denominator: u128 = ppm_denominator * seconds_in_year;

    // Integer division for the fee
    let fee: u128 = numerator / denominator;

    // Cast back to u64 (add error handling if needed for overflow)
    (fee as u64).into()
}

fn calculate_seconds_covered(
    annual_fee_ppm: u32,
    fee_paid: Quantity,
    value_amount: Quantity,
) -> u64 {
    let ppm_denominator: u128 = 1_000_000;
    let seconds_in_year: u128 = SECONDS_IN_YEAR as u128;

    // Use u128 to avoid overflow during multiplication
    let numerator: u128 = (fee_paid.value as u128) * ppm_denominator * seconds_in_year;
    let denominator: u128 = (value_amount.value as u128) * (annual_fee_ppm as u128);

    // Integer division for the seconds
    let seconds: u128 = numerator / denominator;

    // Cast back to u64 (add error handling if needed for overflow or division by zero)
    seconds as u64
}

#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{
        check, check_some, get_sender,
        services::tokens::{Quantity, TID},
        AccountNumber, Fracpack, Table, TimePointSec, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    use psibase::services::transact::Wrapper as Transact;

    use crate::{calculate_fee, calculate_seconds_covered, SECONDS_IN_WEEK};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "ManagerTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Manager {
        #[primary_key]
        pub manager: AccountNumber,
    }

    impl Manager {
        // #[primary_key]
        // fn pk(&self) {}
    }

    #[table(name = "CostTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Cost {
        // Namespace: savethewhales fractal
        pub manager: AccountNumber,
        // Name: development
        pub id: AccountNumber,
        pub nft_id: TID,
        pub is_on_market: bool,
        pub token_id: TID,
        pub valuation: Quantity,
        pub sponsor: AccountNumber,
        pub renewal_date: TimePointSec,
        pub annual_tax_rate: u32,
    }

    impl Cost {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.manager, self.id)
        }

        fn new(
            manager: AccountNumber,
            id: AccountNumber,
            token_id: TID,
            annual_tax_rate: u32,
            valuation: Quantity,
        ) -> Cost {
            let now = Transact::call().currentBlock().time.seconds();

            Cost {
                nft_id: psibase::services::nft::Wrapper::call().mint(),
                sponsor: get_sender(),
                is_on_market: true,
                renewal_date: now,
                manager,
                id,
                token_id,
                annual_tax_rate,
                valuation,
            }
        }

        pub fn add(
            manager: AccountNumber,
            id: AccountNumber,
            token_id: TID,
            annual_tax_rate: u32,
            valuation: Quantity,
        ) -> Cost {
            let new_instance = Self::new(manager, id, token_id, annual_tax_rate, valuation);
            new_instance.save();
            new_instance
        }

        pub fn get(manager: AccountNumber, id: AccountNumber) -> Option<Cost> {
            CostTable::read().get_index_pk().get(&(manager, id))
        }

        pub fn get_assert(manager: AccountNumber, id: AccountNumber) -> Cost {
            check_some(Self::get(manager, id), "cost does not exist")
        }

        pub fn set_is_on_market(&mut self, is_on_market: bool) {
            self.is_on_market = is_on_market;
            self.save()
        }

        pub fn set_valuation(&mut self, price: Quantity) {
            self.valuation = price;
            self.save();
        }

        pub fn bill(&mut self) {
            let seconds_elapsed_since_purchase = (Transact::call()
                .currentBlock()
                .time
                .seconds()
                .seconds
                - self.renewal_date.seconds)
                .min(0) as u64;

            let current_valuation = self.valuation;
            let annual_tax_rate = self.annual_tax_rate;

            let amount_payable = calculate_fee(
                annual_tax_rate,
                seconds_elapsed_since_purchase,
                current_valuation,
            );

            let prepaid_balance = self.prepaid_balance();

            if prepaid_balance > amount_payable {
                let now = Transact::call().currentBlock().time.seconds();

                self.renewal_date = now;
                self.tax_sponsor(amount_payable, false);
            } else {
            }
        }

        fn prepaid_balance(&self) -> Quantity {
            psibase::services::tokens::Wrapper::call()
                .getSubBal(self.token_id, self.sub_account())
                .unwrap_or_default()
        }

        fn sub_account(&self) -> String {
            self.manager.to_string() + &self.id.to_string() + &self.sponsor.to_string()
        }

        fn tax_sponsor(&self, amount: Quantity, close_prepaid_account: bool) {
            let tokens = psibase::services::tokens::Wrapper::call();

            let sub_bal_deduction = if close_prepaid_account {
                psibase::services::tokens::Wrapper::call()
                    .getSubBal(self.token_id, self.sub_account())
                    .unwrap_or_default()
            } else {
                amount
            };
            tokens.fromSub(self.token_id, self.sub_account(), sub_bal_deduction);

            tokens.credit(
                self.token_id,
                self.manager,
                amount,
                "Tax rate fee".try_into().unwrap(),
            );

            if close_prepaid_account {
                let remaining_balance = sub_bal_deduction - amount;
                if remaining_balance.value > 0 {
                    tokens.credit(
                        self.token_id,
                        self.sponsor,
                        remaining_balance,
                        "Remaining prepaid credit return".try_into().unwrap(),
                    )
                }
            }
        }

        pub fn top_up_sponsor_account(&self, amount: Quantity) {
            check(
                get_sender() == self.sponsor,
                "must be sponsor to top up account",
            );
            let tokens = psibase::services::tokens::Wrapper::call();
            tokens.debit(
                self.token_id,
                self.sponsor,
                amount,
                "Sponsor account top up".try_into().unwrap(),
            );
            tokens.toSub(self.token_id, self.sub_account(), amount);
        }

        fn credit_sponsor(&self, amount: Quantity) {
            psibase::services::tokens::Wrapper::call().credit(
                self.token_id,
                self.sponsor,
                amount,
                "Purchase reward".try_into().unwrap(),
            )
        }

        fn credit_manager(&self, amount: Quantity) {
            psibase::services::tokens::Wrapper::call().credit(
                self.token_id,
                self.manager,
                amount,
                "Tax income".try_into().unwrap(),
            )
        }

        pub fn purchase(&mut self) {
            check(self.is_on_market, "cost is not on market");

            let seconds_elapsed_since_renewal = (Transact::call()
                .currentBlock()
                .time
                .seconds()
                .seconds
                - self.renewal_date.seconds)
                .min(0) as u64;

            let current_valuation = self.valuation;
            let annual_tax_rate = self.annual_tax_rate;

            let amount_payable = calculate_fee(
                annual_tax_rate,
                seconds_elapsed_since_renewal,
                current_valuation,
            );

            let prepaid_amount = self.prepaid_balance();
            let is_paid_for = prepaid_amount >= amount_payable;

            let price = if is_paid_for {
                self.tax_sponsor(amount_payable, true);
                current_valuation
            } else {
                self.tax_sponsor(prepaid_amount, true);

                let seconds_paid_for =
                    calculate_seconds_covered(annual_tax_rate, prepaid_amount, current_valuation);
                let seconds_in_arrears = seconds_elapsed_since_renewal - seconds_paid_for;

                let immediate_price_drop_penalty =
                    900_000 * (current_valuation.value as u128) / 1_000_000;

                let dutch_bid_price_drop = ((seconds_in_arrears as u128)
                    .min(SECONDS_IN_WEEK as u128))
                    * immediate_price_drop_penalty
                    / (SECONDS_IN_WEEK as u128);

                ((immediate_price_drop_penalty - dutch_bid_price_drop) as u64).into()
            };

            let purchaser = get_sender();
            let days_worth_rent = calculate_fee(self.annual_tax_rate, 3600 * 24, price);
            let total_billable = price + days_worth_rent;

            psibase::services::tokens::Wrapper::call().debit(
                self.token_id,
                purchaser,
                total_billable,
                "Cost purchase + initial prepaid balance"
                    .try_into()
                    .unwrap(),
            );

            self.credit_sponsor(price);

            self.sponsor = purchaser;
            self.valuation = price;
            self.renewal_date = Transact::call().currentBlock().time.seconds();

            self.top_up_sponsor_account(days_worth_rent);
        }

        fn save(&self) {
            CostTable::read_write().put(&self).unwrap()
        }
    }
}

#[psibase::service(name = "cost", tables = "tables")]
pub mod service {
    use crate::tables::{Cost, InitRow, InitTable};
    use psibase::{
        services::tokens::{Quantity, TID},
        *,
    };

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    fn set_is_on_market(id: AccountNumber, is_on_market: bool) {
        Cost::get_assert(get_sender(), id).set_is_on_market(is_on_market);
    }

    #[action]
    fn set_valuation(manager: AccountNumber, id: AccountNumber, price: Quantity) {
        Cost::get_assert(manager, id).set_valuation(price);
    }

    #[action]
    fn bill_cost(manager: AccountNumber, id: AccountNumber) {
        Cost::get_assert(manager, id).bill()
    }

    #[action]
    fn new_cost(id: AccountNumber, token_id: TID, tax_rate: u32, valuation: Quantity) -> u32 {
        Cost::add(get_sender(), id, token_id, tax_rate, valuation).nft_id
    }

    #[action]
    fn purchase(manager: AccountNumber, id: AccountNumber) {
        Cost::get_assert(manager, id).purchase();
    }

    #[action]
    fn top_up(manager: AccountNumber, id: AccountNumber, amount: Quantity) {
        Cost::get_assert(manager, id).top_up_sponsor_account(amount);
    }
}

#[cfg(test)]
mod tests;
