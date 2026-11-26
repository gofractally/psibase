#[psibase::service(name = "favor+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use favor::tables::{
        relay_sub, Asset, AssetTable, FavorInvite, FavorInviteTable, FavorRelay, FavorRelayTable,
        BookAuth, BookAuthTab, CashQuote, CashQuoteTab, ClaimOffer, ClaimOfferTab, Connection,
        ForwardOffer, ForwardOfferTab, FxOffer, FxOfferTab, Line, Pair, PairTable, PayAuth,
        PayAuthTab, PayRequest, RequestTab, TokenRelayTable, PPM_SCALE, RATE_SCALE,
    };
    use psibase::services::tokens::{Decimal, Precision, Quantity, Wrapper as Tokens};
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
        /// What the debtor owes the creditor for this directed pair/asset.
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
                exposure: zero,
                remaining: zero,
                capacity: claim,
                reverseClaim: claim,
                isLine: false,
            }
        }

        fn from_line(
            creditor: AccountNumber,
            debtor: AccountNumber,
            asset_id: u16,
            line: Line,
        ) -> Self {
            let p = asset_precision(asset_id);
            let connection = Connection::get_live(creditor, debtor, asset_id);
            Self {
                creditor,
                debtor,
                assetId: asset_id,
                limit: Decimal::new(line.limit, p),
                depleteOnDebit: line.deplete_on_debit,
                exposure: Decimal::new(connection.forward(), p),
                remaining: Decimal::new(line.remaining, p),
                capacity: Decimal::new(connection.capacity().into(), p),
                reverseClaim: Decimal::new(connection.reverse(), p),
                isLine: true,
            }
        }
    }

    /// Lines on a `Pair` row: `(creditor, debtor, asset_id, line)`. The low side's line
    /// comes first.
    fn pair_lines(row: &Pair) -> Vec<(AccountNumber, AccountNumber, u16, Line)> {
        let mut lines = Vec::new();
        if let Some(line) = row.low_line {
            lines.push((row.low, row.high, row.asset_id, line));
        }
        if let Some(line) = row.high_line {
            lines.push((row.high, row.low, row.asset_id, line));
        }
        lines
    }

    /// The owed direction of a `Pair` row: `(creditor, debtor, amount)`.
    fn pair_owed(row: &Pair) -> Option<(AccountNumber, AccountNumber, u64)> {
        match row.balance {
            0 => None,
            b if b > 0 => Some((row.low, row.high, b.unsigned_abs())),
            b => Some((row.high, row.low, b.unsigned_abs())),
        }
    }

    fn all_pairs() -> Vec<Pair> {
        PairTable::with_service(favor::SERVICE)
            .get_index_pk()
            .iter()
            .collect()
    }

    /// Every row with `account` on either side.
    fn pairs_involving(account: AccountNumber) -> Vec<Pair> {
        let lo = AccountNumber::new(0);
        let hi = AccountNumber::new(u64::MAX);
        let table = PairTable::with_service(favor::SERVICE);
        let mut rows: Vec<Pair> = table
            .get_index_pk()
            .range((account, lo, 0)..=(account, hi, u16::MAX))
            .collect();
        rows.extend(
            table
                .get_index_by_high()
                .range((account, lo, 0)..=(account, hi, u16::MAX)),
        );
        rows
    }

    #[derive(SimpleObject)]
    struct ObligationView {
        creditor: AccountNumber,
        debtor: AccountNumber,
        assetId: u16,
        /// What the debtor owes the creditor (human decimal for the asset).
        amount: Decimal,
    }

    impl ObligationView {
        fn from_pair(row: &Pair) -> Option<Self> {
            let (creditor, debtor, owed) = pair_owed(row)?;
            Some(Self {
                creditor,
                debtor,
                assetId: row.asset_id,
                amount: Decimal::new(owed.into(), asset_precision(row.asset_id)),
            })
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
        /// Face still available.
        remaining: Decimal,
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
                remaining: Decimal::new(p.remaining, asset_precision(p.asset_id)),
                expiresAt: time_sec(p.expires_at),
                isGlobal: p.is_global(),
                isBuy: p.side == ClaimOffer::BUY,
                isSell: p.is_sell(),
            }
        }
    }

    #[derive(SimpleObject)]
    struct FxOfferView {
        poster: AccountNumber,
        /// Same as `poster` (old field name).
        debtor: AccountNumber,
        fromAsset: u16,
        toAsset: u16,
        /// True when the quote applies to debt the poster is owed.
        posterIsCreditor: bool,
        /// Fixed fee in **from** asset units (human decimal).
        feeFixed: Decimal,
        /// Chain `fx_rate` (RATE_SCALE fixed-point), not an asset amount.
        fxRate: String,
        /// From-asset still accepted (human decimal).
        remaining: Decimal,
        expiresAt: i64,
    }

    impl From<FxOffer> for FxOfferView {
        fn from(p: FxOffer) -> Self {
            Self {
                poster: p.poster,
                debtor: p.poster,
                fromAsset: p.from_asset,
                toAsset: p.to_asset,
                posterIsCreditor: p.poster_is_creditor,
                feeFixed: Decimal::new(p.fee_fixed, asset_precision(p.from_asset)),
                fxRate: p.fx_rate.to_string(),
                remaining: Decimal::new(p.remaining, asset_precision(p.from_asset)),
                expiresAt: time_sec(p.expires_at),
            }
        }
    }

    fn token_precision(token_id: u32) -> Precision {
        Tokens::call().getToken(token_id).precision
    }

    fn named_sub_balance(name: &str, token_id: u32) -> Quantity {
        let Some(sa) = SubAccountTable::with_service(Tokens::SERVICE)
            .get_index_pk()
            .iter()
            .find(|sa| sa.account == favor::SERVICE && sa.sub_account == name)
        else {
            return Quantity::new(0);
        };
        SubAccountBalanceTable::with_service(Tokens::SERVICE)
            .get_index_pk()
            .get(&(sa.id, token_id))
            .map(|b| b.balance)
            .unwrap_or_else(|| Quantity::new(0))
    }

    #[derive(SimpleObject)]
    struct FavorRelayView {
        owner: AccountNumber,
        assetLo: u16,
        assetHi: u16,
        reserveLo: Decimal,
        reserveHi: Decimal,
    }

    impl FavorRelayView {
        fn from_row(r: FavorRelay) -> Self {
            Self {
                owner: r.owner,
                assetLo: r.asset_lo,
                assetHi: r.asset_hi,
                reserveLo: Decimal::new(r.reserve_lo, asset_precision(r.asset_lo)),
                reserveHi: Decimal::new(r.reserve_hi, asset_precision(r.asset_hi)),
            }
        }
    }

    #[derive(SimpleObject)]
    struct TokenRelayView {
        owner: AccountNumber,
        assetId: u16,
        tokenId: u32,
        reserveFavor: Decimal,
        tokenReserve: Decimal,
    }

    #[derive(SimpleObject)]
    struct CashQuoteView {
        poster: AccountNumber,
        assetId: u16,
        tokenId: u32,
        /// True: Favor → tokens (`cash_out`). False: tokens → Favor (`cash_in`).
        isOut: bool,
        /// Favor units for out, token units for in.
        feeFixed: Decimal,
        fxRate: String,
        /// Taker input still available. Same units as `feeFixed`.
        remaining: Decimal,
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
                remaining: Decimal::new(p.remaining, prec),
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
        fxOffers: Vec<FxOfferView>,
        /// Constant-product Favor relays owned by an account on the path.
        relays: Vec<FavorRelayView>,
        /// Chain unix seconds at query time (offer / FX expiry).
        now: i64,
    }

    /// History row from `history.favor.activity` (amounts already human decimals).
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

    #[derive(SimpleObject)]
    struct PayAuthView {
        id: u32,
        payer: AccountNumber,
        payee: AccountNumber,
        assetId: u16,
        amount: Decimal,
        maxSpend: Decimal,
        periodSeconds: u32,
        nextDue: i64,
        endsAt: i64,
    }

    impl From<PayAuth> for PayAuthView {
        fn from(row: PayAuth) -> Self {
            let p = asset_precision(row.asset_id);
            Self {
                id: row.id,
                payer: row.payer,
                payee: row.payee,
                assetId: row.asset_id,
                amount: Decimal::new(row.amount, p),
                maxSpend: Decimal::new(row.max_spend, p),
                periodSeconds: row.period_seconds,
                nextDue: time_sec(row.next_due),
                endsAt: time_sec(row.ends_at),
            }
        }
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
        createdAt: i64,
        /// Invite-service expiry (`0` if the invite record is gone).
        expiry: i64,
        /// First claimee; null until claimed.
        claimedBy: Option<AccountNumber>,
    }

    #[derive(SimpleObject)]
    struct BookAuthView {
        debtor: AccountNumber,
        creditor: AccountNumber,
        assetId: u16,
        remaining: Decimal,
        expiresAt: i64,
    }

    impl From<BookAuth> for BookAuthView {
        fn from(row: BookAuth) -> Self {
            Self {
                debtor: row.debtor,
                creditor: row.creditor,
                assetId: row.asset_id,
                remaining: Decimal::new(row.remaining, asset_precision(row.asset_id)),
                expiresAt: time_sec(row.expires_at),
            }
        }
    }

    impl InviteView {
        fn from_row(row: FavorInvite) -> Self {
            let p = asset_precision(row.asset_id);
            let expiry = psibase::services::invite::Wrapper::call().getExpDate(row.id);
            Self {
                id: row.id,
                inviter: row.inviter,
                assetId: row.asset_id,
                limit: Decimal::new(row.limit, p),
                depleteOnDebit: row.deplete_on_debit,
                createdAt: time_sec(row.created_at),
                expiry: time_sec(expiry),
                claimedBy: row.claimed_by,
            }
        }
    }

    struct Query {
        user: Option<AccountNumber>,
    }

    impl Query {
        /// The signed-in caller, from the http-server session. Private
        /// relationship data and quotes need one.
        fn user(&self) -> Result<AccountNumber, async_graphql::Error> {
            self.user
                .ok_or_else(|| async_graphql::Error::new("sign in to read your private network"))
        }

        /// Fail unless the caller is `who`.
        fn require(&self, who: AccountNumber, what: &str) -> Result<(), async_graphql::Error> {
            if self.user()? != who {
                return Err(async_graphql::Error::new(format!(
                    "you can only read your own {what}"
                )));
            }
            Ok(())
        }
    }

    #[Object]
    impl Query {
        /// Fixed scales used by Favor rate math.
        async fn constants(&self) -> ConstantsView {
            ConstantsView {
                ppmScale: PPM_SCALE,
                rateScale: RATE_SCALE.to_string(),
            }
        }

        /// All registered assets.
        async fn assets(&self) -> Vec<AssetView> {
            AssetTable::with_service(favor::SERVICE)
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
            FavorInviteTable::with_service(favor::SERVICE)
                .get_index_pk()
                .get(&id)
                .map(InviteView::from_row)
        }

        /// Invites created by `inviter`, newest id last. Only the inviter may list them.
        async fn invites(&self, inviter: AccountNumber) -> Result<Vec<InviteView>> {
            self.require(inviter, "invites")?;
            Ok(FavorInviteTable::with_service(favor::SERVICE)
                .get_index_by_inviter()
                .range((inviter, 0)..=(inviter, u32::MAX))
                .map(InviteView::from_row)
                .collect())
        }

        /// Book-auths where `account` is debtor (granted) and/or creditor
        /// (received). Only rows the caller is a party to are returned.
        async fn bookAuths(
            &self,
            account: AccountNumber,
            asDebtor: Option<bool>,
            asCreditor: Option<bool>,
        ) -> Result<Vec<BookAuthView>> {
            let me = self.user()?;
            let want_debtor = asDebtor.unwrap_or(true);
            let want_creditor = asCreditor.unwrap_or(true);
            Ok(BookAuthTab::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|a| a.debtor == me || a.creditor == me)
                .filter(|a| {
                    (want_debtor && a.debtor == account) || (want_creditor && a.creditor == account)
                })
                .map(BookAuthView::from)
                .collect())
        }

        /// Credit lines where `account` is creditor and/or debtor. Only lines
        /// the caller is a party to are returned: ask about someone else and
        /// you see the lines between you. `limit` / `exposure` are human
        /// decimals for the line's asset.
        async fn creditLines(
            &self,
            account: AccountNumber,
            asCreditor: Option<bool>,
            asDebtor: Option<bool>,
        ) -> Result<Vec<CreditLineView>> {
            let me = self.user()?;
            let want_creditor = asCreditor.unwrap_or(true);
            let want_debtor = asDebtor.unwrap_or(true);
            Ok(pairs_involving(account)
                .iter()
                .flat_map(pair_lines)
                .filter(|(creditor, debtor, _, _)| *creditor == me || *debtor == me)
                .filter(|(creditor, debtor, _, _)| {
                    (want_creditor && *creditor == account) || (want_debtor && *debtor == account)
                })
                .map(|(creditor, debtor, asset_id, line)| {
                    CreditLineView::from_line(creditor, debtor, asset_id, line)
                })
                .collect())
        }

        /// Obligations where `account` is creditor and/or debtor: one per pair
        /// row with a balance, in the owed direction. Only obligations the
        /// caller is a party to are returned. `amount` is a human decimal for
        /// the obligation's asset.
        async fn obligations(
            &self,
            account: AccountNumber,
            asCreditor: Option<bool>,
            asDebtor: Option<bool>,
        ) -> Result<Vec<ObligationView>> {
            let me = self.user()?;
            let want_creditor = asCreditor.unwrap_or(true);
            let want_debtor = asDebtor.unwrap_or(true);
            Ok(pairs_involving(account)
                .iter()
                .filter_map(ObligationView::from_pair)
                .filter(|o| o.creditor == me || o.debtor == me)
                .filter(|o| {
                    (want_creditor && o.creditor == account) || (want_debtor && o.debtor == account)
                })
                .collect())
        }

        /// Pair exposure: what `debtor` owes `creditor` in `assetId`.
        /// Human decimal for that asset. The caller must be one of the two.
        async fn exposure(
            &self,
            creditor: AccountNumber,
            debtor: AccountNumber,
            assetId: u16,
        ) -> Result<Decimal> {
            let me = self.user()?;
            if me != creditor && me != debtor {
                return Err(async_graphql::Error::new(
                    "you can only read an exposure you are a party to",
                ));
            }
            Ok(Decimal::new(
                Pair::exposure(creditor, debtor, assetId),
                asset_precision(assetId),
            ))
        }

        /// Path-forward offers posted by `poster` (global + specific next
        /// hops). Routing fees are private: only the poster may read them.
        async fn forwardOffers(&self, poster: AccountNumber) -> Result<Vec<ForwardOfferView>> {
            self.require(poster, "forwarding offers")?;
            Ok(ForwardOfferTab::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.poster == poster)
                .map(ForwardOfferView::from)
                .collect())
        }

        /// Claim offers posted by `poster` (buy and sell, global + specific).
        async fn claimOffers(&self, poster: AccountNumber) -> Vec<ClaimOfferView> {
            ClaimOfferTab::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.poster == poster)
                .map(ClaimOfferView::from)
                .collect()
        }

        /// Requests where `account` is poster and/or named counterparty. Only
        /// requests the caller posted or is named on are returned. Open
        /// invoices (`counterparty` 0) appear only for the poster.
        async fn requests(
            &self,
            account: AccountNumber,
            asPoster: Option<bool>,
            asCounterparty: Option<bool>,
            openOnly: Option<bool>,
        ) -> Result<Vec<PayRequestView>> {
            let me = self.user()?;
            let want_poster = asPoster.unwrap_or(true);
            let want_counter = asCounterparty.unwrap_or(true);
            let open_only = openOnly.unwrap_or(false);
            Ok(RequestTab::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|r| r.poster == me || r.counterparty == me)
                .filter(|r| {
                    (want_poster && r.poster == account)
                        || (want_counter && r.counterparty == account)
                })
                .filter(|r| !open_only || r.remaining.value > 0)
                .map(PayRequestView::from)
                .collect())
        }

        /// One request by id. The poster and the named counterparty can read
        /// it. An open invoice (`counterparty` 0) can be read by any signed-in
        /// caller, because its link is how it is paid.
        async fn request(&self, id: u32) -> Result<Option<PayRequestView>> {
            let me = self.user()?;
            Ok(PayRequest::get(id)
                .filter(|r| r.poster == me || r.counterparty == me || r.counterparty.value == 0)
                .map(PayRequestView::from))
        }

        /// Repeating payments where `account` is the payer or the payee.
        /// Only series the caller is a party to are returned.
        async fn payAuths(&self, account: AccountNumber) -> Result<Vec<PayAuthView>> {
            let me = self.user()?;
            Ok(PayAuthTab::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|row| row.payer == me || row.payee == me)
                .filter(|row| row.payer == account || row.payee == account)
                .map(PayAuthView::from)
                .collect())
        }

        /// Tokens precision (for cash-quote rates).
        async fn tokenPrecision(&self, tokenId: u32) -> u8 {
            Tokens::call().getToken(tokenId).precision.value()
        }

        /// Cash quotes (Favor asset ↔ token). Omit `poster` for every desk.
        async fn cashQuotes(&self, poster: Option<AccountNumber>) -> Vec<CashQuoteView> {
            CashQuoteTab::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|q| poster.map(|p| q.poster == p).unwrap_or(true))
                .map(CashQuoteView::from)
                .collect()
        }

        /// Tokens in Favor's `{poster}/{token_id}` sub-account (cash window).
        async fn cashVault(&self, poster: AccountNumber) -> Vec<CashVaultView> {
            let prefix = format!("{poster}/");
            SubAccountTable::with_service(Tokens::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|sa| sa.account == favor::SERVICE && sa.sub_account.starts_with(&prefix))
                .filter_map(|sa| {
                    // `{poster}/{token}` is the cash vault. A pool is `{poster}/{asset}/{token}`.
                    let rest = sa.sub_account.strip_prefix(&prefix)?;
                    if rest.contains('/') {
                        return None;
                    }
                    let token_id: u32 = rest.parse().ok()?;
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
        async fn fxOffers(
            &self,
            poster: Option<AccountNumber>,
            debtor: Option<AccountNumber>,
        ) -> Vec<FxOfferView> {
            let Some(who) = poster.or(debtor) else {
                return Vec::new();
            };
            FxOfferTab::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|p| p.poster == who)
                .map(FxOfferView::from)
                .collect()
        }

        /// Whether a routing key exists. Without one no route can be sealed or opened.
        async fn routingReady(&self) -> bool {
            favor::tables::RouteKeyTable::with_service(favor::SERVICE)
                .get_index_pk()
                .get(&0)
                .is_some()
        }

        /// Search a path and seal it. The hops are not in this result.
        ///
        /// `amount` is a raw integer string. Exact-out means that is what the
        /// payee receives. Otherwise it is what the payer sends. Caller must
        /// be the payer or the payee.
        async fn quotePath(
            &self,
            from: AccountNumber,
            to: AccountNumber,
            amount: String,
            fromAsset: u16,
            toAsset: Option<u16>,
            maxHops: Option<u8>,
            exactOut: Option<bool>,
        ) -> Result<RouteQuote> {
            let user = self.user()?;
            if user != from && user != to {
                return Err(async_graphql::Error::new(
                    "sign in as the payer or the payee to quote a path",
                ));
            }
            if from == to && toAsset == Some(fromAsset) {
                return Err(async_graphql::Error::new(
                    "from and to are the same account",
                ));
            }
            let exact_out = exactOut.unwrap_or(false);
            let amount_asset = if exact_out {
                toAsset.unwrap_or(fromAsset)
            } else {
                fromAsset
            };
            let amount_raw = Quantity::from_str(&amount, asset_precision(amount_asset))
                .map_err(|_| async_graphql::Error::new("amount is not a valid decimal"))?
                .value;
            if amount_raw == 0 {
                return Err(async_graphql::Error::new("amount must be positive"));
            }
            let exact_out = exactOut.unwrap_or(false);
            if exact_out && toAsset.is_none() {
                return Err(async_graphql::Error::new(
                    "exact-out quote requires toAsset",
                ));
            }
            let max_hops = maxHops.unwrap_or(6).clamp(1, 12);
            let graph = build_path_graph(from, to, Some(max_hops));
            let (mut lines, routing, fx) = graph_edges(&graph);
            // A payee quoting for the payer routes a payment she did not
            // choose, and the chain limits where that route may start.
            let for_payer = user != from;
            if for_payer {
                limit_first_hops_to_payer_consent(&mut lines, from, to);
            }
            let found = if exact_out {
                favor::path_find::find_favor_path_exact_out(
                    &lines, &routing, &fx, from, to, amount_raw, fromAsset, toAsset, max_hops,
                    graph.now,
                )
            } else {
                favor::path_find::find_favor_path(
                    &lines, &routing, &fx, from, to, amount_raw, fromAsset, toAsset, max_hops,
                    graph.now,
                )
            };
            let Some(quote) = found else {
                return Err(async_graphql::Error::new(if for_payer {
                    "no path the payer has agreed to: it must start at the payee, an account the payer has a line to or owes, or an account that owes the payer"
                } else {
                    "no path"
                }));
            };
            let key = favor::tables::RouteKeyTable::with_service(favor::SERVICE)
                .get_index_pk()
                .get(&0)
                .ok_or_else(|| {
                    async_graphql::Error::new(
                        "routing key is not set; the operator must run deploy.sh",
                    )
                })?;
            let mut random = [0_u8; 24 + 12 * 48];
            unsafe {
                psibase::native_raw::getRandom(random.as_mut_ptr(), random.len());
            }
            let hops: Vec<favor::tables::PathHop> = quote
                .hops
                .iter()
                .map(|hop| favor::tables::PathHop {
                    account: hop.account,
                    asset_id: hop.asset_id,
                })
                .collect();
            let last_asset = hops.last().map(|h| h.asset_id).unwrap_or(fromAsset);
            let amount_out = quote.amount_out;
            let min_return = if exact_out { amount_raw } else { amount_out };
            let expires_at = graph.now + favor::route::QUOTE_TTL;
            let terms = favor::route::RouteTerms {
                epoch: key.epoch,
                payer: from,
                payee: to,
                from_asset: fromAsset,
                to_asset: last_asset,
                amount_in: quote.amount_in,
                amount_out,
                expires_at,
            };
            // What each hop draws, after fees. Execution prices every hop live
            // and rejects the payment if any draw differs from this.
            let amounts: Vec<u64> = quote.hops.iter().map(|hop| hop.amount).collect();
            let route = favor::route::seal(&key.secret, terms, &hops, &amounts, &random)
                .map_err(async_graphql::Error::new)?;
            Ok(RouteQuote {
                route,
                amountIn: quote.amount_in.to_string(),
                amountOut: amount_out.to_string(),
                minReturn: min_return.to_string(),
                expiresAt: expires_at,
                hopCount: hops.len() as u8,
            })
        }
        /// Constant-product Favor relays. Omit `owner` for every relay.
        async fn favorRelays(&self, owner: Option<AccountNumber>) -> Vec<FavorRelayView> {
            FavorRelayTable::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|r| owner.map(|o| r.owner == o).unwrap_or(true))
                .map(FavorRelayView::from_row)
                .collect()
        }

        /// Favor↔token relays. Omit `owner` for every relay.
        /// `tokenReserve` is the pair sub-account `{owner}/{asset}/{token}`.
        async fn tokenRelays(&self, owner: Option<AccountNumber>) -> Vec<TokenRelayView> {
            TokenRelayTable::with_service(favor::SERVICE)
                .get_index_pk()
                .iter()
                .filter(|r| owner.map(|o| r.owner == o).unwrap_or(true))
                .map(|r| {
                    let tokens =
                        named_sub_balance(&relay_sub(r.owner, r.asset_id, r.token_id), r.token_id);
                    TokenRelayView {
                        owner: r.owner,
                        assetId: r.asset_id,
                        tokenId: r.token_id,
                        reserveFavor: Decimal::new(r.reserve_favor, asset_precision(r.asset_id)),
                        tokenReserve: Decimal::new(tokens, token_precision(r.token_id)),
                    }
                })
                .collect()
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
            // Your history only. Another account's feed names who it paid.
            self.require(account, "activity")?;
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
            EventQuery::new("history.favor.activity")
                .condition_with_params(cond, params)
                .first(first)
                .last(last.or(Some(default_last)))
                .before(before)
                .after(after)
                .query()
        }
    }

    #[derive(SimpleObject)]
    struct RouteQuote {
        /// Sealed hop list. Submit this to `path_pay` / `pay_inv` / `run_pay_auth`.
        route: String,
        /// Raw units the payer is drawn for.
        amountIn: String,
        /// Raw units the payee receives.
        amountOut: String,
        /// Raw units to pass as `min_return`.
        minReturn: String,
        expiresAt: i64,
        /// How many hops were sealed. The blob itself does not reveal this.
        hopCount: u8,
    }

    fn build_path_graph(
        from: AccountNumber,
        to: AccountNumber,
        max_hops: Option<u8>,
    ) -> PathGraphView {
        let max_hops = max_hops.unwrap_or(6).clamp(1, 12) as usize;
        use std::collections::HashSet;

        let pairs = all_pairs();
        let all_lines: Vec<(AccountNumber, AccountNumber, u16, Line)> =
            pairs.iter().flat_map(pair_lines).collect();
        let all_obs: Vec<(AccountNumber, AccountNumber, u16, u64)> = pairs
            .iter()
            .filter_map(|row| {
                pair_owed(row)
                    .map(|(creditor, debtor, owed)| (creditor, debtor, row.asset_id, owed))
            })
            .collect();

        let mut debtors: HashSet<AccountNumber> = HashSet::new();
        debtors.insert(from);
        debtors.insert(to);

        let mut selected_lines: Vec<(AccountNumber, AccountNumber, u16, Line)> = Vec::new();
        let mut seen_line: HashSet<(AccountNumber, AccountNumber, u16)> = HashSet::new();
        let mut reverse_only: Vec<CreditLineView> = Vec::new();

        for _ in 0..max_hops {
            let frontier: HashSet<AccountNumber> = debtors.clone();
            let mut grew = false;
            for line in &all_lines {
                let (creditor, debtor, asset_id, _) = *line;
                if !frontier.contains(&debtor) {
                    continue;
                }
                let key = (creditor, debtor, asset_id);
                if !seen_line.insert(key) {
                    continue;
                }
                selected_lines.push(*line);
                if debtors.insert(creditor) {
                    grew = true;
                }
            }
            // Claims: if frontier account is owed by X, they can path-draw on X
            // (create reverse debt and auto-net) without X having lined them.
            for &(creditor, debtor, asset_id, reverse_claim) in &all_obs {
                if !frontier.contains(&creditor) {
                    continue;
                }
                let key = (debtor, creditor, asset_id);
                if seen_line.contains(&key) {
                    continue;
                }
                seen_line.insert(key);
                reverse_only.push(CreditLineView::from_reverse_claim(
                    debtor,
                    creditor,
                    asset_id,
                    reverse_claim,
                ));
                if debtors.insert(debtor) {
                    grew = true;
                }
            }
            if !grew {
                break;
            }
        }

        let mut credit_lines: Vec<CreditLineView> = selected_lines
            .into_iter()
            .map(|(creditor, debtor, asset_id, line)| {
                CreditLineView::from_line(creditor, debtor, asset_id, line)
            })
            .collect();
        credit_lines.extend(reverse_only);

        let now_tp = services::transact::Wrapper::call()
            .currentBlock()
            .time
            .seconds();
        let now = time_sec(now_tp);

        let forward_offers: Vec<ForwardOfferView> = ForwardOfferTab::with_service(favor::SERVICE)
            .get_index_pk()
            .iter()
            .filter(|p| debtors.contains(&p.poster) && p.is_live())
            .map(ForwardOfferView::from)
            .collect();

        let relay_rows: Vec<FavorRelay> = FavorRelayTable::with_service(favor::SERVICE)
            .get_index_pk()
            .iter()
            .filter(|r| debtors.contains(&r.owner))
            .collect();
        let relay_pairs: HashSet<(AccountNumber, u16, u16)> = relay_rows
            .iter()
            .map(|r| (r.owner, r.asset_lo, r.asset_hi))
            .collect();
        let relays = relay_rows
            .into_iter()
            .map(FavorRelayView::from_row)
            .collect();

        let fx_offers: Vec<FxOfferView> = FxOfferTab::with_service(favor::SERVICE)
            .get_index_pk()
            .iter()
            .filter(|p| {
                if !(debtors.contains(&p.poster) && p.is_live() && p.poster_is_creditor) {
                    return false;
                }
                let (lo, hi) = if p.from_asset < p.to_asset {
                    (p.from_asset, p.to_asset)
                } else {
                    (p.to_asset, p.from_asset)
                };
                !relay_pairs.contains(&(p.poster, lo, hi))
            })
            .map(FxOfferView::from)
            .collect();

        let accounts = debtors.into_iter().collect();

        PathGraphView {
            accounts,
            creditLines: credit_lines,
            forwardOffers: forward_offers,
            fxOffers: fx_offers,
            relays,
            now,
        }
    }

    /// Where the chain lets a payee-run payment start: the payee, an account
    /// the payer lined (even at 0) or owes, in that asset, or an account that
    /// owes the payer, where the draw only unwinds the claim. Any other first
    /// hop can still use what that account already owes the payer, and no more.
    fn limit_first_hops_to_payer_consent(
        lines: &mut [favor::path_find::LineEdge],
        payer: AccountNumber,
        payee: AccountNumber,
    ) {
        let mut known: std::collections::HashSet<(AccountNumber, u16)> =
            std::collections::HashSet::new();
        for row in pairs_involving(payer) {
            for (creditor, debtor, asset_id, _) in pair_lines(&row) {
                if creditor == payer {
                    known.insert((debtor, asset_id));
                }
            }
            if let Some((creditor, debtor, _)) = pair_owed(&row) {
                if debtor == payer {
                    known.insert((creditor, row.asset_id));
                }
            }
        }
        for edge in lines.iter_mut() {
            if edge.debtor == payer
                && edge.creditor != payee
                && !known.contains(&(edge.creditor, edge.asset_id))
            {
                // Unwind only: the same shape as a reverse-claim-only edge.
                edge.capacity = edge.reverse_claim;
                edge.is_line = false;
            }
        }
    }

    fn raw_qty(d: &Decimal) -> u64 {
        d.quantity.value
    }

    fn graph_edges(
        graph: &PathGraphView,
    ) -> (
        Vec<favor::path_find::LineEdge>,
        Vec<favor::path_find::RoutingEdge>,
        Vec<favor::path_find::FxEdge>,
    ) {
        let lines = graph
            .creditLines
            .iter()
            .map(|l| favor::path_find::LineEdge {
                creditor: l.creditor,
                debtor: l.debtor,
                asset_id: l.assetId,
                capacity: raw_qty(&l.capacity),
                reverse_claim: raw_qty(&l.reverseClaim),
                exposure: raw_qty(&l.exposure),
                is_line: l.isLine,
            })
            .collect();
        let routing = graph
            .forwardOffers
            .iter()
            .map(|r| favor::path_find::RoutingEdge {
                creditor: r.nextHop,
                debtor: r.poster,
                asset_id: r.assetId,
                hop_fee_fixed: raw_qty(&r.feeFixed),
                hop_fee_percent_ppm: r.feePercentPpm,
                expires_at: r.expiresAt,
                allow_unknown: r.allowUnknown,
            })
            .collect();
        let mut fx: Vec<favor::path_find::FxEdge> = Vec::new();
        for r in &graph.relays {
            fx.push(favor::path_find::FxEdge {
                poster: r.owner,
                from_asset: r.assetLo,
                to_asset: r.assetHi,
                fee_fixed: 0,
                fx_rate: 0,
                remaining: 0,
                expires_at: 0,
                reserve_in: raw_qty(&r.reserveLo),
                reserve_out: raw_qty(&r.reserveHi),
            });
            fx.push(favor::path_find::FxEdge {
                poster: r.owner,
                from_asset: r.assetHi,
                to_asset: r.assetLo,
                fee_fixed: 0,
                fx_rate: 0,
                remaining: 0,
                expires_at: 0,
                reserve_in: raw_qty(&r.reserveHi),
                reserve_out: raw_qty(&r.reserveLo),
            });
        }
        for p in &graph.fxOffers {
            fx.push(favor::path_find::FxEdge {
                poster: p.poster,
                from_asset: p.fromAsset,
                to_asset: p.toAsset,
                fee_fixed: raw_qty(&p.feeFixed),
                fx_rate: p.fxRate.parse().unwrap_or(0),
                remaining: raw_qty(&p.remaining),
                expires_at: p.expiresAt,
                reserve_in: 0,
                reserve_out: 0,
            });
        }
        (lines, routing, fx)
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
