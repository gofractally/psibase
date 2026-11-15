#[psibase::service(name = "social+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::connection::Connection;
    use async_graphql::Object;
    use psibase::*;
    use social::tables::tables::{
        Config, ConfigTable, Moderator, ModeratorTable, Post, PostTable, Reader, ReaderTable, Thread,
        ThreadTable,
    };

    struct Query;

    struct RankedThread {
        account: AccountNumber,
        title: String,
        fee: u64,
    }

    #[Object]
    impl RankedThread {
        async fn account(&self) -> &AccountNumber {
            &self.account
        }

        async fn title(&self) -> &String {
            &self.title
        }

        async fn fee(&self) -> u64 {
            self.fee
        }
    }

    #[Object]
    impl Query {
        async fn config(&self, fractal: AccountNumber) -> Option<Config> {
            ConfigTable::with_service(social::SERVICE)
                .get_index_pk()
                .get(&fractal)
        }

        async fn thread(&self, fractal: AccountNumber, account: AccountNumber) -> Option<Thread> {
            ThreadTable::with_service(social::SERVICE)
                .get_index_pk()
                .get(&(fractal, account))
        }

        async fn threads(
            &self,
            fractal: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Thread>> {
            TableQuery::subindex::<AccountNumber>(
                ThreadTable::with_service(social::SERVICE).get_index_pk(),
                &fractal,
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        async fn readers(&self, fractal: AccountNumber, thread: AccountNumber) -> Vec<Reader> {
            ReaderTable::with_service(social::SERVICE)
                .get_index_pk()
                .range((fractal, thread, AccountNumber::MIN)..=(fractal, thread, AccountNumber::MAX))
                .collect()
        }

        async fn moderators(
            &self,
            fractal: AccountNumber,
            thread: AccountNumber,
        ) -> Vec<Moderator> {
            ModeratorTable::with_service(social::SERVICE)
                .get_index_pk()
                .range((fractal, thread, AccountNumber::MIN)..=(fractal, thread, AccountNumber::MAX))
                .collect()
        }

        async fn posts(
            &self,
            fractal: AccountNumber,
            thread: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Post>> {
            TableQuery::subindex::<u32>(
                PostTable::with_service(social::SERVICE).get_index_by_thread(),
                &(fractal, thread),
            )
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
        }

        /// Highest live posting fee first. That is the cost to open a post.
        async fn ranked(&self, fractal: AccountNumber) -> async_graphql::Result<Vec<RankedThread>> {
            let connection = TableQuery::subindex::<AccountNumber>(
                ThreadTable::with_service(social::SERVICE).get_index_pk(),
                &fractal,
            )
            .first(Some(200))
            .query()
            .await?;
            let mut rows: Vec<RankedThread> = connection
                .edges
                .into_iter()
                .map(|edge| RankedThread {
                    fee: social::Wrapper::call().fee(fractal, edge.node.account),
                    account: edge.node.account,
                    title: edge.node.title.to_string(),
                })
                .collect();
            rows.sort_by(|left, right| {
                right
                    .fee
                    .cmp(&left.fee)
                    .then(left.account.to_string().cmp(&right.account.to_string()))
            });
            Ok(rows)
        }

        async fn fee(&self, fractal: AccountNumber, thread: AccountNumber) -> u64 {
            social::Wrapper::call().fee(fractal, thread)
        }

        async fn post(&self, id: u32) -> Option<Post> {
            PostTable::with_service(social::SERVICE)
                .get_index_pk()
                .get(&id)
        }

        /// Newest posts that have not been removed. Removed rows do not take a slot.
        async fn feed(&self, fractal: AccountNumber, thread: AccountNumber) -> Vec<Post> {
            let mut rows: Vec<Post> = PostTable::with_service(social::SERVICE)
                .get_index_by_thread()
                .range((fractal, thread, 0)..=(fractal, thread, u32::MAX))
                .filter(|post| !post.removed)
                .collect();
            rows.reverse();
            rows.truncate(50);
            rows
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
