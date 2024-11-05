#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use ::registry::service;
    use ::registry::Wrapper as ServiceWrapper;
    use async_graphql::*;
    use psibase::*;

    pub struct Query;

    #[Object]
    impl Query {
        /// Get the app metadata for a specific app ID, including the associated app tags
        async fn app_metadata(
            &self,
            account_id: AccountNumber,
        ) -> Option<service::AppMetadataWithTags> {
            ServiceWrapper::call()
                .getMetadata(account_id)
                .map(|res| service::AppMetadataWithTags {
                    metadata: res.metadata,
                    tags: res.tags,
                })
        }

        /// Get a list of tags that contain the given substring
        async fn all_related_tags(&self, tag_substr: String) -> service::RelatedTags {
            let tags = ServiceWrapper::call().getRelatedTags(tag_substr);
            tags
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_simple_ui::<ServiceWrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
