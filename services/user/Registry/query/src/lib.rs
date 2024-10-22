#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use ::registry::service;
    use ::registry::Wrapper as ServiceWrapper;

    pub struct Query;

    #[Object]
    impl Query {
        /// Get the app metadata for a specific app ID
        async fn app_metadata(&self, account_id: AccountNumber) -> Option<service::AppMetadataWithTags> {
            println!("getting app_metadata: {}", account_id);
            ServiceWrapper::call()
                .getMetadata(account_id)
                .map(|res| service::AppMetadataWithTags {
                    metadata: res.metadata,
                    tags: res.tags,
                })
        }
        async fn all_related_tags(&self, tag: String) -> Option<service::RelatedTags> {
            let tags = ServiceWrapper::call().getRelatedTags(tag);
            tags
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
