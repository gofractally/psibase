mod asset;
mod banx_relay;
mod book_auth;
mod cash_quote;
mod claim_offer;
mod connection;
mod forward_offer;
mod fx_offer;
mod helpers;
mod init;
mod invite;
mod pair;
mod path;
mod pay_auth;
mod pay_request;
mod token_relay;

pub use connection::Connection;
pub(crate) use helpers::{
    apply_hop_fee, apply_rate, apply_spread, emit_path_draw, expires_live, invert_hop_fee,
    invert_rate, live_specific_or_global, now,
};
pub use helpers::{assert_account_exists, cash_sub, emit_pair_activity, relay_sub, GLOBAL};
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
        /// Next primary key for [`Asset`] rows (u16 space).
        pub next_asset_id: u16,
        /// Next primary key for [`PayRequest`] rows.
        pub next_request_id: u32,
        /// Next primary key for [`PayAuth`] rows.
        pub next_pay_auth_id: u32,
    }

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    /// Registered currency / asset. Compact `id` is used everywhere else;
    /// `symbol` is the human/name identity.
    #[table(name = "AssetTable", index = 4)]
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
    /// on the previous edge via [`FxOffer`], then same-asset routing.
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
    /// live claim when the hop runs. The fee is the only price: lines carry
    /// no interest.
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
    #[table(name = "ClaimOfferTab", index = 5)]
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
    #[table(name = "RequestTab", index = 6)]
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

    /// Standing from→to quote posted by `poster`, for one debt direction.
    ///
    /// `poster_is_creditor` selects the book it applies to. The other
    /// direction is a second row. `convert` loads only the row that matches
    /// the leftover from-asset debt. The poster's fee is added when they are
    /// owed that asset and subtracted when they owe it.
    ///
    /// `path_pay` uses only the creditor-side row (`poster_is_creditor`).
    /// It sizes the next hop with the fee subtracted. It does not rebook:
    /// the payer still owes the middle man the full from-asset.
    #[table(name = "FxOfferTab", index = 3)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct FxOffer {
        /// Who posted the from→to offer.
        pub poster: AccountNumber,
        pub from_asset: u16,
        pub to_asset: u16,
        /// True when this quote applies to debt the poster is owed.
        pub poster_is_creditor: bool,

        /// Flat fee in **from_asset**. On convert it is added when
        /// `poster_is_creditor` and subtracted otherwise. Path subtracts it.
        pub fee_fixed: Quantity,
        /// Convert: `to = (amount ± fee_fixed) * fx_rate / RATE_SCALE`.
        /// Path: `to = (amount - fee_fixed) * fx_rate / RATE_SCALE`.
        pub fx_rate: u64,
        /// From-asset still accepted. Convert and path FX spend it.
        /// The last unit deletes the row. An empty offer is not a trade.
        pub remaining: Quantity,
        /// Absolute expiry (`seconds == 0` → never). Prefer short TTL for FX.
        pub expires_at: TimePointSec,
    }

    impl FxOffer {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u16, u16, bool) {
            (
                self.poster,
                self.from_asset,
                self.to_asset,
                self.poster_is_creditor,
            )
        }
    }

    /// One direction of a [`Pair`]: the creditor's facility to the debtor.
    ///
    /// `limit` is a stable cap on what the debtor may owe. A draw of `amount`
    /// requires `owed + amount <= limit`. When `deplete_on_debit`, `remaining`
    /// shrinks on a new draw or claim take (unwinding a reverse claim does
    /// not; repayment does not restore it). While revolving, `remaining`
    /// tracks `limit` and headroom ignores it.
    ///
    /// A zero limit is still a line: it is consent to be a known counterparty.
    #[derive(
        Default, Clone, Copy, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct Line {
        pub limit: Quantity,
        pub deplete_on_debit: bool,
        /// Budget consumed only while `deplete_on_debit`. Tracks `limit` on a revolving line.
        pub remaining: Quantity,
    }

    /// Everything between two accounts in one asset: the net balance and each
    /// side's credit line. `low` is the account with the smaller account
    /// number, so a pair has exactly one row.
    ///
    /// `balance` is signed. Positive means `high` owes `low`; negative means
    /// `low` owes `high`. Only one direction can be owed at a time, so every
    /// write nets: a claim that meets a reverse claim cancels it first.
    ///
    /// A row with no balance and no line is deleted.
    #[table(name = "PairTable", index = 2)]
    #[derive(
        Default, Clone, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct Pair {
        pub low: AccountNumber,
        pub high: AccountNumber,
        pub asset_id: u16,
        /// `> 0`: `high` owes `low`. `< 0`: `low` owes `high`.
        pub balance: i64,
        /// `low`'s facility to `high` (`low` is the creditor).
        pub low_line: Option<Line>,
        /// `high`'s facility to `low` (`high` is the creditor).
        pub high_line: Option<Line>,
    }

    impl Pair {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.low, self.high, self.asset_id)
        }

        #[secondary_key(1)]
        fn by_high(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.high, self.low, self.asset_id)
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
    #[table(name = "CashQuoteTab", index = 7)]
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
    #[table(name = "BanxInviteTable", index = 8)]
    #[derive(Default, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct BanxInvite {
        #[primary_key]
        pub id: u32,
        pub inviter: AccountNumber,
        pub asset_id: u16,
        pub limit: Quantity,
        pub deplete_on_debit: bool,
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
    #[table(name = "BookAuthTab", index = 9)]
    #[derive(
        Default, Clone, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct BookAuth {
        pub debtor: AccountNumber,
        pub creditor: AccountNumber,
        pub asset_id: u16,
        /// Live budget the creditor may still book. 0 means spent; row stays so it can be topped up.
        pub remaining: Quantity,
        /// Absolute expiry (`seconds == 0` → never).
        pub expires_at: TimePointSec,
    }

    impl BookAuth {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, u16) {
            (self.debtor, self.creditor, self.asset_id)
        }
    }

    /// Repeating path payment. The payer signs once. A later `run` draws
    /// the payer and delivers `amount` to the payee. One row is one series.
    #[table(name = "PayAuthTab", index = 10)]
    #[derive(
        Default, Clone, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug,
    )]
    pub struct PayAuth {
        #[primary_key]
        pub id: u32,
        /// Drawn on each paid period. `get_sender()` at create.
        pub payer: AccountNumber,
        /// Receives `amount`. Last hop of a run.
        pub payee: AccountNumber,
        /// Asset the payee receives. Every hop must use it.
        pub asset_id: u16,
        /// Delivered to the payee for one period.
        pub amount: Quantity,
        /// Most the payer will be drawn for one period, same asset. At least `amount`.
        pub max_spend: Quantity,
        /// Length of one period. Greater than 0.
        pub period_seconds: u32,
        /// Start of the oldest period that has not been paid.
        pub next_due: TimePointSec,
        /// A period may be paid only when its start is before this. 0 means no scheduled end.
        pub ends_at: TimePointSec,
    }

    /// Constant-product curve between two Banx assets, posted by `owner`.
    ///
    /// Both reserves are virtual weights. A path that changes asset on
    /// `owner` uses this curve instead of a [`FxOffer`] for the pair.
    /// One row prices both directions. `asset_lo` is the lower asset id.
    #[table(name = "BanxRelayTable", index = 11)]
    #[derive(
        Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone,
    )]
    pub struct BanxRelay {
        pub owner: AccountNumber,
        pub asset_lo: u16,
        pub asset_hi: u16,
        pub reserve_lo: Quantity,
        pub reserve_hi: Quantity,
    }

    impl BanxRelay {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u16, u16) {
            (self.owner, self.asset_lo, self.asset_hi)
        }
    }

    /// Constant-product curve between one Banx asset and one token.
    ///
    /// `reserve_banx` is the virtual Banx weight. The token reserve is the
    /// balance in `{owner}/{asset_id}/{token_id}`, filled when the pool is
    /// posted. One owner has one pool per pair.
    #[table(name = "TokenRelayTable", index = 12)]
    #[derive(
        Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone,
    )]
    pub struct TokenRelay {
        pub owner: AccountNumber,
        pub asset_id: u16,
        pub token_id: u32,
        pub reserve_banx: Quantity,
    }

    impl TokenRelay {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u16, u32) {
            (self.owner, self.asset_id, self.token_id)
        }
    }
}

pub use tables::*;
