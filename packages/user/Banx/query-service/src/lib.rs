#[psibase::service(name = "banx+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use banx::tables::{
        Asset, AssetTable, CreditLine, CreditLineTable, CurrencyPolicy, CurrencyPolicyTab,
        policy_is_live, ForwardOffer, ForwardOfferTab, Obligation, ObligationTable, PairCycle,
        PayRequest, PPM_SCALE, RATE_SCALE, RequestTab, BuyClaimOffer, BuyClaimOfferTab,
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
        /// Posted interest-free window (seconds) for the next cycle.
        graceSeconds: u32,
        /// When the open cycle started (`0` = none).
        cycleStartedAt: i64,
        /// Grace snapshotted at cycle open.
        cycleGraceSeconds: u32,
        /// Outstanding principal + interest for this directed pair/asset.
        exposure: Decimal,
        /// Unused grant when depleting; 0 on revolving lines.
        remaining: Decimal,
        /// Path residual: line headroom plus reverse claim (they already owe you).
        residual: Decimal,
        /// Reverse claim included in `residual` (they already owe you).
        reverseClaim: Decimal,
        /// False when this row is a reverse-claim-only path edge.
        isLine: bool,
    }

    impl CreditLineView {
        fn from_reverse_claim(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            residual: u64,
        ) -> Self {
            Self {
                creditor,
                debtor,
                assetId: asset_id,
                limit: dec(0.into(), asset_id),
                depleteOnDebit: false,
                interestRatePpm: 0,
                graceSeconds: 0,
                cycleStartedAt: 0,
                cycleGraceSeconds: 0,
                exposure: dec(0.into(), asset_id),
                remaining: dec(0.into(), asset_id),
                residual: dec(residual.into(), asset_id),
                reverseClaim: dec(residual.into(), asset_id),
                isLine: false,
            }
        }

        fn from_line(line: CreditLine) -> Self {
            let exposure = Obligation::exposure(line.creditor, line.debtor, line.asset_id);
            let reverse = Obligation::exposure(line.debtor, line.creditor, line.asset_id);
            let cycle = PairCycle::get(line.creditor, line.debtor, line.asset_id);
            Self {
                creditor: line.creditor,
                debtor: line.debtor,
                assetId: line.asset_id,
                limit: dec(line.limit, line.asset_id),
                depleteOnDebit: line.deplete_on_debit,
                interestRatePpm: line.interest_rate,
                graceSeconds: cycle.as_ref().map(|c| c.grace_seconds).unwrap_or(0),
                cycleStartedAt: cycle
                    .as_ref()
                    .map(|c| time_sec(c.cycle_started_at))
                    .unwrap_or(0),
                cycleGraceSeconds: cycle.as_ref().map(|c| c.cycle_grace_seconds).unwrap_or(0),
                exposure: dec(exposure, line.asset_id),
                remaining: dec(line.remaining, line.asset_id),
                residual: dec(
                    CreditLine::path_capacity_live(line.creditor, line.debtor, line.asset_id)
                        .into(),
                    line.asset_id,
                ),
                reverseClaim: dec(reverse, line.asset_id),
                isLine: true,
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
    struct ForwardOfferView {
        poster: AccountNumber,
        /// `0` / empty when global.
        nextHop: AccountNumber,
        assetId: u16,
        feeFixed: Decimal,
        feePercentPpm: u32,
        maxLineAprPpm: u32,
        expiresAt: i64,
        isGlobal: bool,
        allowUnknown: bool,
    }

    impl From<ForwardOffer> for ForwardOfferView {
        fn from(p: ForwardOffer) -> Self {
            Self {
                poster: p.poster,
                nextHop: p.next_hop,
                assetId: p.asset_id,
                feeFixed: dec(p.fee_fixed, p.asset_id),
                feePercentPpm: p.fee_percent,
                maxLineAprPpm: p.max_line_apr,
                expiresAt: time_sec(p.expires_at),
                isGlobal: p.is_global(),
                allowUnknown: p.allow_unknown,
            }
        }
    }

    #[derive(SimpleObject)]
    struct BuyClaimOfferView {
        poster: AccountNumber,
        /// `0` / empty when global.
        debtor: AccountNumber,
        assetId: u16,
        feeFixed: Decimal,
        feePercentPpm: i32,
        expiresAt: i64,
        isGlobal: bool,
    }

    impl From<BuyClaimOffer> for BuyClaimOfferView {
        fn from(p: BuyClaimOffer) -> Self {
            Self {
                poster: p.poster,
                debtor: p.debtor,
                assetId: p.asset_id,
                feeFixed: dec(p.fee_fixed, p.asset_id),
                feePercentPpm: p.fee_percent,
                expiresAt: time_sec(p.expires_at),
                isGlobal: p.is_global(),
            }
        }
    }

    #[derive(SimpleObject)]
    struct CurrencyPolicyView {
        poster: AccountNumber,
        /// Same as `poster` (old field name).
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
                poster: p.poster,
                debtor: p.poster,
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
        forwardOffers: Vec<ForwardOfferView>,
        currencyPolicies: Vec<CurrencyPolicyView>,
        /// Chain unix seconds at query time (offer / FX expiry).
        now: i64,
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
        #[serde(default, deserialize_with = "deserialize_number_from_string")]
        request_id: u32,
        #[serde(default)]
        memo: String,
    }

    #[derive(SimpleObject)]
    struct PayRequestView {
        id: u32,
        kind: u8,
        poster: AccountNumber,
        counterparty: AccountNumber,
        assetId: u16,
        amount: Decimal,
        remaining: Decimal,
        memo: String,
        expiresAt: i64,
        createdAt: i64,
    }

    impl From<PayRequest> for PayRequestView {
        fn from(r: PayRequest) -> Self {
            Self {
                id: r.id,
                kind: r.kind,
                poster: r.poster,
                counterparty: r.counterparty,
                assetId: r.asset_id,
                amount: dec(r.amount, r.asset_id),
                remaining: dec(r.remaining, r.asset_id),
                memo: r.memo.to_string(),
                expiresAt: time_sec(r.expires_at),
                createdAt: time_sec(r.created_at),
            }
        }
    }

    #[ComplexObject]
    impl ActivityEvent {
        async fn amount(&self) -> Decimal {
            let raw = self.amount.parse::<u64>().unwrap_or(0);
            dec_raw(raw, self.asset_id)
        }

        async fn netted(&self) -> Decimal {
            let raw = self.netted.parse::<u64>().unwrap_or(0);
            // Convert stores destination qty in `netted` / `other_asset_id`.
            let asset = if self.kind == "convert" {
                self.other_asset_id
            } else {
                self.asset_id
            };
            dec_raw(raw, asset)
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
                    (want_creditor && l.creditor == account) || (want_debtor && l.debtor == account)
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
                    (want_creditor && o.creditor == account) || (want_debtor && o.debtor == account)
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

        /// Path-forward offers posted by `poster` (global + specific next hops).
        async fn forwardOffers(&self, poster: AccountNumber) -> Vec<ForwardOfferView> {
            ForwardOfferTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.poster == poster)
                .map(ForwardOfferView::from)
                .collect()
        }

        /// Buy-claim offers posted by `poster` (global + specific debtors).
        async fn buyClaimOffers(&self, poster: AccountNumber) -> Vec<BuyClaimOfferView> {
            BuyClaimOfferTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.poster == poster)
                .map(BuyClaimOfferView::from)
                .collect()
        }

        /// Invoices and please-book requests where `account` is poster and/or
        /// counterparty.
        async fn requests(
            &self,
            account: AccountNumber,
            asPoster: Option<bool>,
            asCounterparty: Option<bool>,
            openOnly: Option<bool>,
        ) -> Vec<PayRequestView> {
            let want_poster = asPoster.unwrap_or(true);
            let want_counter = asCounterparty.unwrap_or(true);
            let open_only = openOnly.unwrap_or(false);
            RequestTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|r| {
                    (want_poster && r.poster == account)
                        || (want_counter && r.counterparty == account)
                })
                .filter(|r| !open_only || r.remaining.value > 0)
                .map(PayRequestView::from)
                .collect()
        }

        async fn request(&self, id: u32) -> Option<PayRequestView> {
            PayRequest::get(id).map(PayRequestView::from)
        }

        /// FX quotes posted by `poster` (middle man / claim holder).
        /// `debtor` is accepted as an alias of `poster`.
        async fn currencyPolicies(
            &self,
            poster: Option<AccountNumber>,
            debtor: Option<AccountNumber>,
        ) -> Vec<CurrencyPolicyView> {
            let Some(who) = poster.or(debtor) else {
                return Vec::new();
            };
            CurrencyPolicyTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.poster == who)
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
            let all_obs: Vec<Obligation> = ObligationTable::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .collect();

            let mut debtors: HashSet<AccountNumber> = HashSet::new();
            debtors.insert(from);
            debtors.insert(to);

            let mut selected_lines: Vec<CreditLine> = Vec::new();
            let mut seen_line: HashSet<(AccountNumber, AccountNumber, u16)> = HashSet::new();
            let mut reverse_only: Vec<CreditLineView> = Vec::new();

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
                // Claims: if frontier account is owed by X, they can path-draw on X
                // (create reverse debt and auto-net) without X having lined them.
                for o in &all_obs {
                    if !frontier.contains(&o.creditor) {
                        continue;
                    }
                    let key = (o.debtor, o.creditor, o.asset_id);
                    if seen_line.contains(&key) {
                        continue;
                    }
                    let residual = Obligation::exposure(o.creditor, o.debtor, o.asset_id).value;
                    if residual == 0 {
                        continue;
                    }
                    seen_line.insert(key);
                    reverse_only.push(CreditLineView::from_reverse_claim(
                        o.debtor, o.creditor, o.asset_id, residual,
                    ));
                    if debtors.insert(o.debtor) {
                        grew = true;
                    }
                }
                if !grew {
                    break;
                }
            }

            let mut credit_lines: Vec<CreditLineView> = selected_lines
                .into_iter()
                .map(CreditLineView::from_line)
                .collect();
            credit_lines.extend(reverse_only);

            let now_tp = services::transact::Wrapper::call()
                .currentBlock()
                .time
                .seconds();
            let now = time_sec(now_tp);

            let forward_offers: Vec<ForwardOfferView> =
                ForwardOfferTab::with_service(banx::SERVICE)
                    .get_index_pk()
                    .iter()
                    .filter(|p| debtors.contains(&p.poster) && policy_is_live(p.expires_at))
                    .map(ForwardOfferView::from)
                    .collect();

            let currency_policies: Vec<CurrencyPolicyView> =
                CurrencyPolicyTab::with_service(banx::SERVICE)
                    .get_index_pk()
                    .iter()
                    .filter(|p| debtors.contains(&p.poster) && policy_is_live(p.expires_at))
                    .map(CurrencyPolicyView::from)
                    .collect();

            let accounts = debtors.into_iter().collect();

            PathGraphView {
                accounts,
                creditLines: credit_lines,
                forwardOffers: forward_offers,
                currencyPolicies: currency_policies,
                now,
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
