#[allow(warnings)]
mod bindings;

use bindings::banx::plugin::types::PathHopQuote as WitPathHopQuote;
use bindings::exports::banx::plugin::api::{Guest as Api, PathHop as WitPathHop, PathQuote};
use bindings::exports::banx::plugin::helpers::Guest as Helpers;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use banx::path_find::{find_banx_path, find_banx_path_exact_out};
use psibase::define_trust;
use psibase::fracpack::Pack;
use psibase::services::tokens::{Decimal, Quantity};
use psibase::{AccountNumber, TimePointSec};

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
            - Post or remove credit lines, forward offers, claim offers, and currency policies
            - Deposit and net obligations
            - Create or cancel invoices, please-book, and settle-auth
            - Fulfill a settle-auth on a loan you owe
            - Convert debt between assets
            - Buy or sell claims under a posted claim offer
        ",
        High => "
            - Path-pay (draw on others' credit along a path)
            - Pay an invoice along a path (max spend)
        ",
    }
    functions {
        None => [decimal_to_quantity, quantity_to_decimal],
        Low => [quote_path],
        Medium => [
            set_credit_line,
            remove_credit_line,
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
            create_request,
            cancel_request,
            fulfill_settle,
            deposit,
            net,
            convert,
            sell_claim,
            buy_claim,
        ],
        High => [path_pay, pay_inv],
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
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_buy_claim_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let packed = banx::action_structs::st_buy_clm {
            debtor: parse_account(&debtor)?,
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_buy_clm::ACTION_NAME, &packed)
    }

    fn set_global_buy_claim_offer(
        asset_id: u16,
        fee_fixed: String,
        fee_percent_ppm: i32,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_global_buy_claim_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let packed = banx::action_structs::st_glb_buy {
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
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
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_sell_claim_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let packed = banx::action_structs::st_sell_clm {
            debtor: parse_account(&debtor)?,
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
            expires_at: time_point(expires_at_seconds),
        }
        .packed();
        add_action_to_transaction(banx::action_structs::st_sell_clm::ACTION_NAME, &packed)
    }

    fn set_global_sell_claim_offer(
        asset_id: u16,
        fee_fixed: String,
        fee_percent_ppm: i32,
        expires_at_seconds: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_global_sell_claim_offer)?;
        let fee_fixed = parse_amount(asset_id, &fee_fixed)?;
        let packed = banx::action_structs::st_glb_sell {
            asset_id,
            fee_fixed,
            fee_percent: fee_percent_ppm,
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

    fn fulfill_settle(request_id: u32, asset_id: u16, amount: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::fulfill_settle)?;
        let amount = parse_amount_nonzero(asset_id, &amount)?;
        let packed = banx::action_structs::fl_stl { request_id, amount }.packed();
        add_action_to_transaction(banx::action_structs::fl_stl::ACTION_NAME, &packed)
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
        let from = parse_account(from)?.to_string();
        let to = parse_account(to)?.to_string();
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

        let snap = query::fetch_path_graph::fetch_path_graph(&from, &to, max_hops)?;

        let quote = if exact_out {
            find_banx_path_exact_out(
                &snap.lines,
                &snap.routing,
                &snap.fx,
                &from,
                &to,
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
                &from,
                &to,
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
                account: h.account,
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
}

bindings::export!(BanxPlugin with_types_in bindings);
