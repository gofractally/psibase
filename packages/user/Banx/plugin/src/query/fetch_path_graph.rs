use crate::bindings::host::common::server;
use crate::errors::ErrorType;
use banx::path_find::{FxEdge, LineEdge, RoutingEdge};
use psibase::AccountNumber;
use psibase::services::tokens::Decimal;
use serde::Deserialize;

#[derive(Deserialize)]
struct Response {
    data: Data,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    path_graph: PathGraph,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathGraph {
    credit_lines: Vec<GqlCreditLine>,
    forward_offers: Vec<GqlForward>,
    currency_policies: Vec<GqlCurrency>,
    now: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlCreditLine {
    creditor: AccountNumber,
    debtor: AccountNumber,
    asset_id: u16,
    residual: Decimal,
    reverse_claim: Decimal,
    exposure: Decimal,
    interest_rate_ppm: u32,
    is_line: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlForward {
    poster: AccountNumber,
    next_hop: AccountNumber,
    asset_id: u16,
    fee_fixed: Decimal,
    fee_percent_ppm: u32,
    max_line_apr_ppm: u32,
    expires_at: i64,
    allow_unknown: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlCurrency {
    poster: AccountNumber,
    from_asset: u16,
    to_asset: u16,
    fee_fixed: Decimal,
    /// Chain RATE_SCALE fixed-point (not an asset amount).
    fx_rate: String,
    expires_at: i64,
}

pub struct PathGraphSnapshot {
    pub lines: Vec<LineEdge>,
    pub routing: Vec<RoutingEdge>,
    pub fx: Vec<FxEdge>,
    pub now: i64,
}

fn parse_u64(s: &str) -> Result<u64, ErrorType> {
    s.parse::<u64>()
        .map_err(|e| ErrorType::QueryError(format!("invalid u64 {s}: {e}")))
}

fn parse_acct(name: &str) -> Result<AccountNumber, ErrorType> {
    name.parse::<AccountNumber>()
        .map_err(|_| ErrorType::InvalidAccount(name.to_string()))
}

/// Scoped path graph: credit lines / routing / FX expanded from `from` toward `to`.
pub fn fetch_path_graph(
    from: &str,
    to: &str,
    max_hops: u8,
) -> Result<PathGraphSnapshot, ErrorType> {
    let from = parse_acct(from)?.to_string();
    let to = parse_acct(to)?.to_string();
    let query = format!(
        r#"query {{
            pathGraph(from: "{from}", to: "{to}", maxHops: {max_hops}) {{
                now
                creditLines {{
                    creditor debtor assetId residual reverseClaim exposure interestRatePpm isLine
                }}
                forwardOffers {{
                    poster nextHop assetId feeFixed feePercentPpm maxLineAprPpm
                    expiresAt allowUnknown
                }}
                currencyPolicies {{
                    poster fromAsset toAsset feeFixed fxRate expiresAt
                }}
            }}
        }}"#
    );

    let result =
        server::post_graphql_get_json(&query).map_err(|e| ErrorType::QueryError(e.message))?;

    let response: Response =
        serde_json::from_str(&result).map_err(|e| ErrorType::QueryError(e.to_string()))?;

    let g = response.data.path_graph;

    let mut lines = Vec::with_capacity(g.credit_lines.len());
    for l in g.credit_lines {
        let residual = l.residual.quantity.value;
        lines.push(LineEdge {
            creditor: l.creditor.to_string(),
            debtor: l.debtor.to_string(),
            asset_id: l.asset_id,
            residual,
            reverse_claim: l.reverse_claim.quantity.value,
            exposure: l.exposure.quantity.value,
            interest_rate_ppm: l.interest_rate_ppm,
            is_line: l.is_line,
        });
    }

    let mut routing = Vec::with_capacity(g.forward_offers.len());
    for r in g.forward_offers {
        // path_find: empty creditor = global next hop
        let creditor = if r.next_hop.value == 0 {
            String::new()
        } else {
            r.next_hop.to_string()
        };
        routing.push(RoutingEdge {
            creditor,
            debtor: r.poster.to_string(),
            asset_id: r.asset_id,
            hop_fee_fixed: r.fee_fixed.quantity.value,
            hop_fee_percent_ppm: r.fee_percent_ppm,
            max_accept_rate_ppm: r.max_line_apr_ppm,
            expires_at: r.expires_at,
            allow_unknown: r.allow_unknown,
        });
    }

    let mut fx = Vec::with_capacity(g.currency_policies.len());
    for c in g.currency_policies {
        fx.push(FxEdge {
            poster: c.poster.to_string(),
            from_asset: c.from_asset,
            to_asset: c.to_asset,
            fee_fixed: c.fee_fixed.quantity.value,
            fx_rate: parse_u64(&c.fx_rate)?,
            expires_at: c.expires_at,
        });
    }

    Ok(PathGraphSnapshot {
        lines,
        routing,
        fx,
        now: g.now,
    })
}
