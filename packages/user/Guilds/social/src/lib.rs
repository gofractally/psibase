pub mod tables;

#[cfg(test)]
mod tests;

use tables::tables::{
    Config, ConfigTable, IdTable, Moderator, ModeratorTable, Post, PostTable, Reader, ReaderTable,
    Thread, ThreadTable,
};

use fractals::Wrapper as Fractals;
use guilds::Wrapper as Guilds;
use psibase::services::diff_adjust::Wrapper as Diff;
use psibase::services::fractals::FractalRole;
use psibase::services::nft::Wrapper as Nft;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::services::transact::Wrapper as Transact;
use psibase::{get_sender, AccountNumber, Memo, ServiceWrapper, Subaccount, Table};

const PPM: u64 = 1_000_000;
/// 130% of the last bid.
const NEXT_PPM: u64 = 1_300_000;
/// 110% of the last bid returns to the previous bidder.
const RETURN_PPM: u64 = 1_100_000;
/// 10% burns, and 10% pays the author.
const CUT_PPM: u64 = 100_000;

const MAX_SUBJECT: usize = 80;
const MAX_SHORT: usize = 280;
const MAX_ARTICLE: usize = 20_000;
const DEFAULT_BID_SECONDS: u32 = 7 * 86_400;

fn now() -> psibase::TimePointSec {
    Transact::call().currentBlock().time.seconds()
}

fn guild_fractal(account: AccountNumber) -> Option<AccountNumber> {
    Guilds::call().guild_fractal(account.base())
}

fn is_guild_member(guild: AccountNumber, account: AccountNumber) -> bool {
    Guilds::call().get_member(guild, account).is_some()
}

fn is_fractal_member(fractal: AccountNumber, account: AccountNumber) -> bool {
    Fractals::call().is_member(fractal, account)
}

fn is_exiled(fractal: AccountNumber, account: AccountNumber) -> bool {
    Fractals::call().is_exiled(fractal, account)
}

fn judiciary(fractal: AccountNumber) -> AccountNumber {
    fractal.with_subaccount(Subaccount(FractalRole::Judiciary as u8))
}

fn token_id(fractal: AccountNumber) -> u32 {
    Fractals::call()
        .get(fractal)
        .expect("fractal does not exist")
        .token_id
}

pub(crate) fn of_ppm(amount: u64, ppm: u64) -> u64 {
    ((amount as u128).saturating_mul(ppm as u128) / PPM as u128) as u64
}

fn take(token: u32, from: AccountNumber, amount: Quantity, memo: &str) {
    assert!(amount.value > 0, "amount must be greater than 0");
    Tokens::call().debit(token, from, amount, memo.into());
}

fn pay(token: u32, to: AccountNumber, amount: Quantity, memo: &str) {
    if amount.value == 0 {
        return;
    }
    Tokens::call().credit(token, to, amount, memo.into());
}

impl Reader {
    fn save(&self) {
        ReaderTable::read_write().put(self).unwrap();
    }
}

impl Moderator {
    fn save(&self) {
        ModeratorTable::read_write().put(self).unwrap();
    }
}

impl Config {
    fn get(fractal: AccountNumber) -> Self {
        ConfigTable::read()
            .get_index_pk()
            .get(&fractal)
            .unwrap_or(Self {
                fractal,
                open_to_public: false,
            })
    }

    fn save(&self) {
        ConfigTable::read_write().put(self).unwrap();
    }
}

impl Thread {
    fn get(fractal: AccountNumber, account: AccountNumber) -> Option<Self> {
        ThreadTable::read().get_index_pk().get(&(fractal, account))
    }

    fn get_assert(fractal: AccountNumber, account: AccountNumber) -> Self {
        Self::get(fractal, account).expect("thread does not exist")
    }

    fn save(&self) {
        ThreadTable::read_write().put(self).unwrap();
    }

    fn can_see(&self, account: AccountNumber) -> bool {
        if is_exiled(self.fractal, account) {
            return false;
        }
        if is_moderator(self.fractal, self.account, account) {
            return true;
        }
        if self.public && Config::get(self.fractal).open_to_public {
            return true;
        }
        if self.public && is_fractal_member(self.fractal, account) {
            return true;
        }
        readers(self.fractal, self.account)
            .into_iter()
            .any(|reader| is_guild_member(reader.guild, account))
    }
}

fn readers(fractal: AccountNumber, thread: AccountNumber) -> Vec<Reader> {
    ReaderTable::read()
        .get_index_pk()
        .range((fractal, thread, AccountNumber::MIN)..=(fractal, thread, AccountNumber::MAX))
        .collect()
}

/// The judiciary role account, or the exact moderator guild. Role subaccounts do not match.
fn is_moderator(fractal: AccountNumber, thread: AccountNumber, account: AccountNumber) -> bool {
    if account == judiciary(fractal) {
        return true;
    }
    if account.is_subaccount() {
        return false;
    }
    let Some(home) = guild_fractal(account) else {
        return false;
    };
    home == fractal
        && ModeratorTable::read()
            .get_index_pk()
            .get(&(fractal, thread, account))
            .is_some()
}

fn assert_moderator(fractal: AccountNumber, thread: AccountNumber) {
    assert!(
        is_moderator(fractal, thread, get_sender()),
        "not a moderator of this thread",
    );
}

fn assert_fractal_account(fractal: AccountNumber) {
    assert!(
        get_sender() == fractal,
        "only the fractal account can change this",
    );
}

fn assert_judiciary(fractal: AccountNumber) {
    assert!(
        get_sender() == judiciary(fractal),
        "only the fractal judiciary can change this",
    );
}

fn bidding_closed(post: &Post) -> bool {
    let seconds = Thread::get_assert(post.fractal, post.thread).bid_seconds as i64;
    now().seconds >= post.created_at.seconds + seconds
}

fn guild_in_fractal(fractal: AccountNumber, guild: AccountNumber) -> AccountNumber {
    let home = guild_fractal(guild).expect("not a guild");
    assert!(home == fractal, "guild is in another fractal");
    guild.base()
}

fn next_post_id() -> u32 {
    let mut ids = IdTable::read().get_index_pk().get(&()).unwrap_or_default();
    ids.next_post += 1;
    let id = ids.next_post;
    IdTable::read_write().put(&ids).unwrap();
    id
}

impl Post {
    fn get(id: u32) -> Self {
        PostTable::read()
            .get_index_pk()
            .get(&id)
            .expect("post does not exist")
    }

    fn save(&self) {
        PostTable::read_write().put(self).unwrap();
    }
}

/// Next bid. 1,300,000 ppm of the current price, at least 1 raw above it.
pub fn next_price(stake: u64) -> u64 {
    of_ppm(stake, NEXT_PPM).max(stake.saturating_add(1))
}

#[psibase::service(tables = "tables::tables", recursive = true)]
pub mod service {
    use super::*;

    /// Legislature flag. When off, a public thread is visible to fractal members, not to outsiders.
    #[action]
    fn set_open(fractal: AccountNumber, open: bool) {
        assert_fractal_account(fractal);
        let _ = token_id(fractal);
        Config {
            fractal,
            open_to_public: open,
        }
        .save();
    }

    /// A guild creates a thread in its fractal. It starts as a reader and a moderator.
    ///
    /// The posting fee is a DiffAdjust difficulty, in fractal-token raw units. Social holds
    /// the admin NFT and is the consumer. A moderator adjusts the curve through set_fee.
    #[action]
    fn create_thread(
        account: AccountNumber,
        title: Memo,
        public: bool,
        initial_fee: u64,
        window_seconds: u32,
    ) {
        let fractal = guild_fractal(get_sender()).expect("sender is not a guild");
        let guild = get_sender().base();
        assert!(
            account.value != 0 && !account.is_subaccount(),
            "thread account is empty or a subaccount",
        );
        assert!(title.to_string().len() > 0, "title is empty");
        assert!(
            Thread::get(fractal, account).is_none(),
            "thread already exists in this fractal",
        );
        if public {
            assert!(
                Config::get(fractal).open_to_public,
                "fractal does not allow public threads",
            );
        }
        assert!(initial_fee > 0, "posting fee must be greater than 0");
        assert!(window_seconds > 0, "window must be greater than 0");

        let fee_nft = Diff::call().create(
            initial_fee,
            window_seconds,
            1,
            8,
            initial_fee,
            100_000,
            50_000,
        );
        // DiffAdjust credits the admin NFT but keeps ownership. Take it, or set_fee cannot run.
        Nft::call().debit(fee_nft, "Thread fee".into());

        Thread {
            fractal,
            account,
            title,
            creator: guild,
            public,
            fee_nft,
            bid_seconds: DEFAULT_BID_SECONDS,
            created_at: now(),
        }
        .save();
        Reader {
            fractal,
            thread: account,
            guild,
        }
        .save();
        Moderator {
            fractal,
            thread: account,
            guild,
        }
        .save();
    }

    /// Judiciary adds or removes a reader guild. The sender is the judiciary role account.
    #[action]
    fn set_reader(
        fractal: AccountNumber,
        thread: AccountNumber,
        guild: AccountNumber,
        allow: bool,
    ) {
        assert_judiciary(fractal);
        Thread::get_assert(fractal, thread);
        let guild = guild_in_fractal(fractal, guild);
        let row = Reader {
            fractal,
            thread,
            guild,
        };
        if allow {
            row.save();
        } else if ReaderTable::read()
            .get_index_pk()
            .get(&(row.fractal, row.thread, row.guild))
            .is_some()
        {
            ReaderTable::read_write().remove(&row);
        }
    }

    /// Judiciary adds or removes a moderator guild. The fractal judiciary always moderates.
    #[action]
    fn set_mod(fractal: AccountNumber, thread: AccountNumber, guild: AccountNumber, allow: bool) {
        assert_judiciary(fractal);
        Thread::get_assert(fractal, thread);
        let guild = guild_in_fractal(fractal, guild);
        let row = Moderator {
            fractal,
            thread,
            guild,
        };
        if allow {
            row.save();
        } else if ModeratorTable::read()
            .get_index_pk()
            .get(&(row.fractal, row.thread, row.guild))
            .is_some()
        {
            ModeratorTable::read_write().remove(&row);
        }
    }

    /// A moderator marks the thread public. Outsiders still need the legislature flag.
    #[action]
    fn set_public(fractal: AccountNumber, thread: AccountNumber, public: bool) {
        let mut row = Thread::get_assert(fractal, thread);
        assert_moderator(fractal, thread);
        if public {
            assert!(
                Config::get(fractal).open_to_public,
                "fractal does not allow public threads",
            );
        }
        row.public = public;
        row.save();
    }

    /// Moderator adjusts the posting-fee curve. Social holds the admin NFT.
    #[action]
    fn set_fee(
        fractal: AccountNumber,
        thread: AccountNumber,
        window_seconds: u32,
        target_min: u32,
        target_max: u32,
        floor: u64,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) {
        let row = Thread::get_assert(fractal, thread);
        assert_moderator(fractal, thread);
        assert!(floor > 0, "posting fee floor must be greater than 0");
        Diff::call().set_window(row.fee_nft, window_seconds);
        Diff::call().set_targets(row.fee_nft, target_min, target_max);
        Diff::call().set_floor(row.fee_nft, floor);
        Diff::call().set_ppm(row.fee_nft, increase_ppm, decrease_ppm);
    }

    /// A moderator sets how long bidding stays open after a post.
    #[action]
    fn set_bid_secs(fractal: AccountNumber, thread: AccountNumber, seconds: u32) {
        let mut row = Thread::get_assert(fractal, thread);
        assert_moderator(fractal, thread);
        assert!(seconds > 0, "bidding period must be greater than 0");
        row.bid_seconds = seconds;
        row.save();
    }

    /// Live posting fee, after any window decay.
    #[action]
    fn fee(fractal: AccountNumber, thread: AccountNumber) -> u64 {
        Diff::call().get_diff(Thread::get_assert(fractal, thread).fee_nft)
    }

    /// Post. `paid` must be the live posting fee. The fee goes to the creating guild and is the opening price.
    ///
    /// An empty subject is a short post. A subject makes it an article.
    /// The author is the first bidder. Bidding closes after the thread's bid_seconds.
    #[action]
    fn post(
        fractal: AccountNumber,
        thread: AccountNumber,
        subject: String,
        body: String,
        paid: u64,
    ) {
        let author = get_sender().base();
        let row = Thread::get_assert(fractal, thread);
        assert!(row.can_see(author), "thread is not visible to you");
        assert!(!body.is_empty(), "post is empty");
        if subject.is_empty() {
            assert!(body.len() <= MAX_SHORT, "short post is too long");
        } else {
            assert!(subject.len() <= MAX_SUBJECT, "subject is too long");
            assert!(body.len() <= MAX_ARTICLE, "article is too long");
        }

        let fee = Diff::call().increment(row.fee_nft, 1);
        assert!(fee > 0, "posting fee is 0");
        assert!(paid == fee, "paid amount is not the posting fee");
        let token = token_id(fractal);
        take(token, author, fee.into(), "Thread post");
        pay(token, row.creator, fee.into(), "Thread post");

        Post {
            id: next_post_id(),
            fractal,
            thread,
            author,
            subject,
            body,
            last_bid: fee.into(),
            bidder: author,
            created_at: now(),
            removed: false,
            nft: None,
        }
        .save();
    }

    /// A moderator hides a post. Money already paid is not unwound.
    #[action]
    fn rm_post(id: u32) {
        let mut post = Post::get(id);
        assert!(!post.removed, "post already removed");
        assert_moderator(post.fractal, post.thread);
        post.removed = true;
        post.save();
    }

    /// Bid 130% of the current price.
    ///
    /// 110% of the previous price returns to the previous bidder, 10% burns, 10% pays the author.
    /// The new price is what this bidder paid.
    #[action]
    fn bid(id: u32, paid: u64) {
        let bidder = get_sender().base();
        let mut post = Post::get(id);
        assert!(!post.removed, "post was removed");
        assert!(post.nft.is_none(), "post was claimed");
        assert!(!bidding_closed(&post), "bidding has closed");
        let thread = Thread::get_assert(post.fractal, post.thread);
        assert!(thread.can_see(bidder), "thread is not visible to you");
        assert!(bidder != post.bidder, "you already hold this bid");

        let price = next_price(post.last_bid.value);
        assert!(paid == price, "paid amount is not the next bid");
        let returned = of_ppm(post.last_bid.value, RETURN_PPM);
        let burned = of_ppm(post.last_bid.value, CUT_PPM);
        let author_cut = of_ppm(post.last_bid.value, CUT_PPM);

        let token = token_id(post.fractal);
        // Integer division leaves a remainder. Burn it with the 10% so nothing sits on social.
        let dust = price - returned - burned - author_cut;
        take(token, bidder, price.into(), "Post bid");
        pay(token, post.bidder, returned.into(), "Outbid");
        pay(token, post.author, author_cut.into(), "Post bid");
        if burned + dust > 0 {
            Tokens::call().burn(token, (burned + dust).into(), "Post bid".into());
        }

        post.last_bid = price.into();
        post.bidder = bidder;
        post.save();
    }

    /// After bidding closes, the last bidder takes an NFT that stands for the post.
    ///
    /// Credit leaves the NFT pending. The bidder still has to accept it.
    #[action]
    fn claim(id: u32) -> u32 {
        let mut post = Post::get(id);
        assert!(!post.removed, "post was removed");
        assert!(post.nft.is_none(), "post was already claimed");
        assert!(bidding_closed(&post), "bidding is still open");
        assert!(
            get_sender().base() == post.bidder,
            "only the last bidder can claim"
        );

        let nft_id = Nft::call().mint(None);
        Nft::call().credit(nft_id, post.bidder, "Thread post".into());
        post.nft = Some(nft_id);
        post.save();
        nft_id
    }
}
