#[psibase::service(name = "banx+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use banx::tables::{
        Asset, AssetTable, ClearingOffer, ClearingOfferTab, CreditLine, CreditLineTable,
        CurrencyPolicy, CurrencyPolicyTab, Obligation, ObligationTable, PPM_SCALE, RATE_SCALE,
    };
    use psibase::services::tokens::{Decimal, Precision, Quantity};
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;

    fn time_sec(t: TimePointSec) -> i64 {
        t.seconds as i64
    }

    fn asset_precision(id: u16) -> Precision {
        Asset::get(id)
            .map(|a| a.precision)
            .unwrap_or_else(|| Precision::new(0).expect("precision 0"))
    }

    /// Human decimal for an asset quantity (GraphQL `Decimal` scalar).
    fn dec(q: Quantity, asset_id: u16) -> Decimal {
        Decimal::new(q, asset_precision(asset_id))
    }

    fn dec_raw(raw: u64, asset_id: u16) -> Decimal {
        dec(Quantity::new(raw), asset_id)
    }

    #[derive(SimpleObject, Clone)]
    struct AssetView {
        id: u16,
        /// GraphQL `AccountNumber` scalar (string on the wire).
        symbol: AccountNumber,
        precision: u8,
        description: String,
    }

    impl From<Asset> for AssetView {
        fn from(a: Asset) -> Self {
            Self {
                id: a.id,
                symbol: a.symbol,
                precision: a.precision.value(),
                description: a.description.to_string(),
            }
        }
    }

    #[derive(SimpleObject)]
    struct CreditLineView {
        creditor: AccountNumber,
        debtor: AccountNumber,
        assetId: u16,
        limit: Decimal,
        depleteOnDebit: bool,
        interestRatePpm: u32,
        /// Outstanding principal + interest for this directed pair/asset.
        exposure: Decimal,
        /// Unused grant when depleting; 0 on revolving lines.
        remaining: Decimal,
        /// Drawable now: `limit - exposure`, also capped by `remaining` if depleting.
        residual: Decimal,
    }

    impl CreditLineView {
        fn from_line(line: CreditLine) -> Self {
            let exposure = Obligation::exposure(line.creditor, line.debtor, line.asset_id);
            Self {
                creditor: line.creditor,
                debtor: line.debtor,
                assetId: line.asset_id,
                limit: dec(line.limit, line.asset_id),
                depleteOnDebit: line.deplete_on_debit,
                interestRatePpm: line.interest_rate,
                exposure: dec(exposure, line.asset_id),
                remaining: dec(line.remaining, line.asset_id),
                residual: dec(Quantity::new(line.draw_headroom()), line.asset_id),
            }
        }
    }

    #[derive(SimpleObject)]
    struct ObligationView {
        id: u32,
        creditor: AccountNumber,
        debtor: AccountNumber,
        assetId: u16,
        remainingPrincipal: Decimal,
        accruedInterest: Decimal,
        interestRatePpm: u32,
        createdAt: i64,
        lastInterestAccrual: i64,
    }

    impl From<Obligation> for ObligationView {
        fn from(o: Obligation) -> Self {
            Self {
                id: o.id,
                creditor: o.creditor,
                debtor: o.debtor,
                assetId: o.asset_id,
                remainingPrincipal: dec(o.remaining_principal, o.asset_id),
                accruedInterest: dec(o.live_accrued(), o.asset_id),
                interestRatePpm: o.interest_rate,
                createdAt: time_sec(o.created_at),
                lastInterestAccrual: time_sec(o.last_interest_accrual),
            }
        }
    }

    #[derive(SimpleObject)]
    struct ClearingOfferView {
        poster: AccountNumber,
        /// `0` / empty when global.
        counterparty: AccountNumber,
        assetId: u16,
        feeFixed: Decimal,
        feePercentPpm: u32,
        maxLineAprPpm: u32,
        forwardEnabled: bool,
        expiresAt: i64,
        isGlobal: bool,
    }

    impl From<ClearingOffer> for ClearingOfferView {
        fn from(p: ClearingOffer) -> Self {
            let is_global = p.is_global();
            Self {
                poster: p.poster,
                counterparty: p.counterparty,
                assetId: p.asset_id,
                feeFixed: dec(p.fee_fixed, p.asset_id),
                feePercentPpm: p.fee_percent,
                maxLineAprPpm: p.max_line_apr,
                forwardEnabled: p.forward_enabled,
                expiresAt: time_sec(p.expires_at),
                isGlobal: is_global,
            }
        }
    }

    #[derive(SimpleObject)]
    struct CurrencyPolicyView {
        debtor: AccountNumber,
        fromAsset: u16,
        toAsset: u16,
        /// Fixed fee in **from** asset units (human decimal).
        feeFixed: Decimal,
        /// Chain `fx_rate` (RATE_SCALE fixed-point), not an asset amount.
        fxRate: String,
        toInterestRatePpm: u32,
        expiresAt: i64,
    }

    impl From<CurrencyPolicy> for CurrencyPolicyView {
        fn from(p: CurrencyPolicy) -> Self {
            Self {
                debtor: p.debtor,
                fromAsset: p.from_asset,
                toAsset: p.to_asset,
                feeFixed: dec(p.fee_fixed, p.from_asset),
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

    /// Scoped subgraph for path discovery between two accounts.
    #[derive(SimpleObject)]
    struct PathGraphView {
        /// Accounts discovered while expanding from `from` (includes `from` / `to`).
        accounts: Vec<AccountNumber>,
        creditLines: Vec<CreditLineView>,
        clearingOffers: Vec<ClearingOfferView>,
        currencyPolicies: Vec<CurrencyPolicyView>,
    }

    /// History row from `history.banx.activity` (amounts stored raw on-chain).
    #[derive(Deserialize, SimpleObject)]
    #[graphql(complex)]
    struct ActivityEvent {
        account: AccountNumber,
        counterparty: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        asset_id: u16,
        kind: String,
        #[graphql(skip)]
        amount: String,
        #[graphql(skip)]
        netted: String,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        other_asset_id: u16,
        actor: AccountNumber,
    }

    #[ComplexObject]
    impl ActivityEvent {
        async fn amount(&self) -> Decimal {
            let raw = self.amount.parse::<u64>().unwrap_or(0);
            dec_raw(raw, self.asset_id)
        }

        async fn netted(&self) -> Decimal {
            let raw = self.netted.parse::<u64>().unwrap_or(0);
            dec_raw(raw, self.asset_id)
        }
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
        /// `limit` / `exposure` are human decimals for the line's asset.
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
        /// Principal / interest are human decimals for the obligation's asset.
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

        /// Pair exposure: what `debtor` owes `creditor` in `assetId`
        /// (principal + live interest). Human decimal for that asset.
        async fn exposure(
            &self,
            creditor: AccountNumber,
            debtor: AccountNumber,
            assetId: u16,
        ) -> Decimal {
            dec(Obligation::exposure(creditor, debtor, assetId), assetId)
        }

        /// Clearing offers posted by `poster` (global + specific counterparties).
        async fn clearingOffers(&self, poster: AccountNumber) -> Vec<ClearingOfferView> {
            ClearingOfferTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.poster == poster)
                .map(ClearingOfferView::from)
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

        /// Scoped credit/routing/FX snapshot for path discovery between `from` and `to`.
        ///
        /// Expands along credit lines up to `maxHops` from `from` (debtors → creditors),
        /// always including `to`. Does **not** dump the full network graph.
        /// Amount fields are human decimals for their asset.
        async fn pathGraph(
            &self,
            from: AccountNumber,
            to: AccountNumber,
            maxHops: Option<u8>,
        ) -> PathGraphView {
            let max_hops = maxHops.unwrap_or(6).clamp(1, 12) as usize;
            use std::collections::HashSet;

            let all_lines: Vec<CreditLine> = CreditLineTable::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .collect();

            let mut debtors: HashSet<AccountNumber> = HashSet::new();
            debtors.insert(from);
            debtors.insert(to);

            let mut selected_lines: Vec<CreditLine> = Vec::new();
            let mut seen_line: HashSet<(AccountNumber, AccountNumber, u16)> = HashSet::new();

            for _ in 0..max_hops {
                let frontier: HashSet<AccountNumber> = debtors.clone();
                let mut grew = false;
                for line in &all_lines {
                    if !frontier.contains(&line.debtor) {
                        continue;
                    }
                    let key = (line.creditor, line.debtor, line.asset_id);
                    if !seen_line.insert(key) {
                        continue;
                    }
                    selected_lines.push(line.clone());
                    if debtors.insert(line.creditor) {
                        grew = true;
                    }
                }
                if !grew {
                    break;
                }
            }

            let credit_lines: Vec<CreditLineView> = selected_lines
                .into_iter()
                .map(CreditLineView::from_line)
                .collect();

            let clearing_offers: Vec<ClearingOfferView> =
                ClearingOfferTab::with_service(banx::SERVICE)
                    .get_index_pk()
                    .iter()
                    .filter(|p| debtors.contains(&p.poster))
                    .map(ClearingOfferView::from)
                    .collect();

            let currency_policies: Vec<CurrencyPolicyView> =
                CurrencyPolicyTab::with_service(banx::SERVICE)
                    .get_index_pk()
                    .iter()
                    .filter(|p| debtors.contains(&p.debtor))
                    .map(CurrencyPolicyView::from)
                    .collect();

            let accounts = debtors.into_iter().collect();

            PathGraphView {
                accounts,
                creditLines: credit_lines,
                clearingOffers: clearing_offers,
                currencyPolicies: currency_policies,
            }
        }

        /// Activity history for `account` with a given `counterparty` and `assetId`.
        /// Newest first (`last`). Amounts are human decimals.
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
