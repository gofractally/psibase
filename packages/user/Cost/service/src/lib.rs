use psibase::services::tokens::Quantity;

const SECONDS_IN_WEEK: u128 = 7 * 24 * 3600;
const DUTCH_BID_WINDOW: u128 = SECONDS_IN_WEEK;
const SECONDS_IN_YEAR: u64 = 365 * 24 * 3600;
const PPM_DENOMINATOR: u128 = 1_000_000;

fn calculate_fee(annual_fee_ppm: u32, seconds_elapsed: u64, value_amount: Quantity) -> Quantity {
    let seconds_in_year: u128 = SECONDS_IN_YEAR as u128;

    let numerator: u128 =
        (value_amount.value as u128) * (annual_fee_ppm as u128) * (seconds_elapsed as u128);
    let denominator: u128 = PPM_DENOMINATOR * seconds_in_year;

    let fee: u128 = numerator / denominator;

    (fee as u64).into()
}

fn calculate_seconds_covered(
    annual_fee_ppm: u32,
    fee_paid: Quantity,
    value_amount: Quantity,
) -> u64 {
    let seconds_in_year: u128 = SECONDS_IN_YEAR as u128;

    let numerator: u128 = (fee_paid.value as u128) * PPM_DENOMINATOR * seconds_in_year;
    let denominator: u128 = (value_amount.value as u128) * (annual_fee_ppm as u128);

    let seconds: u128 = numerator / denominator;

    seconds as u64
}

#[psibase::service_tables]
pub mod tables {
    use std::u64;

    use async_graphql::SimpleObject;
    use psibase::{
        check, check_some, get_sender,
        services::tokens::{Decimal, Quantity, TID},
        AccountNumber, Fracpack, Table, TimePointSec, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    use async_graphql::ComplexObject;
    use psibase::services::transact::Wrapper as Transact;

    use crate::{calculate_fee, calculate_seconds_covered, DUTCH_BID_WINDOW};

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

        pub fn bill_many(manager: AccountNumber, from: u64, amount: u16) {
            CostTable::read()
                .get_index_pk()
                .range(
                    (manager, AccountNumber::new(from))..=(manager, AccountNumber::new(u64::MAX)),
                )
                .take(amount as usize)
                .for_each(|mut cost| {
                    cost.commit_bill();
                });
        }

        pub fn set_is_on_market(&mut self, is_on_market: bool) {
            check(
                get_sender() == self.manager,
                "must be manager to take asset off market",
            );
            self.is_on_market = is_on_market;
            self.save()
        }

        pub fn set_valuation(&mut self, new_valuation: Quantity) {
            check(
                get_sender() == self.sponsor,
                "must be owner to update valuation",
            );

            self.commit_bill();
            check(
                self.seconds_since_renewal() == 0,
                "cannot change valuation while in arrears",
            );
            self.valuation = new_valuation;
            self.save();
        }

        fn seconds_since_renewal(&self) -> u64 {
            (Transact::call().currentBlock().time.seconds().seconds - self.last_billed.seconds)
                as u64
        }

        pub fn draft_bill(&mut self) -> Quantity {
            let now = Transact::call().currentBlock().time.seconds();
            let elapsed_seconds = (now.seconds - self.last_billed.seconds) as u64;

            let prepaid_balance = self.prepaid_balance();

            // Compute ideal fee for full elapsed time
            let full_fee = calculate_fee(self.annual_tax_rate, elapsed_seconds, self.valuation);

            // Cap at what can be afforded to avoid over-billing
            let billable = if full_fee.value > prepaid_balance.value {
                prepaid_balance
            } else {
                full_fee
            };

            // Derive actual covered seconds from billable (may be < elapsed due to flooring)
            let covered_seconds =
                calculate_seconds_covered(self.annual_tax_rate, billable, self.valuation);

            // Adjust for any arrears (uncovered time)
            let arrears_seconds = elapsed_seconds.saturating_sub(covered_seconds);
            self.last_billed = TimePointSec::from(now.seconds - arrears_seconds as i64);

            billable
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

        fn dutch_price_discount(&self, arrears_seconds: u64) -> Quantity {
            ((DUTCH_BID_WINDOW.min(arrears_seconds as u128) * self.valuation.value as u128
                / DUTCH_BID_WINDOW) as u64)
                .into()
        }

        pub fn current_price(&self) -> Quantity {
            // Because current_price is called after bill, any seconds past renewal is now
            // seconds in arrears.
            let seconds_in_arrears = self.seconds_since_renewal();

            self.valuation - self.dutch_price_discount(seconds_in_arrears)
        }

        pub fn purchase(&mut self) {
            check(self.is_on_market, "cost is not on market");

            self.commit_bill();
            self.facilitate_trade(get_sender(), self.current_price());
        }

        fn facilitate_trade(&mut self, buyer: AccountNumber, purchase_price: Quantity) {
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
    fn bill(manager: AccountNumber, id: AccountNumber) {
        Cost::get_assert(manager, id).commit_bill();
    }

    #[action]
    fn bill_many(manager: AccountNumber, from: u64, amount: u16) {
        Cost::bill_many(manager, from, amount);
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
