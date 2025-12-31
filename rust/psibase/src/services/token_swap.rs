#![allow(non_snake_case)]

use crate::services::tokens::Quantity;
use crate::AccountNumber;

pub type SID = AccountNumber;

pub const PPM: u32 = 1_000_000;

pub fn swap(
    incoming_amount: Quantity,
    incoming_reserve: Quantity,
    outgoing_reserve: Quantity,
    fee_ppm: u32,
) -> Quantity {
    let incoming_amount = incoming_amount.value as u128;
    let incoming_reserve = incoming_reserve.value as u128;
    let outgoing_reserve = outgoing_reserve.value as u128;

    if incoming_amount == 0 || incoming_reserve == 0 || outgoing_reserve == 0 {
        return 0.into();
    }

    let incoming_after_fee = incoming_amount
        .checked_mul((PPM - fee_ppm) as u128)
        .and_then(|v| v.checked_div(PPM as u128))
        .unwrap_or(0);

    if incoming_after_fee == 0 {
        return 0.into();
    }

    let numerator = outgoing_reserve
        .checked_mul(incoming_after_fee)
        .expect("numerator overflow");

    let denominator = incoming_reserve
        .checked_add(incoming_after_fee)
        .expect("denominator overflow");

    let amount_out = numerator / denominator;

    (amount_out as u64).into()
}

#[crate::service(name = "token-swap", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod Service {
    use crate::services::nft::NID;
    use crate::services::tokens::Quantity;
    use crate::services::tokens::TID;

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn new_pool(
        token_a: TID,
        token_b: TID,
        token_a_amount: Quantity,
        token_b_amount: Quantity,
    ) -> (u32, NID, NID) {
        unimplemented!()
    }

    #[action]
    fn set_tarriff(pool_id: u32, token: TID, ppm: u32) {
        unimplemented!()
    }

    #[action]
    fn get_reserves(pool_id: u32) -> (Quantity, Quantity) {
        unimplemented!()
    }

    #[action]
    fn add_liquidity(
        pool_id: u32,
        amount_a_desired: Quantity,
        amount_b_desired: Quantity,
        amount_a_min: Quantity,
        amount_b_min: Quantity,
    ) {
        unimplemented!()
    }

    #[action]
    fn remove_liquidity(pool_id: u32, lp_amount: Quantity) {
        unimplemented!()
    }

    #[action]
    fn swap(pools: Vec<u32>, token_in: TID, amount_in: Quantity, min_return: Quantity) {
        unimplemented!()
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
