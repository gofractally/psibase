use std::u64;

use psibase::services::tokens::Quantity;

const SECONDS_IN_YEAR: u128 = 365 * 24 * 3600;
const PPM_DENOMINATOR: u128 = 1_000_000;

fn calculate_fee(annual_fee_ppm: u32, seconds_elapsed: u64, value_amount: Quantity) -> Quantity {
    let numerator: u128 =
        (value_amount.value as u128) * (annual_fee_ppm as u128) * (seconds_elapsed as u128);
    let denominator: u128 = PPM_DENOMINATOR * SECONDS_IN_YEAR;

    let fee: u128 = numerator / denominator;

    (fee as u64).into()
}

fn increase_by_ppm(value_amount: Quantity, ppm: u32) -> Quantity {
    let res = (PPM_DENOMINATOR + ppm as u128) * (value_amount.value as u128) / PPM_DENOMINATOR;
    (res.min(u64::MAX as u128) as u64).into()
}

fn calculate_seconds_covered(
    annual_fee_ppm: u32,
    fee_paid: Quantity,
    value_amount: Quantity,
) -> u64 {
    let numerator: u128 = (fee_paid.value as u128) * PPM_DENOMINATOR * SECONDS_IN_YEAR;
    let denominator: u128 = (value_amount.value as u128) * (annual_fee_ppm as u128);

    let seconds: u128 = numerator / denominator;

    seconds as u64
}

fn dutch_discount(valuation: Quantity, arrears_seconds: u64, dutch_bid_window: u128) -> Quantity {
    ((dutch_bid_window.min(arrears_seconds as u128) * valuation.value as u128 / dutch_bid_window)
        as u64)
        .into()
}

#[psibase::service_tables]
pub mod tables {
    use std::u64;

    use async_graphql::SimpleObject;
    use psibase::{
        check, check_some, get_sender,
        services::{
            nft::NID,
            tokens::{Decimal, Quantity, TID},
        },
        AccountNumber, Fracpack, Table, TimePointSec, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    use async_graphql::ComplexObject;
    use psibase::services::transact::Wrapper as Transact;

    use crate::{calculate_fee, calculate_seconds_covered, dutch_discount, increase_by_ppm};

    #[table(name = "ManagerTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct Manager {
        #[primary_key]
        pub nft_id: NID,
        pub dutch_bid_window: u32,
        pub min_purchase_increase: u32,
        pub payout_account: AccountNumber,
    }

    impl Manager {
        fn new(dutch_bid_window: u32, min_purchase_increase: u32) -> Self {
            Self {
                nft_id: psibase::services::nft::Wrapper::call().mint(),
                payout_account: get_sender(),
                dutch_bid_window,
                min_purchase_increase,
            }
        }

        pub fn add(dutch_bid_window: u32, min_purchase_increase: u32) -> Self {
            Self::new(dutch_bid_window, min_purchase_increase)
        }

        pub fn get(nft_id: NID) -> Option<Self> {
            ManagerTable::read().get_index_pk().get(&nft_id)
        }

        pub fn get_assert(nft_id: NID) -> Self {
            check_some(Self::get(nft_id), "manager does not exist")
        }

        fn manager_nft_holder(&self) -> AccountNumber {
            psibase::services::nft::Wrapper::call()
                .getNft(self.nft_id)
                .owner
        }

        fn check_sender_owns_manager_nft(&self) {
            check(
                get_sender() == self.manager_nft_holder(),
                "must own manager nft",
            );
        }

        pub fn set_payout_account(&mut self, new_payout_account: AccountNumber) {
            self.check_sender_owns_manager_nft();
            check(
                psibase::services::accounts::Wrapper::call().exists(new_payout_account),
                "payout account does not exist",
            );
            self.payout_account = new_payout_account;
            self.save();
        }

        fn save(&self) {
            ManagerTable::read_write().put(&self).unwrap()
        }
    }

    #[table(name = "AssetTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    #[graphql(complex)]
    pub struct Asset {
        pub manager_nft: NID,
        pub id: AccountNumber,
        pub nft_id: TID,
        pub is_on_market: bool,
        pub token_id: TID,
        pub valuation: Quantity,
        pub owner: AccountNumber,
        pub last_billed: TimePointSec,
        pub annual_tax_rate: u32,
    }

    impl Asset {
        #[primary_key]
        fn pk(&self) -> (NID, AccountNumber) {
            (self.manager_nft, self.id)
        }

        #[secondary_key(1)]
        fn by_nft(&self) -> NID {
            self.nft_id
        }

        fn new(
            manager_nft: NID,
            id: AccountNumber,
            token_id: TID,
            annual_tax_rate: u32,
            valuation: Quantity,
        ) -> Asset {
            let now = Transact::call().currentBlock().time.seconds();

            Asset {
                nft_id: psibase::services::nft::Wrapper::call().mint(),
                owner: get_sender(),
                is_on_market: true,
                last_billed: now,
                manager_nft,
                id,
                token_id,
                annual_tax_rate,
                valuation,
            }
        }

        pub fn add(
            manager: NID,
            id: AccountNumber,
            token_id: TID,
            annual_tax_rate: u32,
            valuation: Quantity,
        ) -> Asset {
            let new_instance = Self::new(manager, id, token_id, annual_tax_rate, valuation);
            new_instance.check_sender_owns_manager_nft();
            new_instance.save();
            new_instance
        }

        pub fn get(manager: NID, id: AccountNumber) -> Option<Asset> {
            AssetTable::read().get_index_pk().get(&(manager, id))
        }

        pub fn get_assert(manager: NID, id: AccountNumber) -> Asset {
            check_some(Self::get(manager, id), "asset does not exist")
        }

        pub fn get_by_nft(nft_id: NID) -> Option<Asset> {
            AssetTable::read().get_index_by_nft().get(&nft_id)
        }

        pub fn bill_many(manager: NID, from: u64, amount: u16) {
            AssetTable::read()
                .get_index_pk()
                .range(
                    (manager, AccountNumber::new(from))..=(manager, AccountNumber::new(u64::MAX)),
                )
                .take(amount as usize)
                .for_each(|mut asset| {
                    asset.commit_bill();
                });
        }

        fn check_sender_owns_manager_nft(&self) {
            check(
                get_sender() == self.manager_nft_holder(),
                "must own manager nft",
            );
        }

        pub fn set_is_on_market(&mut self, is_on_market: bool) {
            self.check_sender_owns_manager_nft();
            self.is_on_market = is_on_market;
            self.save()
        }

        pub fn set_valuation(&mut self, new_valuation: Quantity) {
            check(
                get_sender() == self.owner,
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
            if amount_payable.value > 0 {
                self.tax_owner(amount_payable);
            }
            self.save();
        }

        fn manager_nft_holder(&self) -> AccountNumber {
            psibase::services::nft::Wrapper::call()
                .getNft(self.manager_nft)
                .owner
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
            format!("{}-{}-{}", self.manager_nft, self.id, self.owner)
        }

        fn tax_owner(&self, amount: Quantity) {
            let tokens = psibase::services::tokens::Wrapper::call();
            tokens.fromSub(self.token_id, self.sub_account(), amount);
            psibase::services::tokens::Wrapper::call().credit(
                self.token_id,
                self.manager_nft_holder(),
                amount,
                "Tax income".try_into().unwrap(),
            )
        }

        pub fn top_up_owner_account(&self, amount: Quantity) {
            check(
                get_sender() == self.owner,
                "must be owner to top up account",
            );
            let tokens = psibase::services::tokens::Wrapper::call();
            tokens.debit(
                self.token_id,
                self.owner,
                amount,
                "owner account top up".try_into().unwrap(),
            );
            tokens.toSub(self.token_id, self.sub_account(), amount);
        }

        fn manager(&self) -> Manager {
            Manager::get_assert(self.manager_nft)
        }

        pub fn purchase_price(&self) -> Quantity {
            // Because current_price is called after bill, any seconds past renewal is now
            // seconds in arrears.
            let seconds_in_arrears = self.seconds_since_renewal();
            let valuation = self.valuation;
            if seconds_in_arrears > 0 {
                valuation
                    - dutch_discount(
                        valuation,
                        seconds_in_arrears,
                        self.manager().dutch_bid_window.into(),
                    )
            } else {
                increase_by_ppm(valuation, self.manager().min_purchase_increase)
            }
        }

        pub fn purchase(&mut self) {
            check(self.is_on_market, "asset is not on market");

            self.commit_bill();
            self.facilitate_trade(get_sender(), self.purchase_price());
        }

        fn facilitate_trade(&mut self, buyer: AccountNumber, purchase_price: Quantity) {
            let tokens = psibase::services::tokens::Wrapper::call();
            let seller = self.owner;

            if purchase_price.value > 0 {
                tokens.debit(
                    self.token_id,
                    buyer,
                    purchase_price,
                    "Buying asset".try_into().unwrap(),
                );
            }

            let seller_prepaid_balance = self.close_prepaid_account();
            let credit_amount = purchase_price + seller_prepaid_balance;

            if credit_amount.value > 0 {
                tokens.credit(
                    self.token_id,
                    seller,
                    credit_amount,
                    "Asset sale proceeds + pre-existing prepaid balance"
                        .try_into()
                        .unwrap(),
                );
            }

            self.owner = buyer;
            self.valuation = purchase_price;
            self.last_billed = Transact::call().currentBlock().time.seconds();
        }

        fn save(&self) {
            AssetTable::read_write().put(&self).unwrap()
        }
    }

    #[ComplexObject]
    impl Asset {
        pub async fn price(&self) -> Decimal {
            let mut cloned = self.clone();
            cloned.draft_bill();
            let price = cloned.purchase_price();

            let precision = psibase::services::tokens::Wrapper::callc()
                .getToken(cloned.token_id)
                .precision;

            Decimal::new(price, precision)
        }
    }
}

#[psibase::service(name = "cost", tables = "tables")]
pub mod service {
    use crate::tables::{Asset, Manager};
    use psibase::{
        services::{
            nft::NID,
            tokens::{Quantity, TID},
        },
        *,
    };

    #[action]
    fn set_is_mark(manager: NID, id: AccountNumber, is_on_market: bool) {
        Asset::get_assert(manager, id).set_is_on_market(is_on_market);
    }

    #[action]
    fn set_valuation(manager: NID, id: AccountNumber, price: Quantity) {
        Asset::get_assert(manager, id).set_valuation(price);
    }

    #[action]
    fn set_pay_acc(manager: NID, payout_account: AccountNumber) {
        Manager::get_assert(manager).set_payout_account(payout_account);
    }

    #[action]
    fn tax(manager: NID, id: AccountNumber) {
        Asset::get_assert(manager, id).commit_bill();
    }

    #[action]
    fn tax_many(manager: NID, from: u64, amount: u16) {
        Asset::bill_many(manager, from, amount);
    }

    #[action]
    fn new_asset(
        nft_manager: NID,
        id: AccountNumber,
        token_id: TID,
        tax_rate: u32,
        valuation: Quantity,
    ) -> u32 {
        Asset::add(nft_manager, id, token_id, tax_rate, valuation).nft_id
    }

    #[action]
    fn purchase(manager: NID, id: AccountNumber) {
        Asset::get_assert(manager, id).purchase();
    }

    #[action]
    fn top_up(manager: NID, id: AccountNumber, amount: Quantity) {
        Asset::get_assert(manager, id).top_up_owner_account(amount);
    }

    #[action]
    fn get_asset(manager: NID, id: AccountNumber) -> Option<Asset> {
        Asset::get(manager, id)
    }

    #[action]
    fn get_by_nft(nft_id: u32) -> Option<Asset> {
        Asset::get_by_nft(nft_id)
    }
}

#[cfg(test)]
mod tests;
