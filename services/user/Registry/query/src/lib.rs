fn increment_last_char(s: String) -> String {
    let mut bytes = s.into_bytes();
    if let Some(last) = bytes.last_mut() {
        *last = *last + 1;
    }
    String::from_utf8(bytes).unwrap()
}

#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use super::increment_last_char;
    use ::registry::service::{self, AppMetadataTable, TagsTable};
    use async_graphql::*;
    use psibase::*;

    pub struct Query;

    #[Object]
    impl Query {
        /// Get the app metadata for a specific app ID
        async fn app_metadata(&self, account_id: AccountNumber) -> Option<service::AppMetadata> {
            AppMetadataTable::with_service(service::SERVICE)
                .get_index_pk()
                .get(&account_id)
        }

        /// Get a list of tags that contain the given substring
        async fn all_related_tags(&self, tag: String) -> Vec<String> {
            let from = tag.to_lowercase();
            let excluded_to = increment_last_char(from.clone());

            TagsTable::with_service(service::SERVICE)
                .get_index_by_tags()
                .range(from..excluded_to)
                .take(10)
                .map(|tag_row| tag_row.tag)
                .collect()
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
