use crate::bindings::host::common::server;
use crate::errors::ErrorType;
use banx::path_find::{FxEdge, LineEdge, RoutingEdge};
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
    clearing_offers: Vec<GqlClearing>,
    currency_policies: Vec<GqlCurrency>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlCreditLine {
    creditor: String,
    debtor: String,
    asset_id: u16,
    limit: String,
    exposure: String,
    interest_rate_ppm: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlClearing {
    poster: String,
    counterparty: String,
    asset_id: u16,
    fee_fixed: String,
    fee_percent_ppm: u32,
    max_line_apr_ppm: u32,
    forward_enabled: bool,
    expires_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GqlCurrency {
    debtor: String,
    from_asset: u16,
    to_asset: u16,
    fee_fixed: String,
    fx_rate: String,
    expires_at: i64,
}

pub struct PathGraphSnapshot {
    pub lines: Vec<LineEdge>,
    pub routing: Vec<RoutingEdge>,
    pub fx: Vec<FxEdge>,
}

fn parse_u64(s: &str) -> Result<u64, ErrorType> {
    s.parse::<u64>()
        .map_err(|e| ErrorType::QueryError(format!("invalid u64 {s}: {e}")))
}

/// Scoped path graph: credit lines / routing / FX expanded from `from` toward `to`.
pub fn fetch_path_graph(
    from: &str,
    to: &str,
    max_hops: u8,
) -> Result<PathGraphSnapshot, ErrorType> {
    let query = format!(
        r#"query {{
            pathGraph(from: "{from}", to: "{to}", maxHops: {max_hops}) {{
                creditLines {{
                    creditor debtor assetId limit exposure interestRatePpm
                }}
                clearingOffers {{
                    poster counterparty assetId feeFixed feePercentPpm maxLineAprPpm forwardEnabled expiresAt
                }}
                currencyPolicies {{
                    debtor fromAsset toAsset feeFixed fxRate expiresAt
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
        let limit = parse_u64(&l.limit)?;
        let exposure = parse_u64(&l.exposure)?;
        let residual = limit.saturating_sub(exposure);
        lines.push(LineEdge {
            creditor: l.creditor,
            debtor: l.debtor,
            asset_id: l.asset_id,
            residual,
            interest_rate_ppm: l.interest_rate_ppm,
        });
    }

    let mut routing = Vec::with_capacity(g.clearing_offers.len());
    for r in g.clearing_offers {
        if !r.forward_enabled {
            continue;
        }
        // path_find RoutingEdge: creditor = next hop (empty = global), debtor = poster
        let creditor = if r.counterparty.is_empty() || r.counterparty == "0" {
            String::new()
        } else {
            r.counterparty
        };
        routing.push(RoutingEdge {
            creditor,
            debtor: r.poster,
            asset_id: r.asset_id,
            hop_fee_fixed: parse_u64(&r.fee_fixed)?,
            hop_fee_percent_ppm: r.fee_percent_ppm,
            max_accept_rate_ppm: r.max_line_apr_ppm,
            expires_at: r.expires_at,
        });
    }

    let mut fx = Vec::with_capacity(g.currency_policies.len());
    for c in g.currency_policies {
        fx.push(FxEdge {
            debtor: c.debtor,
            from_asset: c.from_asset,
            to_asset: c.to_asset,
            fee_fixed: parse_u64(&c.fee_fixed)?,
            fx_rate: parse_u64(&c.fx_rate)?,
            expires_at: c.expires_at,
        });
    }

    Ok(PathGraphSnapshot {
        lines,
        routing,
        fx,
    })
}
