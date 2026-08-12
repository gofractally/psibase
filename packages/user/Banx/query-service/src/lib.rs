#[psibase::service(name = "banx+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use banx::tables::{
        Asset, AssetTable, CreditLine, CreditLineTable, CurrencyPolicy, CurrencyPolicyTab,
        Obligation, ObligationTable, RoutingPolicy, RoutingPolicyTab, PPM_SCALE, RATE_SCALE,
    };
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    fn qty(q: psibase::services::tokens::Quantity) -> String {
        q.value.to_string()
    }

    fn acct(a: AccountNumber) -> String {
        a.to_string()
    }

    fn time_sec(t: TimePointSec) -> i64 {
        t.seconds as i64
    }

    #[derive(SimpleObject, Clone)]
    struct AssetView {
        id: u16,
        symbol: String,
        precision: u8,
        description: String,
    }

    impl From<Asset> for AssetView {
        fn from(a: Asset) -> Self {
            Self {
                id: a.id,
                symbol: acct(a.symbol),
                precision: a.precision.value(),
                description: a.description.to_string(),
            }
        }
    }

    #[derive(SimpleObject, Clone)]
    struct CreditLineView {
        creditor: String,
        debtor: String,
        assetId: u16,
        limit: String,
        depleteOnDebit: bool,
        interestRatePpm: u32,
        /// Outstanding principal + interest for this directed pair/asset.
        exposure: String,
    }

    impl CreditLineView {
        fn from_line(line: CreditLine) -> Self {
            let exposure = Obligation::exposure(line.creditor, line.debtor, line.asset_id);
            Self {
                creditor: acct(line.creditor),
                debtor: acct(line.debtor),
                assetId: line.asset_id,
                limit: qty(line.limit),
                depleteOnDebit: line.deplete_on_debit,
                interestRatePpm: line.interest_rate,
                exposure: qty(exposure),
            }
        }
    }

    #[derive(SimpleObject, Clone)]
    struct ObligationView {
        id: u32,
        creditor: String,
        debtor: String,
        assetId: u16,
        remainingPrincipal: String,
        accruedInterest: String,
        interestRatePpm: u32,
        createdAt: i64,
        lastInterestAccrual: i64,
    }

    impl From<Obligation> for ObligationView {
        fn from(o: Obligation) -> Self {
            Self {
                id: o.id,
                creditor: acct(o.creditor),
                debtor: acct(o.debtor),
                assetId: o.asset_id,
                remainingPrincipal: qty(o.remaining_principal),
                accruedInterest: qty(o.accrued_interest),
                interestRatePpm: o.interest_rate,
                createdAt: time_sec(o.created_at),
                lastInterestAccrual: time_sec(o.last_interest_accrual),
            }
        }
    }

    #[derive(SimpleObject, Clone)]
    struct RoutingPolicyView {
        creditor: String,
        debtor: String,
        assetId: u16,
        hopFeeFixed: String,
        hopFeePercentPpm: u32,
        maxAcceptRatePpm: u32,
        expiresAt: i64,
    }

    impl From<RoutingPolicy> for RoutingPolicyView {
        fn from(p: RoutingPolicy) -> Self {
            Self {
                creditor: acct(p.creditor),
                debtor: acct(p.debtor),
                assetId: p.asset_id,
                hopFeeFixed: qty(p.hop_fee_fixed),
                hopFeePercentPpm: p.hop_fee_percent,
                maxAcceptRatePpm: p.max_accept_rate,
                expiresAt: time_sec(p.expires_at),
            }
        }
    }

    #[derive(SimpleObject, Clone)]
    struct CurrencyPolicyView {
        debtor: String,
        fromAsset: u16,
        toAsset: u16,
        feeFixed: String,
        fxRate: String,
        toInterestRatePpm: u32,
        expiresAt: i64,
    }

    impl From<CurrencyPolicy> for CurrencyPolicyView {
        fn from(p: CurrencyPolicy) -> Self {
            Self {
                debtor: acct(p.debtor),
                fromAsset: p.from_asset,
                toAsset: p.to_asset,
                feeFixed: qty(p.fee_fixed),
                fxRate: p.fx_rate.to_string(),
                toInterestRatePpm: p.to_interest_rate,
                expiresAt: time_sec(p.expires_at),
            }
        }
    }

    #[derive(SimpleObject, Clone)]
    struct ConstantsView {
        ppmScale: u32,
        rateScale: String,
    }

    /// History row from `history.banx.activity`.
    #[derive(Deserialize, SimpleObject)]
    struct ActivityEvent {
        account: AccountNumber,
        counterparty: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        asset_id: u16,
        kind: String,
        amount: String,
        netted: String,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        other_asset_id: u16,
        actor: AccountNumber,
    }

    struct Query;

    #[Object]
    impl Query {
        /// Fixed scales used by Banx rate math.
        async fn constants(&self) -> ConstantsView {
            ConstantsView {
                ppmScale: PPM_SCALE,
                rateScale: RATE_SCALE.to_string(),
            }
        }

        /// All registered assets.
        async fn assets(&self) -> Vec<AssetView> {
            AssetTable::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .map(AssetView::from)
                .collect()
        }

        async fn asset(&self, id: u16) -> Option<AssetView> {
            Asset::get(id).map(AssetView::from)
        }

        async fn assetBySymbol(&self, symbol: AccountNumber) -> Option<AssetView> {
            Asset::get_by_symbol(symbol).map(AssetView::from)
        }

        /// Credit lines where `account` is creditor and/or debtor.
        async fn creditLines(
            &self,
            account: AccountNumber,
            asCreditor: Option<bool>,
            asDebtor: Option<bool>,
        ) -> Vec<CreditLineView> {
            let want_creditor = asCreditor.unwrap_or(true);
            let want_debtor = asDebtor.unwrap_or(true);
            CreditLineTable::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|l| {
                    (want_creditor && l.creditor == account)
                        || (want_debtor && l.debtor == account)
                })
                .map(CreditLineView::from_line)
                .collect()
        }

        /// Obligations where `account` is creditor and/or debtor.
        async fn obligations(
            &self,
            account: AccountNumber,
            asCreditor: Option<bool>,
            asDebtor: Option<bool>,
        ) -> Vec<ObligationView> {
            let want_creditor = asCreditor.unwrap_or(true);
            let want_debtor = asDebtor.unwrap_or(true);
            ObligationTable::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|o| {
                    (want_creditor && o.creditor == account)
                        || (want_debtor && o.debtor == account)
                })
                .map(ObligationView::from)
                .collect()
        }

        /// Pair exposure: what `debtor` owes `creditor` in `assetId` (no accrue).
        async fn exposure(
            &self,
            creditor: AccountNumber,
            debtor: AccountNumber,
            assetId: u16,
        ) -> String {
            qty(Obligation::exposure(creditor, debtor, assetId))
        }

        /// Routing policies owned by `debtor` (path intermediate).
        async fn routingPolicies(&self, debtor: AccountNumber) -> Vec<RoutingPolicyView> {
            RoutingPolicyTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.debtor == debtor)
                .map(RoutingPolicyView::from)
                .collect()
        }

        /// Currency convert quotes posted by `debtor`.
        async fn currencyPolicies(&self, debtor: AccountNumber) -> Vec<CurrencyPolicyView> {
            CurrencyPolicyTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.debtor == debtor)
                .map(CurrencyPolicyView::from)
                .collect()
        }

        /// Activity history for `account` with a given `counterparty` and `assetId`.
        /// Newest first (`last`).
        async fn activity(
            &self,
            account: AccountNumber,
            counterparty: AccountNumber,
            assetId: u16,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<ActivityEvent>> {
            EventQuery::new("history.banx.activity")
                .condition_with_params(
                    "account = ? AND counterparty = ? AND asset_id = ?".to_string(),
                    vec![
                        account.to_string(),
                        counterparty.to_string(),
                        assetId.to_string(),
                    ],
                )
                .first(first)
                .last(last.or(Some(50)))
                .before(before)
                .after(after)
                .query()
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
