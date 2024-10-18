#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use workshop;

    pub struct Query;

    #[derive(SimpleObject)]
    pub struct AppMetadataWithTags {
        // TODO: this is repetitive, duplication of service::AppMetadataWithTags
        pub metadata: workshop::service::AppMetadata,
        pub tags: Vec<workshop::service::TagRecord>,
    }

    #[Object]
    impl Query {
        /// Get the app metadata for a specific app ID
        async fn app_metadata(&self, account_id: AccountNumber) -> Option<AppMetadataWithTags> {
            println!("getting app_metadata: {}", account_id);
            workshop::Wrapper::call()
                .getMetadata(account_id)
                .map(|res| AppMetadataWithTags {
                    metadata: res.metadata,
                    tags: res.tags,
                })
        }
        async fn all_related_tags(&self, tag: String) -> Option<workshop::service::RelatedTags> {
            let tags = workshop::Wrapper::call().getRelatedTags(tag);
            tags
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
