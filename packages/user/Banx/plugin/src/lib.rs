#[allow(warnings)]
mod bindings;

use bindings::banx::plugin::types::PathHopQuote as WitPathHopQuote;
use bindings::exports::banx::plugin::api::{
    CreatedInvite, Guest as Api, PathHop as WitPathHop, PathQuote,
};
use bindings::exports::banx::plugin::helpers::Guest as Helpers;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use banx::path_find::{find_banx_path, find_banx_path_exact_out};
use psibase::define_trust;
use psibase::fracpack::Pack;
use psibase::services::tokens::{Decimal, Precision, Quantity};
use psibase::{AccountNumber, Memo, TimePointSec};

mod errors;
use errors::ErrorType;

mod query {
    pub mod fetch_asset;
    pub mod fetch_path_graph;
}

define_trust! {
    descriptions {
        Low => "
            - Convert amounts using asset precision
            - Quote multi-hop paths (read-only GraphQL + search)
        ",
        Medium => "
            - Post or remove credit lines, book-auths, forward offers, claim offers, and currency policies
            - Deposit, book an authorized expense, net, and forgive (write off) obligations
            - Create or cancel invoices and please-book requests
            - Convert debt between assets
            - Buy or sell claims under a posted claim offer
            - Post cash quotes, fund/withdraw the cash vault, cash_in (from your vault)
            - Create or revoke Banx invites (onboard + extend a credit line, one claimee)
            - Register a new asset
        ",
        High => "
            - Path-pay (draw on others' credit along a path)
            - Pay an invoice along a path (max spend)
            - cash_out (draw Banx, receive tokens)
        ",
    }
    functions {
        None => [decimal_to_quantity, quantity_to_decimal],
        Low => [quote_path],
        Medium => [
            set_credit_line,
            remove_credit_line,
            set_book_auth,
            remove_book_auth,
            book,
            set_forward_offer,
            set_global_forward_offer,
            remove_forward_offer,
            remove_global_forward_offer,
            set_buy_claim_offer,
            set_global_buy_claim_offer,
            set_allow_unknown,
            remove_buy_claim_offer,
            remove_global_buy_claim_offer,
            set_sell_claim_offer,
            set_global_sell_claim_offer,
            remove_sell_claim_offer,
            remove_global_sell_claim_offer,
            set_currency_policy,
            remove_currency_policy,
            create_request,
            cancel_request,
            deposit,
            net,
            forgive,
            convert,
            sell_claim,
            buy_claim,
            set_cash_quote,
            remove_cash_quote,
            cash_fund,
            cash_withdraw,
            cash_in,
            create_invite,
            delete_invite,
            add_asset,
        ],
        High => [path_pay, pay_inv, cash_out],
    }
}

struct BanxPlugin;

fn parse_account(name: &str) -> Result<AccountNumber, Error> {
    name.parse::<AccountNumber>()
        .map_err(|_| ErrorType::InvalidAccount(name.to_string()).into())
}

fn parse_account_or_zero(name: &str) -> Result<AccountNumber, Error> {
    match name.trim() {
        "" | "0" => Ok(AccountNumber::new(0)),
        other => parse_account(other),
    }
}

fn time_point(seconds: u32) -> TimePointSec {
    TimePointSec {
        seconds: seconds as i64,
    }
}

/// Parse a human decimal (`"1.45"`) into raw units using GraphQL asset precision.
fn parse_amount(asset_id: u16, amount: &str) -> Result<Quantity, Error> {
    let asset = query::fetch_asset::fetch_asset(asset_id)?;
    let precision = asset.precision()?;
    Quantity::from_str(amount, precision)
        .map_err(|e| ErrorType::ConversionError(e.to_string()).into())
}

fn parse_amount_nonzero(asset_id: u16, amount: &str) -> Result<Quantity, Error> {
    let q = parse_amount(asset_id, amount)?;
    if q.value == 0 {
        return Err(ErrorType::AmountIsZero().into());
    }
    Ok(q)
}

fn parse_token_amount(token_id: u32, amount: &str) -> Result<Quantity, Error> {
    let precision = query::fetch_asset::fetch_token_precision(token_id)?;
    Quantity::from_str(amount, precision)
        .map_err(|e| ErrorType::ConversionError(e.to_string()).into())
}

fn parse_token_amount_nonzero(token_id: u32, amount: &str) -> Result<Quantity, Error> {
    let q = parse_token_amount(token_id, amount)?;
    if q.value == 0 {
        return Err(ErrorType::AmountIsZero().into());
    }
    Ok(q)
}

fn human_to_fx_rate_precs(
    from_prec: psibase::services::tokens::Precision,
    to_prec: psibase::services::tokens::Precision,
    to_rate: &str,
) -> Result<u64, Error> {
    let to_for_one = Quantity::from_str(to_rate, to_prec)
        .map_err(|e| ErrorType::ConversionError(e.to_string()))?;
    if to_for_one.value == 0 {
        return Err(ErrorType::AmountIsZero().into());
    }
    let one_from = Quantity::from_str("1", from_prec)
        .map_err(|e| ErrorType::ConversionError(e.to_string()))?;
    let fx = (to_for_one.value as u128)
        .checked_mul(banx::tables::RATE_SCALE as u128)
        .ok_or_else(|| ErrorType::ConversionError("fx_rate overflow".into()))?
        / (one_from.value as u128);
    let fx =
        u64::try_from(fx).map_err(|_| ErrorType::ConversionError("fx_rate exceeds u64".into()))?;
    if fx == 0 {
        return Err(ErrorType::ConversionError(
            "to-rate too small for precisions (fx_rate rounds to 0)".into(),
        )
        .into());
    }
    Ok(fx)
}

/// Convert a human "to-asset per 1 from-asset" rate into chain `fx_rate`.
///
/// Example: `"0.45"` with USD→CAD means 1 USD → 0.45 CAD.
/// Chain formula: `to_raw = from_raw * fx_rate / RATE_SCALE`, so
/// `fx_rate = to_raw(to_rate) * RATE_SCALE / from_raw(1)`.
fn human_to_fx_rate(from_asset: u16, to_asset: u16, to_rate: &str) -> Result<u64, Error> {
    let to_for_one_from = parse_amount_nonzero(to_asset, to_rate)?;
    let one_from = parse_amount_nonzero(from_asset, "1")?;
    let fx = (to_for_one_from.value as u128)
        .checked_mul(banx::tables::RATE_SCALE as u128)
        .ok_or_else(|| ErrorType::ConversionError("fx_rate overflow".into()))?
        / (one_from.value as u128);
    let fx =
        u64::try_from(fx).map_err(|_| ErrorType::ConversionError("fx_rate exceeds u64".into()))?;
    if fx == 0 {
        return Err(ErrorType::ConversionError(
            "to-rate too small for asset precisions (fx_rate rounds to 0)".into(),
        )
        .into());
    }
    Ok(fx)
}

impl Helpers for BanxPlugin {
    fn decimal_to_quantity(asset_id: u16, amount: String) -> Result<u64, Error> {
        Ok(parse_amount(asset_id, &amount)?.value)
    }

    fn quantity_to_decimal(asset_id: u16, amount: u64) -> Result<String, Error> {
        let asset = query::fetch_asset::fetch_asset(asset_id)?;
        let precision = asset.precision()?;
        Ok(Decimal::new(Quantity::new(amount), precision).to_string())
    }
}

impl Api for BanxPlugin {
    fn set_credit_line(
        debtor: String,
        asset_id: u16,
        limit: String,
        deplete_on_debit: bool,
        interest_rate_ppm: u32,
        grace_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_credit_line)?;
        let amount = parse_amount(asset_id, &limit)?;
        let packed = banx::action_structs::st_crd_lne {
            debitor: parse_account(&debtor)?,
            asset_id,
            amount,
            deplete_on_debit,
            interest_rate: interest_rate_ppm,
            grace_seconds,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_crd_lne::ACTION_NAME, &packed)
    }

    fn remove_credit_line(debtor: String, asset_id: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_credit_line)?;
        let packed = banx::action_structs::rm_crd_lne {
            debitor: parse_account(&debtor)?,
            asset_id,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::rm_crd_lne::ACTION_NAME, &packed)
    }

    fn set_book_auth(
        creditor: String,
        asset_id: u16,
        remaining: String,
        max_interest_rate_ppm: u32,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_book_auth)?;
        let remaining = parse_amount_nonzero(asset_id, &remaining)?;
        let packed = banx::action_structs::st_bk_ath {
            creditor: parse_account(&creditor)?,
            asset_id,
            remaining,
            max_interest_rate: max_interest_rate_ppm,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_bk_ath::ACTION_NAME, &packed)
    }

    fn remove_book_auth(creditor: String, asset_id: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_book_auth)?;
        let packed = banx::action_structs::rm_bk_ath {
            creditor: parse_account(&creditor)?,
            asset_id,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::rm_bk_ath::ACTION_NAME, &packed)
    }

    fn book(
        debtor: String,
        asset_id: u16,
        amount: String,
        interest_rate_ppm: i32,
        memo: String,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::book)?;
        let amount = parse_amount_nonzero(asset_id, &amount)?;
        let packed = banx::action_structs::book {
            debtor: parse_account(&debtor)?,
            asset_id,
            amount,
            interest_rate: interest_rate_ppm,
            memo: memo
                .parse()
                .map_err(|_| ErrorType::ConversionError("memo too long (max 80 bytes)".into()))?,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::book::ACTION_NAME, &packed)
    }

    fn set_forward_offer(
        next_hop: String,
        asset_id: u16,
        fee_fixed: String,
        fee_percent_ppm: u32,
        max_line_apr_ppm: u32,
        expires_at_seconds: u32,
        allow_unknown: bool,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_forward_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let packed = banx::action_structs::st_fwd_ofr {
            next_hop: parse_account(&next_hop)?,
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
            max_line_apr: max_line_apr_ppm,
            expires_at: time_point(expires_at_seconds),
            allow_unknown,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_fwd_ofr::ACTION_NAME, &packed)
    }

    fn set_global_forward_offer(
        asset_id: u16,
        fee_fixed: String,
        fee_percent_ppm: u32,
        max_line_apr_ppm: u32,
        expires_at_seconds: u32,
        allow_unknown: bool,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_global_forward_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let packed = banx::action_structs::st_glb_fwd {
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
            max_line_apr: max_line_apr_ppm,
            expires_at: time_point(expires_at_seconds),
            allow_unknown,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_glb_fwd::ACTION_NAME, &packed)
    }

    fn remove_forward_offer(next_hop: String, asset_id: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_forward_offer)?;
        let packed = banx::action_structs::rm_fwd_ofr {
            next_hop: parse_account(&next_hop)?,
            asset_id,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::rm_fwd_ofr::ACTION_NAME, &packed)
    }

    fn remove_global_forward_offer(asset_id: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_global_forward_offer)?;
        let packed = banx::action_structs::rm_glb_fwd { asset_id }.packed();
        add_action_to_transaction(banx::action_structs::rm_glb_fwd::ACTION_NAME, &packed)
    }

    fn set_buy_claim_offer(
        debtor: String,
        asset_id: u16,
        fee_fixed: String,
        fee_percent_ppm: i32,
        remaining: String,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_buy_claim_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let remaining = parse_amount(asset_id, &remaining)?;
        let packed = banx::action_structs::st_buy_clm {
            debtor: parse_account(&debtor)?,
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
            remaining,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_buy_clm::ACTION_NAME, &packed)
    }

    fn set_global_buy_claim_offer(
        asset_id: u16,
        fee_fixed: String,
        fee_percent_ppm: i32,
        remaining: String,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_global_buy_claim_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let remaining = parse_amount(asset_id, &remaining)?;
        let packed = banx::action_structs::st_glb_buy {
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
            remaining,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_glb_buy::ACTION_NAME, &packed)
    }

    fn set_allow_unknown(
        next_hop: String,
        asset_id: u16,
        allow_unknown: bool,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_allow_unknown)?;
        let next_hop = match next_hop.trim() {
            "" | "0" => AccountNumber::new(0),
            name => parse_account(name)?,
        };
        let packed = banx::action_structs::st_fwd_unk {
            next_hop,
            asset_id,
            allow_unknown,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_fwd_unk::ACTION_NAME, &packed)
    }

    fn remove_buy_claim_offer(debtor: String, asset_id: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_buy_claim_offer)?;
        let packed = banx::action_structs::rm_buy_clm {
            debtor: parse_account(&debtor)?,
            asset_id,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::rm_buy_clm::ACTION_NAME, &packed)
    }

    fn remove_global_buy_claim_offer(asset_id: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_global_buy_claim_offer)?;
        let packed = banx::action_structs::rm_glb_buy { asset_id }.packed();
        add_action_to_transaction(banx::action_structs::rm_glb_buy::ACTION_NAME, &packed)
    }

    fn sell_claim(
        buyer: String,
        debtor: String,
        asset_id: u16,
        amount: String,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::sell_claim)?;
        let amount = parse_amount_nonzero(asset_id, &amount)?;
        let packed = banx::action_structs::sell_claim {
            buyer: parse_account(&buyer)?,
            debtor: parse_account(&debtor)?,
            asset_id,
            amount,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::sell_claim::ACTION_NAME, &packed)
    }

    fn set_sell_claim_offer(
        debtor: String,
        asset_id: u16,
        fee_fixed: String,
        fee_percent_ppm: i32,
        remaining: String,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_sell_claim_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let remaining = parse_amount(asset_id, &remaining)?;
        let packed = banx::action_structs::st_sell_clm {
            debtor: parse_account(&debtor)?,
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
            remaining,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_sell_clm::ACTION_NAME, &packed)
    }

    fn set_global_sell_claim_offer(
        asset_id: u16,
        fee_fixed: String,
        fee_percent_ppm: i32,
        remaining: String,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_global_sell_claim_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let remaining = parse_amount(asset_id, &remaining)?;
        let packed = banx::action_structs::st_glb_sell {
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
            remaining,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_glb_sell::ACTION_NAME, &packed)
    }

    fn remove_sell_claim_offer(debtor: String, asset_id: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_sell_claim_offer)?;
        let packed = banx::action_structs::rm_sell_clm {
            debtor: parse_account(&debtor)?,
            asset_id,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::rm_sell_clm::ACTION_NAME, &packed)
    }

    fn remove_global_sell_claim_offer(asset_id: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_global_sell_claim_offer)?;
        let packed = banx::action_structs::rm_glb_sell { asset_id }.packed();
        add_action_to_transaction(banx::action_structs::rm_glb_sell::ACTION_NAME, &packed)
    }

    fn buy_claim(
        seller: String,
        debtor: String,
        asset_id: u16,
        amount: String,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::buy_claim)?;
        let amount = parse_amount_nonzero(asset_id, &amount)?;
        let packed = banx::action_structs::buy_claim {
            seller: parse_account(&seller)?,
            debtor: parse_account(&debtor)?,
            asset_id,
            amount,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::buy_claim::ACTION_NAME, &packed)
    }

    fn set_currency_policy(
        from_asset: u16,
        to_asset: u16,
        fee_fixed: String,
        to_rate: String,
        to_interest_rate_ppm: u32,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_currency_policy)?;
        let fee_fixed = parse_amount(from_asset, &fee_fixed)?;
        let fx_rate = human_to_fx_rate(from_asset, to_asset, &to_rate)?;
        let packed = banx::action_structs::st_cur_pol {
            from_asset,
            to_asset,
            fee_fixed,
            fx_rate,
            to_interest_rate: to_interest_rate_ppm,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_cur_pol::ACTION_NAME, &packed)
    }

    fn remove_currency_policy(from_asset: u16, to_asset: u16) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_currency_policy)?;
        let packed = banx::action_structs::rm_cur_pol {
            from_asset,
            to_asset,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::rm_cur_pol::ACTION_NAME, &packed)
    }

    fn create_request(
        kind: u8,
        counterparty: String,
        asset_id: u16,
        amount: String,
        memo: String,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::create_request)?;
        let amount = parse_amount_nonzero(asset_id, &amount)?;
        let packed = banx::action_structs::st_req {
            kind,
            counterparty: parse_account_or_zero(&counterparty)?,
            asset_id,
            amount,
            memo: memo
                .parse()
                .map_err(|_| ErrorType::ConversionError("memo too long (max 80 bytes)".into()))?,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_req::ACTION_NAME, &packed)
    }

    fn cancel_request(id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::cancel_request)?;
        let packed = banx::action_structs::rm_req { id }.packed();
        add_action_to_transaction(banx::action_structs::rm_req::ACTION_NAME, &packed)
    }

    fn deposit(
        depositor: String,
        asset_id: u16,
        amount: String,
        interest_rate_ppm: u32,
        request_id: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::deposit)?;
        let amount = parse_amount_nonzero(asset_id, &amount)?;
        let packed = banx::action_structs::deposit {
            depositor: parse_account(&depositor)?,
            asset_id,
            amount,
            interest_rate: interest_rate_ppm,
            request_id,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::deposit::ACTION_NAME, &packed)
    }

    fn net(counterparty: String, asset_id: u16, max_amount: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::net)?;
        let max_amount = parse_amount(asset_id, &max_amount)?;
        let packed = banx::action_structs::net {
            counterparty: parse_account(&counterparty)?,
            asset_id,
            max_amount,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::net::ACTION_NAME, &packed)
    }

    fn forgive(debtor: String, asset_id: u16, amount: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::forgive)?;
        let amount = parse_amount_nonzero(asset_id, &amount)?;
        let packed = banx::action_structs::forgive {
            debtor: parse_account(&debtor)?,
            asset_id,
            amount,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::forgive::ACTION_NAME, &packed)
    }

    fn convert(
        counterparty: String,
        from_asset: u16,
        to_asset: u16,
        amount_from: String,
        min_to: String,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::convert)?;
        let amount_from = parse_amount_nonzero(from_asset, &amount_from)?;
        let min_to = parse_amount(to_asset, &min_to)?;
        let packed = banx::action_structs::convert {
            counterparty: parse_account(&counterparty)?,
            from_asset,
            to_asset,
            amount_from,
            min_to,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::convert::ACTION_NAME, &packed)
    }

    fn path_pay(
        hops: Vec<WitPathHop>,
        amount: String,
        min_return: String,
        request_id: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::path_pay)?;
        if hops.is_empty() {
            return Err(
                ErrorType::ConversionError("path must have at least one hop".into()).into(),
            );
        }
        let first_asset = hops[0].asset_id;
        let last_asset = hops[hops.len() - 1].asset_id;
        let amount = parse_amount_nonzero(first_asset, &amount)?;
        let min_return = parse_amount(last_asset, &min_return)?;

        let mut path = Vec::with_capacity(hops.len());
        for h in hops {
            path.push(banx::tables::PathHop {
                account: parse_account(&h.account)?,
                asset_id: h.asset_id,
            });
        }
        let packed = banx::action_structs::path_pay {
            hops: path,
            amount,
            min_return,
            request_id,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::path_pay::ACTION_NAME, &packed)
    }

    fn pay_inv(hops: Vec<WitPathHop>, max_spend: String, request_id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::pay_inv)?;
        if hops.is_empty() {
            return Err(
                ErrorType::ConversionError("path must have at least one hop".into()).into(),
            );
        }
        if request_id == 0 {
            return Err(ErrorType::ConversionError("pay_inv requires an invoice".into()).into());
        }
        let first_asset = hops[0].asset_id;
        let max_spend = parse_amount_nonzero(first_asset, &max_spend)?;
        let mut path = Vec::with_capacity(hops.len());
        for h in hops {
            path.push(banx::tables::PathHop {
                account: parse_account(&h.account)?,
                asset_id: h.asset_id,
            });
        }
        let packed = banx::action_structs::pay_inv {
            hops: path,
            max_spend,
            request_id,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::pay_inv::ACTION_NAME, &packed)
    }

    fn quote_path(
        from_account: String,
        to_account: String,
        amount: String,
        from_asset: u16,
        to_asset: Option<u16>,
        max_hops: u8,
        exact_out: bool,
    ) -> Result<PathQuote, Error> {
        trust::assert_authorized(trust::FunctionName::quote_path)?;
        let from = from_account.trim();
        let to = to_account.trim();
        if from.is_empty() || to.is_empty() {
            return Err(ErrorType::InvalidAccount("from/to required".into()).into());
        }
        let from = parse_account(from)?;
        let to = parse_account(to)?;
        if from == to {
            return Err(ErrorType::NoPath("from and to are the same account".into()).into());
        }
        let max_hops = max_hops.clamp(1, 12);

        // Exact-out: amount is desired receive (to-asset). Exact-in: amount is send (from-asset).
        let amount_raw = if exact_out {
            let Some(to_a) = to_asset else {
                return Err(
                    ErrorType::ConversionError("exact-out quote requires to-asset".into()).into(),
                );
            };
            parse_amount_nonzero(to_a, &amount)?
        } else {
            parse_amount_nonzero(from_asset, &amount)?
        };

        let snap = query::fetch_path_graph::fetch_path_graph(from, to, max_hops)?;

        let quote = if exact_out {
            find_banx_path_exact_out(
                &snap.lines,
                &snap.routing,
                &snap.fx,
                from,
                to,
                amount_raw.value,
                from_asset,
                to_asset,
                max_hops,
                snap.now,
            )
        } else {
            find_banx_path(
                &snap.lines,
                &snap.routing,
                &snap.fx,
                from,
                to,
                amount_raw.value,
                from_asset,
                to_asset,
                max_hops,
                snap.now,
            )
        }
        .ok_or_else(|| {
            ErrorType::NoPath(if exact_out {
                format!(
                    "cannot deliver {amount} to {to} from {from} within {max_hops} hops \
                     (insufficient amount_out after fees, or no route)"
                )
            } else {
                format!(
                    "cannot send {amount} from {from} to {to} within {max_hops} hops \
                     (amount exceeds capacity after fees, or no route)"
                )
            })
        })?;

        let last_asset = quote.hops.last().map(|h| h.asset_id).unwrap_or(from_asset);
        let from_prec = query::fetch_asset::fetch_asset(from_asset)?.precision()?;
        let to_prec = query::fetch_asset::fetch_asset(last_asset)?.precision()?;
        let amount_in = Decimal::new(Quantity::new(quote.amount_in), from_prec).to_string();
        let amount_out = Decimal::new(Quantity::new(quote.amount_out), to_prec).to_string();
        // Exact-out: min-return is the requested receive amount; exact-in: amount_out.
        let min_return = if exact_out {
            Decimal::new(amount_raw, to_prec).to_string()
        } else {
            amount_out.clone()
        };

        let mut wit_hops = Vec::with_capacity(quote.hops.len());
        for h in quote.hops {
            let hop_prec = query::fetch_asset::fetch_asset(h.asset_id)?.precision()?;
            let amount = Decimal::new(Quantity::new(h.amount), hop_prec).to_string();
            let hop_fee = Decimal::new(Quantity::new(h.hop_fee), hop_prec).to_string();
            let fx_fee = if let Some(from_a) = h.fx_from_asset {
                let fx_prec = query::fetch_asset::fetch_asset(from_a)?.precision()?;
                Decimal::new(Quantity::new(h.fx_fee), fx_prec).to_string()
            } else {
                Decimal::new(Quantity::new(0), hop_prec).to_string()
            };
            wit_hops.push(WitPathHopQuote {
                account: h.account.to_string(),
                asset_id: h.asset_id,
                amount,
                hop_fee,
                fx_fee,
                fx_from_asset: h.fx_from_asset,
            });
        }

        Ok(PathQuote {
            hops: wit_hops,
            amount_in,
            amount_out,
            min_return,
        })
    }

    fn set_cash_quote(
        asset_id: u16,
        token_id: u32,
        is_out: bool,
        fee_fixed: String,
        to_rate: String,
        remaining: String,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_cash_quote)?;
        let token_prec = query::fetch_asset::fetch_token_precision(token_id)?;
        let asset = query::fetch_asset::fetch_asset(asset_id)?;
        let asset_prec = asset.precision()?;
        let (fee_fixed, fx_rate, remaining) = if is_out {
            (
                parse_amount(asset_id, &fee_fixed)?,
                human_to_fx_rate_precs(asset_prec, token_prec, &to_rate)?,
                parse_amount(asset_id, &remaining)?,
            )
        } else {
            (
                parse_token_amount(token_id, &fee_fixed)?,
                human_to_fx_rate_precs(token_prec, asset_prec, &to_rate)?,
                parse_token_amount(token_id, &remaining)?,
            )
        };
        let packed = banx::action_structs::st_csh_qte {
            asset_id,
            token_id,
            is_out,
            fee_fixed,
            fx_rate,
            remaining,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_csh_qte::ACTION_NAME, &packed)
    }

    fn remove_cash_quote(asset_id: u16, token_id: u32, is_out: bool) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::remove_cash_quote)?;
        let packed = banx::action_structs::rm_csh_qte {
            asset_id,
            token_id,
            is_out,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::rm_csh_qte::ACTION_NAME, &packed)
    }

    fn cash_fund(token_id: u32, amount: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::cash_fund)?;
        let amount = parse_token_amount_nonzero(token_id, &amount)?;
        let packed = banx::action_structs::csh_fund { token_id, amount }.packed();
        add_action_to_transaction(banx::action_structs::csh_fund::ACTION_NAME, &packed)
    }

    fn cash_withdraw(token_id: u32, amount: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::cash_withdraw)?;
        let amount = parse_token_amount_nonzero(token_id, &amount)?;
        let packed = banx::action_structs::csh_wd { token_id, amount }.packed();
        add_action_to_transaction(banx::action_structs::csh_wd::ACTION_NAME, &packed)
    }

    fn cash_out(
        cashier: String,
        asset_id: u16,
        token_id: u32,
        amount_banx: String,
        min_tokens: String,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::cash_out)?;
        let packed = banx::action_structs::cash_out {
            cashier: parse_account(&cashier)?,
            asset_id,
            token_id,
            amount_banx: parse_amount_nonzero(asset_id, &amount_banx)?,
            min_tokens: parse_token_amount(token_id, &min_tokens)?,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::cash_out::ACTION_NAME, &packed)
    }

    fn cash_in(
        cashier: String,
        asset_id: u16,
        token_id: u32,
        amount_tokens: String,
        min_banx: String,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::cash_in)?;
        let packed = banx::action_structs::cash_in {
            cashier: parse_account(&cashier)?,
            asset_id,
            token_id,
            amount_tokens: parse_token_amount_nonzero(token_id, &amount_tokens)?,
            min_banx: parse_amount(asset_id, &min_banx)?,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::cash_in::ACTION_NAME, &packed)
    }

    fn create_invite(
        asset_id: u16,
        limit: String,
        deplete_on_debit: bool,
        interest_rate_ppm: u32,
        grace_seconds: u32,
    ) -> Result<CreatedInvite, Error> {
        trust::assert_authorized(trust::FunctionName::create_invite)?;
        const NUM_ACCOUNTS: u16 = 1;
        let amount = parse_amount_nonzero(asset_id, &limit)?;
        let details = bindings::invite::plugin::inviter::prepare_new_invite(
            NUM_ACCOUNTS,
            &banx::SERVICE.to_string(),
        )?;
        let packed = banx::action_structs::cr_invite {
            invite_id: details.invite_id,
            invite_payload: details.payload,
            num_accounts: NUM_ACCOUNTS,
            asset_id,
            amount,
            deplete_on_debit,
            interest_rate: interest_rate_ppm,
            grace_seconds,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::cr_invite::ACTION_NAME, &packed)?;
        Ok(CreatedInvite {
            invite_token: details.invite_token,
            invite_id: details.invite_id,
        })
    }

    fn delete_invite(invite_id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::delete_invite)?;
        let packed = banx::action_structs::rm_invite { invite_id }.packed();
        add_action_to_transaction(banx::action_structs::rm_invite::ACTION_NAME, &packed)
    }

    fn add_asset(symbol: String, precision: u8, description: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::add_asset)?;
        let symbol = AccountNumber::from_exact(&symbol)
            .map_err(|_| ErrorType::InvalidAccount(symbol.clone()))?;
        if symbol == AccountNumber::new(0) {
            return Err(ErrorType::InvalidAccount("empty symbol".into()).into());
        }
        let precision =
            Precision::new(precision).map_err(|e| ErrorType::ConversionError(e.to_string()))?;
        let description = Memo::new(description)
            .map_err(|e| ErrorType::ConversionError(e.to_string()))?;
        let packed = banx::action_structs::add_asset {
            symbol,
            precision,
            description,
        }
        .packed();
        add_action_to_transaction(banx::action_structs::add_asset::ACTION_NAME, &packed)
    }
}

bindings::export!(BanxPlugin with_types_in bindings);
