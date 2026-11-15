#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{
        services::tokens::Quantity, AccountNumber, Memo, Pack, TimePointSec, ToSchema, Unpack,
    };
    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Config {
        #[primary_key]
        pub fractal: AccountNumber,
        /// Legislature flag. When false, a public thread is still members-only.
        pub open_to_public: bool,
    }

    #[table(name = "ThreadTable", index = 1)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Thread {
        pub fractal: AccountNumber,
        /// Account-shaped name, unique inside the fractal. Not a chain account.
        pub account: AccountNumber,
        pub title: Memo,
        pub creator: AccountNumber,
        pub public: bool,
        pub fee_nft: u32,
        /// How long bidding stays open after a post, in seconds.
        pub bid_seconds: u32,
        pub created_at: TimePointSec,
    }

    impl Thread {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber) {
            (self.fractal, self.account)
        }
    }

    /// Guilds allowed to read a thread. The creating guild starts here.
    #[table(name = "ReaderTable", index = 2)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Reader {
        pub fractal: AccountNumber,
        pub thread: AccountNumber,
        pub guild: AccountNumber,
    }

    impl Reader {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, AccountNumber) {
            (self.fractal, self.thread, self.guild)
        }
    }

    /// Guilds allowed to moderate. The fractal judiciary always moderates as well.
    #[table(name = "ModeratorTable", index = 3)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Moderator {
        pub fractal: AccountNumber,
        pub thread: AccountNumber,
        pub guild: AccountNumber,
    }

    impl Moderator {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, AccountNumber) {
            (self.fractal, self.thread, self.guild)
        }
    }

    #[table(name = "PostTable", index = 4)]
    #[derive(Default, Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Post {
        #[primary_key]
        pub id: u32,
        pub fractal: AccountNumber,
        pub thread: AccountNumber,
        pub author: AccountNumber,
        /// Empty for a short post. Set for an article.
        pub subject: String,
        pub body: String,
        /// Current bid. The next bid is 130% of this.
        pub last_bid: Quantity,
        pub bidder: AccountNumber,
        pub created_at: TimePointSec,
        pub removed: bool,
        /// Set when the last bidder claims the post. That is the only claimed state.
        pub nft: Option<u32>,
    }

    impl Post {
        #[secondary_key(1)]
        fn by_thread(&self) -> (AccountNumber, AccountNumber, u32) {
            (self.fractal, self.thread, self.id)
        }
    }

    #[table(name = "IdTable", index = 5)]
    #[derive(Default, Pack, Unpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Ids {
        pub next_post: u32,
    }

    impl Ids {
        #[primary_key]
        fn pk(&self) {}
    }
}
