mod asset;
mod book_auth;
mod cash_quote;
mod claim_offer;
mod connection;
mod credit_line;
mod currency_policy;
mod forward_offer;
mod helpers;
mod init;
mod invite;
mod obligation;
mod pair_cycle;
mod path;
mod pay_request;

pub use connection::Connection;
pub(crate) use helpers::{
    apply_hop_fee, apply_rate, apply_spread, expires_live, invert_hop_fee, invert_rate,
    live_specific_or_global,
};
pub use helpers::{assert_account_exists, cash_sub, emit_pair_activity, GLOBAL};
pub use path::{path_required_send, run_path};

#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{
        services::tokens::{Precision, Quantity},
        AccountNumber, Memo, Pack, TimePointSec, ToSchema, Unpack,
    };
    use serde::{Deserialize, Serialize};

    pub use crate::math::{PPM_SCALE, RATE_SCALE};

    /// Alias of [`RATE_SCALE`] (1:1 FX).
    pub const FX_RATE_SCALE: u64 = RATE_SCALE;

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Pack, Unpack, Debug)]
    pub struct InitRow {
        /// Next primary key for [`Obligation`] rows.
        pub next_obligation_id: u32,
        /// Next primary key for [`Asset`] rows (u16 space).
        pub next_asset_id: u16,
        /// Next primary key for [`PayRequest`] rows.
        pub next_request_id: u32,
    }

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    /// Registered currency / asset. Compact `id` is used everywhere else;
    /// `symbol` is the human/name identity.
    #[table(name = "AssetTable", index = 5)]
    #[derive(Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Asset {
        #[primary_key]
        pub id: u16,
        pub symbol: AccountNumber,
        pub precision: Precision,
        /// Human-readable description (max 80 bytes).
        pub description: Memo,
    }

    impl Asset {
        #[secondary_key(1)]
        fn by_symbol(&self) -> AccountNumber {
            self.symbol
        }
    }

    /// One hop in [`crate::service::path_pay`]: draw on `account` in `asset_id`.
    ///
    /// Example: `[(Gary, AUD), (Steve, USD)]` — currency change implies convert
    /// on the previous edge via [`CurrencyPolicy`], then same-asset routing.
    #[derive(
        Default, Copy, Clone, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct PathHop {
        pub account: AccountNumber,
        pub asset_id: u16,
    }

    /// Path-forward offer: `poster` will sit in the middle of `path_pay`.
    /// `next_hop = 0` is global (any next hop). Specific may be posted
    /// before that hop knows the poster; `path_draw` still needs a line or
    /// live claim when the hop runs.
    #[table(name = "ForwardOfferTab", index = 1)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct ForwardOffer {
        pub poster: AccountNumber,
        /// Next hop creditor, or [`Self::GLOBAL`].
        pub next_hop: AccountNumber,
        pub asset_id: u16,

        pub fee_fixed: Quantity,
        /// ppm (`10_000` = 1%); must be `< PPM_SCALE`.
        pub fee_percent: u32,
        /// Max APR ppm on a **new_draw** when forwarding. Not applied to a
        /// hop that only unwinds a reverse claim.
        pub max_line_apr: u32,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
        /// If false, poster must already know the next hop (lined them, or
        /// already owes them). A hop that only unwinds a reverse claim does
        /// not need that. If true, anyone who lined the poster can become
        /// their creditor.
        pub allow_unknown: bool,
    }

    impl ForwardOffer {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.poster, self.next_hop, self.asset_id)
        }
    }

    /// Standing claim offer. `side` is [`Self::BUY`] (poster will buy via
    /// `sell_claim`) or [`Self::SELL`] (poster will sell via `buy_claim`).
    /// `debtor = 0` is global. Residual and debtor-line checks run at take
    /// time, not at post.
    #[table(name = "ClaimOfferTab", index = 6)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct ClaimOffer {
        pub poster: AccountNumber,
        /// Underlying debtor, or [`Self::GLOBAL`].
        pub debtor: AccountNumber,
        pub asset_id: u16,
        /// [`Self::BUY`] or [`Self::SELL`].
        pub side: u8,

        pub fee_fixed: Quantity,
        /// ppm (`10_000` = 1%). Buy: positive haircuts the seller, negative
        /// is a premium the buyer pays. Sell: positive is the seller's
        /// profit, negative is a discount. `|fee_percent| < PPM_SCALE`.
        pub fee_percent: i32,
        /// Face still available. 0 means spent; the row stays so it can be topped up.
        pub remaining: Quantity,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
    }

    impl ClaimOffer {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16, u8) {
            (self.poster, self.debtor, self.asset_id, self.side)
        }
    }

    /// Invoice (`INVOICE`): poster is the payee; last hop must be the poster.
    /// `counterparty` is who was billed (`0` = anyone). Anyone with a path
    /// to the poster may fulfill. Does **not** shrink an existing debt to
    /// the poster.
    ///
    /// Please-book (`PLEASE_BOOK`): poster asked the counterparty (creditor)
    /// to `deposit` them — off-graph value received. Only the creditor can
    /// fulfill; the poster cannot clear their own debt.
    #[table(name = "RequestTab", index = 8)]
    #[derive(
        Default, Clone, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct PayRequest {
        pub id: u32,
        /// [`Self::INVOICE`] or [`Self::PLEASE_BOOK`].
        pub kind: u8,
        pub poster: AccountNumber,
        pub counterparty: AccountNumber,
        pub asset_id: u16,
        pub amount: Quantity,
        pub remaining: Quantity,
        pub memo: Memo,
        pub expires_at: TimePointSec,
        pub created_at: TimePointSec,
    }

    impl PayRequest {
        #[primary_key]
        fn pk(&self) -> u32 {
            self.id
        }
    }

    /// Standing from→to quote posted by `poster`.
    ///
    /// `convert`: the other party takes this offer and rebooks leftover
    /// exposure at this rate. The poster does not re-denominate their own claims.
    ///
    /// `path_pay`: the previous hop's **creditor** (middle man) applies their
    /// quote to size the next hop only. Does not rebook.
    #[table(name = "CurrencyPolicyTab", index = 4)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct CurrencyPolicy {
        /// Who posted the from→to offer.
        pub poster: AccountNumber,
        pub from_asset: u16,
        pub to_asset: u16,

        /// Flat fee in **from_asset** before FX (0 = none).
        pub fee_fixed: Quantity,
        /// `to = (from - fee_fixed) * fx_rate / RATE_SCALE`.
        pub fx_rate: u64,
        /// Interest rate (ppm APR) for the new `to_asset` obligation bucket.
        pub to_interest_rate: u32,
        /// Absolute expiry (`seconds == 0` → never). Prefer short TTL for FX.
        pub expires_at: TimePointSec,
    }

    impl CurrencyPolicy {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u16, u16) {
            (self.poster, self.from_asset, self.to_asset)
        }
    }

    /// Directed claim: `debtor` owes `creditor` principal + accrued interest of
    /// `asset_id`. Accrue before any principal change. [`Obligation::net_pair`]
    /// cancels both directions: interest first, then principal; highest rate first.
    #[table(name = "ObligationTable", index = 2)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Obligation {
        #[primary_key]
        pub id: u32,

        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,

        pub remaining_principal: Quantity,
        /// Interest finalized at the last principal/rate change. Compounds
        /// with principal (see [`crate::interest`]).
        pub accrued_interest: Quantity,
        /// Compound APR in ppm per year (`10_000` = 1%, `-10_000` decays).
        /// See [`crate::interest`].
        pub interest_rate: i32,

        /// Start of the current principal/rate epoch.
        pub last_interest_accrual: TimePointSec,
        pub created_at: TimePointSec,
    }

    impl Obligation {
        #[secondary_key(1)]
        fn by_set(&self) -> (AccountNumber, AccountNumber, u16, u32) {
            (self.creditor, self.debtor, self.asset_id, self.id)
        }
    }

    /// Posted grace + open-cycle snapshot for a directed pair/asset.
    ///
    /// Creditor writes `grace_seconds` via `st_crd_lne`. Occupied-changing
    /// actions write the cycle clock via [`PairCycle::sync_cycle`]. Same key as
    /// [`CreditLine`]; separate row so a line upsert cannot clobber the clock.
    #[table(name = "PairCycleTab", index = 7)]
    #[derive(
        Default, Clone, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct PairCycle {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,
        /// Posted interest-free window for the *next* 0→positive cycle.
        pub grace_seconds: u32,
        /// When the current cycle opened (`0` = none).
        pub cycle_started_at: TimePointSec,
        /// Grace snapshotted at cycle open. Later posted-grace edits do not change it.
        pub cycle_grace_seconds: u32,
    }

    impl PairCycle {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.creditor, self.debtor, self.asset_id)
        }
    }

    /// Bilateral credit facility: `creditor` will be owed by `debtor` up to
    /// `limit` of `asset_id`, at `interest_rate` on new draws.
    ///
    /// `limit` is a stable cap on outstanding exposure (principal + interest).
    /// A draw of `amount` requires `exposure + amount <= limit`.
    /// When `deplete_on_debit`, `remaining` shrinks on new_draw / claim take
    /// (unwind does not; repayment does not restore it). Revolving lines
    /// ignore `remaining`.
    ///
    /// Interest-free grace lives on [`PairCycle`], not this row.
    #[table(name = "CreditLineTable", index = 3)]
    #[derive(
        Default, Clone, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct CreditLine {
        pub creditor: AccountNumber,
        pub debtor: AccountNumber,
        pub asset_id: u16,

        /// Stable cap on outstanding exposure (principal + accrued interest).
        pub limit: Quantity,
        /// If true, new draws and claim takes also consume [`Self::remaining`]
        /// (unwind against the reverse claim does not).
        pub deplete_on_debit: bool,
        /// Rate applied to new draws on this line (ppm APR); see [`crate::interest`].
        pub interest_rate: u32,
        /// When `deplete_on_debit`. Ignored for revolving lines.
        pub remaining: Quantity,
    }

    impl CreditLine {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.creditor, self.debtor, self.asset_id)
        }
    }

    /// Maker quote: Banx asset ↔ Tokens `token_id`. Poster is the cashier.
    ///
    /// `is_out`: taker draws Banx on the poster and receives tokens.
    /// Otherwise taker sends tokens; poster is deposited (repay or a new
    /// claim on the poster).
    ///
    /// `to = (from − fee_fixed) * fx_rate / RATE_SCALE`. Out `from` is Banx;
    /// in `from` is tokens.
    #[table(name = "CashQuoteTab", index = 9)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct CashQuote {
        pub poster: AccountNumber,
        pub asset_id: u16,
        pub token_id: u32,
        /// True: Banx → tokens (`cash_out`). False: tokens → Banx (`cash_in`).
        pub is_out: bool,
        pub fee_fixed: Quantity,
        pub fx_rate: u64,
        /// Taker input still available: Banx units when `is_out`, token units
        /// otherwise. 0 means spent; the row stays so it can be topped up.
        pub remaining: Quantity,
        pub expires_at: TimePointSec,
    }

    impl CashQuote {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u16, u32, bool) {
            (self.poster, self.asset_id, self.token_id, self.is_out)
        }
    }

    /// Invite created through Banx: the first accept extends a credit line to
    /// that claimee (skipped if a line already exists) and records `claimed_by`.
    #[table(name = "BanxInviteTable", index = 10)]
    #[derive(Default, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct BanxInvite {
        #[primary_key]
        pub id: u32,
        pub inviter: AccountNumber,
        pub asset_id: u16,
        pub limit: Quantity,
        pub deplete_on_debit: bool,
        pub interest_rate: u32,
        pub grace_seconds: u32,
        pub created_at: TimePointSec,
        /// Set on the first successful claim; `None` until then.
        pub claimed_by: Option<AccountNumber>,
    }

    impl BanxInvite {
        #[secondary_key(1)]
        fn by_inviter(&self) -> (AccountNumber, u32) {
            (self.inviter, self.id)
        }
    }

    /// Standing book-auth: `debtor` lets `creditor` `book` deposits onto them
    /// in `asset_id`, spending [`Self::remaining`]. Dual of a credit line
    /// (who may *write* that I owe them, not who may *draw*).
    #[table(name = "BookAuthTab", index = 11)]
    #[derive(
        Default, Clone, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct BookAuth {
        pub debtor: AccountNumber,
        pub creditor: AccountNumber,
        pub asset_id: u16,
        /// Live budget the creditor may still book. 0 means spent; row stays so it can be topped up.
        pub remaining: Quantity,
        /// Ceiling on the booked APR ppm. 0 still allows a negative rate.
        pub max_interest_rate: u32,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
    }

    impl BookAuth {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.debtor, self.creditor, self.asset_id)
        }
    }
}

pub use tables::*;
