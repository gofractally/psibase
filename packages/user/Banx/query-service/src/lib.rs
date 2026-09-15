#[psibase::service(name = "banx-app+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use banx::tables::{
        Asset, AssetTable, BanxInvite, BanxInviteTable, BookAuth, BookAuthTab, CashQuote,
        CashQuoteTab, ClaimOffer, ClaimOfferTab, Connection, CreditLine, CreditLineTable,
        CurrencyPolicy, CurrencyPolicyTab, ForwardOffer, ForwardOfferTab, Obligation,
        ObligationTable, PairCycle, PayRequest, RequestTab, PPM_SCALE, RATE_SCALE,
    };
    use psibase::services::tokens::{Decimal, Precision, Wrapper as Tokens};
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;
    use tokens::tables::tables::{SubAccountBalanceTable, SubAccountTable};

    fn time_sec(t: TimePointSec) -> i64 {
        t.seconds as i64
    }

    fn asset_precision(id: u16) -> Precision {
        Asset::get(id).map(|a| a.precision).unwrap()
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
        /// When depleting; 0 on revolving lines.
        remaining: Decimal,
        /// Reverse claim plus line headroom (they already owe you).
        capacity: Decimal,
        /// Reverse claim included in `capacity` (they already owe you).
        reverseClaim: Decimal,
        /// False when this row is a reverse-claim-only path edge.
        isLine: bool,
    }

    impl CreditLineView {
        fn from_reverse_claim(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            reverse_claim: u64,
        ) -> Self {
            let p = asset_precision(asset_id);
            let zero = Decimal::new(0.into(), p);
            let claim = Decimal::new(reverse_claim.into(), p);
            Self {
                creditor,
                debtor,
                assetId: asset_id,
                limit: zero,
                depleteOnDebit: false,
                interestRatePpm: 0,
                graceSeconds: 0,
                cycleStartedAt: 0,
                cycleGraceSeconds: 0,
                exposure: zero,
                remaining: zero,
                capacity: claim,
                reverseClaim: claim,
                isLine: false,
            }
        }

        fn from_line(line: CreditLine) -> Self {
            let p = asset_precision(line.asset_id);
            let exposure = Obligation::exposure(line.creditor, line.debtor, line.asset_id);
            let reverse = Obligation::exposure(line.debtor, line.creditor, line.asset_id);
            let cycle = PairCycle::get(line.creditor, line.debtor, line.asset_id);
            Self {
                creditor: line.creditor,
                debtor: line.debtor,
                assetId: line.asset_id,
                limit: Decimal::new(line.limit, p),
                depleteOnDebit: line.deplete_on_debit,
                interestRatePpm: line.interest_rate,
                graceSeconds: cycle.as_ref().map(|c| c.grace_seconds).unwrap_or(0),
                cycleStartedAt: cycle
                    .as_ref()
                    .map(|c| time_sec(c.cycle_started_at))
                    .unwrap_or(0),
                cycleGraceSeconds: cycle.as_ref().map(|c| c.cycle_grace_seconds).unwrap_or(0),
                exposure: Decimal::new(exposure, p),
                remaining: Decimal::new(line.remaining, p),
                capacity: Decimal::new(
                    Connection::get_live(line.creditor, line.debtor, line.asset_id)
                        .capacity()
                        .into(),
                    p,
                ),
                reverseClaim: Decimal::new(reverse, p),
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
            let p = asset_precision(o.asset_id);
            Self {
                id: o.id,
                creditor: o.creditor,
                debtor: o.debtor,
                assetId: o.asset_id,
                remainingPrincipal: Decimal::new(o.remaining_principal, p),
                accruedInterest: Decimal::new(o.live_accrued(), p),
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
                feeFixed: Decimal::new(p.fee_fixed, asset_precision(p.asset_id)),
                feePercentPpm: p.fee_percent,
                maxLineAprPpm: p.max_line_apr,
                expiresAt: time_sec(p.expires_at),
                isGlobal: p.is_global(),
                allowUnknown: p.allow_unknown,
            }
        }
    }

    #[derive(SimpleObject)]
    struct ClaimOfferView {
        poster: AccountNumber,
        /// `0` / empty when global.
        debtor: AccountNumber,
        assetId: u16,
        /// `1` buy, `2` sell.
        side: u8,
        feeFixed: Decimal,
        feePercentPpm: i32,
        expiresAt: i64,
        isGlobal: bool,
        isBuy: bool,
        isSell: bool,
    }

    impl From<ClaimOffer> for ClaimOfferView {
        fn from(p: ClaimOffer) -> Self {
            Self {
                poster: p.poster,
                debtor: p.debtor,
                assetId: p.asset_id,
                side: p.side,
                feeFixed: Decimal::new(p.fee_fixed, asset_precision(p.asset_id)),
                feePercentPpm: p.fee_percent,
                expiresAt: time_sec(p.expires_at),
                isGlobal: p.is_global(),
                isBuy: p.side == ClaimOffer::BUY,
                isSell: p.is_sell(),
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
                feeFixed: Decimal::new(p.fee_fixed, asset_precision(p.from_asset)),
                fxRate: p.fx_rate.to_string(),
                toInterestRatePpm: p.to_interest_rate,
                expiresAt: time_sec(p.expires_at),
            }
        }
    }

    fn token_precision(token_id: u32) -> Precision {
        Tokens::call().getToken(token_id).precision
    }

    #[derive(SimpleObject)]
    struct CashQuoteView {
        poster: AccountNumber,
        assetId: u16,
        tokenId: u32,
        /// True: Banx → tokens (`cash_out`). False: tokens → Banx (`cash_in`).
        isOut: bool,
        /// Banx units for out, token units for in.
        feeFixed: Decimal,
        fxRate: String,
        expiresAt: i64,
    }

    impl From<CashQuote> for CashQuoteView {
        fn from(p: CashQuote) -> Self {
            let prec = if p.is_out {
                asset_precision(p.asset_id)
            } else {
                token_precision(p.token_id)
            };
            Self {
                poster: p.poster,
                assetId: p.asset_id,
                tokenId: p.token_id,
                isOut: p.is_out,
                feeFixed: Decimal::new(p.fee_fixed, prec),
                fxRate: p.fx_rate.to_string(),
                expiresAt: time_sec(p.expires_at),
            }
        }
    }

    #[derive(SimpleObject)]
    struct CashVaultView {
        poster: AccountNumber,
        tokenId: u32,
        balance: Decimal,
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

    /// History row from `history.banx-app.activity` (amounts already human decimals).
    #[derive(Deserialize, SimpleObject)]
    struct ActivityEvent {
        account: AccountNumber,
        counterparty: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        asset_id: u16,
        kind: String,
        amount: Decimal,
        netted: Decimal,
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
            let p = asset_precision(r.asset_id);
            Self {
                id: r.id,
                kind: r.kind,
                poster: r.poster,
                counterparty: r.counterparty,
                assetId: r.asset_id,
                amount: Decimal::new(r.amount, p),
                remaining: Decimal::new(r.remaining, p),
                memo: r.memo.to_string(),
                expiresAt: time_sec(r.expires_at),
                createdAt: time_sec(r.created_at),
            }
        }
    }

    #[derive(SimpleObject)]
    struct InviteView {
        id: u32,
        inviter: AccountNumber,
        assetId: u16,
        limit: Decimal,
        depleteOnDebit: bool,
        interestRatePpm: u32,
        graceSeconds: u32,
        createdAt: i64,
        /// Invite-service expiry (`0` if the invite record is gone).
        expiry: i64,
        /// First claimee; default/empty until claimed.
        claimedBy: AccountNumber,
    }

    #[derive(SimpleObject)]
    struct BookAuthView {
        debtor: AccountNumber,
        creditor: AccountNumber,
        assetId: u16,
        remaining: Decimal,
        maxInterestRatePpm: u32,
        expiresAt: i64,
    }

    impl From<BookAuth> for BookAuthView {
        fn from(row: BookAuth) -> Self {
            Self {
                debtor: row.debtor,
                creditor: row.creditor,
                assetId: row.asset_id,
                remaining: Decimal::new(row.remaining, asset_precision(row.asset_id)),
                maxInterestRatePpm: row.max_interest_rate,
                expiresAt: time_sec(row.expires_at),
            }
        }
    }

    impl InviteView {
        fn from_row(row: BanxInvite) -> Self {
            let p = asset_precision(row.asset_id);
            let expiry = psibase::services::invite::Wrapper::call().getExpDate(row.id);
            Self {
                id: row.id,
                inviter: row.inviter,
                assetId: row.asset_id,
                limit: Decimal::new(row.limit, p),
                depleteOnDebit: row.deplete_on_debit,
                interestRatePpm: row.interest_rate,
                graceSeconds: row.grace_seconds,
                createdAt: time_sec(row.created_at),
                expiry: time_sec(expiry),
                claimedBy: row.claimed_by,
            }
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

        /// Credit-line invite posted by `inviter`.
        async fn invite(&self, id: u32) -> Option<InviteView> {
            BanxInviteTable::with_service(banx::SERVICE)
                .get_index_pk()
                .get(&id)
                .map(InviteView::from_row)
        }

        /// Invites created by `inviter`, newest id last.
        async fn invites(&self, inviter: AccountNumber) -> Vec<InviteView> {
            BanxInviteTable::with_service(banx::SERVICE)
                .get_index_by_inviter()
                .range((inviter, 0)..=(inviter, u32::MAX))
                .map(InviteView::from_row)
                .collect()
        }

        /// Book-auths where `account` is debtor (granted) and/or creditor (received).
        async fn bookAuths(
            &self,
            account: AccountNumber,
            asDebtor: Option<bool>,
            asCreditor: Option<bool>,
        ) -> Vec<BookAuthView> {
            let want_debtor = asDebtor.unwrap_or(true);
            let want_creditor = asCreditor.unwrap_or(true);
            BookAuthTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|a| {
                    (want_debtor && a.debtor == account) || (want_creditor && a.creditor == account)
                })
                .map(BookAuthView::from)
                .collect()
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
            Decimal::new(
                Obligation::exposure(creditor, debtor, assetId),
                asset_precision(assetId),
            )
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

        /// Claim offers posted by `poster` (buy and sell, global + specific).
        async fn claimOffers(&self, poster: AccountNumber) -> Vec<ClaimOfferView> {
            ClaimOfferTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.poster == poster)
                .map(ClaimOfferView::from)
                .collect()
        }

        /// Requests where `account` is poster and/or named counterparty.
        /// Open invoices (`counterparty` 0) appear only for the poster.
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

        /// Tokens precision (for cash-quote rates).
        async fn tokenPrecision(&self, tokenId: u32) -> u8 {
            Tokens::call().getToken(tokenId).precision.value()
        }

        /// Cash quotes (Banx asset ↔ token). Omit `poster` for every desk.
        async fn cashQuotes(&self, poster: Option<AccountNumber>) -> Vec<CashQuoteView> {
            CashQuoteTab::with_service(banx::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|q| poster.map(|p| q.poster == p).unwrap_or(true))
                .map(CashQuoteView::from)
                .collect()
        }

        /// Tokens in Banx's `{poster}/{token_id}` sub-account (cash window).
        async fn cashVault(&self, poster: AccountNumber) -> Vec<CashVaultView> {
            let prefix = format!("{poster}/");
            SubAccountTable::with_service(Tokens::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|sa| sa.account == banx::SERVICE && sa.sub_account.starts_with(&prefix))
                .filter_map(|sa| {
                    let token_id: u32 = sa.sub_account.rsplit('/').next()?.parse().ok()?;
                    let bal = SubAccountBalanceTable::with_service(Tokens::SERVICE)
                        .get_index_pk()
                        .get(&(sa.id, token_id))?;
                    Some(CashVaultView {
                        poster,
                        tokenId: token_id,
                        balance: Decimal::new(bal.balance, token_precision(token_id)),
                    })
                })
                .collect()
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
                    let reverse_claim =
                        Obligation::exposure(o.creditor, o.debtor, o.asset_id).value;
                    if reverse_claim == 0 {
                        continue;
                    }
                    seen_line.insert(key);
                    reverse_only.push(CreditLineView::from_reverse_claim(
                        o.debtor,
                        o.creditor,
                        o.asset_id,
                        reverse_claim,
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
                    .filter(|p| debtors.contains(&p.poster) && p.is_live())
                    .map(ForwardOfferView::from)
                    .collect();

            let currency_policies: Vec<CurrencyPolicyView> =
                CurrencyPolicyTab::with_service(banx::SERVICE)
                    .get_index_pk()
                    .iter()
                    .filter(|p| debtors.contains(&p.poster) && p.is_live())
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

        /// Activity history for `account`. Omit `counterparty` / `assetId` for
        /// the full feed (inbox). `last` is Relay-style (chronological page).
        /// Amounts are human decimals.
        async fn activity(
            &self,
            account: AccountNumber,
            counterparty: Option<AccountNumber>,
            assetId: Option<u16>,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<EventConnection<ActivityEvent>> {
            // `?` params are bound as TEXT. asset_id is an integer column, so
            // `asset_id = ?` with "1" matches nothing; interpolate like Tokens.
            let mut cond = "account = ?".to_string();
            let mut params = vec![account.to_string()];
            if let Some(who) = counterparty {
                cond.push_str(" AND counterparty = ?");
                params.push(who.to_string());
            }
            if let Some(id) = assetId {
                cond.push_str(&format!(" AND (asset_id = {id} OR other_asset_id = {id})"));
            }
            let default_last = if counterparty.is_some() && assetId.is_some() {
                50
            } else {
                200
            };
            EventQuery::new("history.banx-app.activity")
                .condition_with_params(cond, params)
                .first(first)
                .last(last.or(Some(default_last)))
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
