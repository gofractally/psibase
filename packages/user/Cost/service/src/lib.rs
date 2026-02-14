use psibase::services::tokens::Quantity;

const SECONDS_IN_WEEK: u64 = 7 * 24 * 3600;
const SECONDS_IN_YEAR: u64 = 365 * 24 * 3600;
const PPM_DENOMINATOR: u128 = 1_000_000;
const RATE_PENALTY: u128 = 100_000;

fn calculate_fee(annual_fee_ppm: u32, seconds_elapsed: u64, value_amount: Quantity) -> Quantity {
    let seconds_in_year: u128 = SECONDS_IN_YEAR as u128;

    // Use u128 to avoid overflow during multiplication
    let numerator: u128 =
        (value_amount.value as u128) * (annual_fee_ppm as u128) * (seconds_elapsed as u128);
    let denominator: u128 = PPM_DENOMINATOR * seconds_in_year;

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
        services::tokens::{Decimal, Quantity, TID},
        AccountNumber, Fracpack, Table, TimePointSec, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    use async_graphql::ComplexObject;
    use psibase::services::transact::Wrapper as Transact;

    use crate::{
        calculate_fee, calculate_seconds_covered, PPM_DENOMINATOR, RATE_PENALTY, SECONDS_IN_WEEK,
    };

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
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    #[graphql(complex)]
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
        pub last_billed: TimePointSec,
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
                last_billed: now,
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

        fn seconds_since_renewal(&self) -> u64 {
            (Transact::call().currentBlock().time.seconds().seconds - self.last_billed.seconds)
                .min(0) as u64
        }

        fn billable_use(&self) -> Quantity {
            let seconds_elapsed_since_last_billed = self.seconds_since_renewal();

            let current_valuation = self.valuation;
            let annual_tax_rate = self.annual_tax_rate;

            calculate_fee(
                annual_tax_rate,
                seconds_elapsed_since_last_billed,
                current_valuation,
            )
        }

        pub fn get_billing_status(&self) -> (Quantity, u64) {
            let prepaid_balance = self.prepaid_balance();
            let amount_payable = self.billable_use();

            if prepaid_balance >= amount_payable {
                (amount_payable, 0)
            } else {
                let seconds_can_afford = calculate_seconds_covered(
                    self.annual_tax_rate,
                    prepaid_balance,
                    self.valuation,
                );
                let paid_until = self.last_billed.seconds + (seconds_can_afford as i64);

                let now = Transact::call().currentBlock().time.seconds();
                let seconds_in_arrears = now.seconds - paid_until;

                (prepaid_balance, (seconds_in_arrears as u64))
            }
        }

        pub fn draft_bill(&mut self) -> Quantity {
            let (amount_payable, seconds_in_arrears_after_payment) = self.get_billing_status();

            let now = Transact::call().currentBlock().time.seconds();

            if seconds_in_arrears_after_payment == 0 {
                self.last_billed = now;
            } else {
                self.last_billed =
                    TimePointSec::from(now.seconds - seconds_in_arrears_after_payment as i64);
            }
            amount_payable
        }

        pub fn commit_bill(&mut self) {
            let amount_payable = self.draft_bill();
            self.tax_sponsor(amount_payable);
            self.save();
        }

        fn prepaid_balance(&self) -> Quantity {
            psibase::services::tokens::Wrapper::call()
                .getSubBal(self.token_id, self.sub_account())
                .unwrap_or_default()
        }

        fn close_prepaid_account(&self) -> Quantity {
            let balance = self.prepaid_balance();
            if balance.value > 0 {
                psibase::services::tokens::Wrapper::call().fromSub(
                    self.token_id,
                    self.sub_account(),
                    balance,
                )
            }
            balance
        }

        fn sub_account(&self) -> String {
            self.manager.to_string() + &self.id.to_string() + &self.sponsor.to_string()
        }

        fn tax_sponsor(&self, amount: Quantity) {
            let tokens = psibase::services::tokens::Wrapper::call();
            tokens.fromSub(self.token_id, self.sub_account(), amount);
            tokens.credit(
                self.token_id,
                self.manager,
                amount,
                "Tax income".try_into().unwrap(),
            )
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

        pub fn current_price(&self) -> Quantity {
            let now = Transact::call().currentBlock().time.seconds().seconds;
            let seconds_in_arrears = now - self.last_billed.seconds;

            if seconds_in_arrears > 0 {
                let immediate_price_drop_penalty = PPM_DENOMINATOR
                    - RATE_PENALTY * (self.valuation.value as u128) / PPM_DENOMINATOR;

                let dutch_bid_price_drop = ((seconds_in_arrears as u128)
                    .min(SECONDS_IN_WEEK as u128))
                    * immediate_price_drop_penalty
                    / (SECONDS_IN_WEEK as u128);

                ((immediate_price_drop_penalty - dutch_bid_price_drop) as u64).into()
            } else {
                self.valuation
            }
        }

        pub fn purchase(&mut self) {
            check(self.is_on_market, "cost is not on market");

            self.commit_bill();
            let price = self.current_price();

            let purchaser = get_sender();

            self.faciliate_trade(purchaser, price);

            let days_worth_rent = calculate_fee(self.annual_tax_rate, 3600 * 24, price);
            psibase::services::tokens::Wrapper::call().debit(
                self.token_id,
                purchaser,
                days_worth_rent,
                "Initial prepaid balance".try_into().unwrap(),
            );

            self.top_up_sponsor_account(days_worth_rent);
        }

        fn faciliate_trade(&mut self, buyer: AccountNumber, purchase_price: Quantity) {
            let tokens = psibase::services::tokens::Wrapper::call();
            let seller = self.sponsor;

            tokens.debit(
                self.token_id,
                buyer,
                purchase_price,
                "Buying asset".try_into().unwrap(),
            );

            let seller_prepaid_balance = self.close_prepaid_account();
            tokens.credit(
                self.token_id,
                seller,
                seller_prepaid_balance + purchase_price,
                "Asset purchase + pre-existing prepaid balance"
                    .try_into()
                    .unwrap(),
            );

            self.sponsor = buyer;
            self.valuation = purchase_price;
            self.last_billed = Transact::call().currentBlock().time.seconds();
        }

        fn save(&self) {
            CostTable::read_write().put(&self).unwrap()
        }
    }

    #[ComplexObject]
    impl Cost {
        pub async fn price(&self) -> Decimal {
            let mut cloned = self.clone();
            cloned.draft_bill();
            let price = cloned.current_price();

            let precision = psibase::services::tokens::Wrapper::call()
                .getToken(cloned.token_id)
                .precision;

            Decimal::new(price, precision)
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
        Cost::get_assert(manager, id).commit_bill();
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
