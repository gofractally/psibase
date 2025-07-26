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
    use ::registry::service::{self, AppMetadataTable, TagRecord, TagsTable};
    use async_graphql::{connection::Connection, *};
    use psibase::*;
    use serde::Deserialize;
    use serde_aux::field_attributes::deserialize_number_from_string;
    use std::str::FromStr;

    #[derive(SimpleObject, Deserialize, Debug)]
    struct StatusUpdate {
        app_account_id: AccountNumber,
        #[serde(deserialize_with = "deserialize_number_from_string")]
        status: u32,
    }

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
        async fn related_tags(&self, tag: String) -> Vec<String> {
            let from = tag.to_lowercase();
            let excluded_to = increment_last_char(from.clone());

            TagsTable::with_service(service::SERVICE)
                .get_index_by_tags()
                .range(from..excluded_to)
                .take(10)
                .map(|tag_row| tag_row.tag)
                .collect()
        }

        /// Paginated query for retrieving all tags
        async fn get_all_tags(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, TagRecord>> {
            TableQuery::new(TagsTable::with_service(service::SERVICE).get_index_by_tags())
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        /// Paginated query for retrieving app status history
        async fn status_history(
            &self,
            app: String,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<u64, StatusUpdate>> {
            let app = ExactAccountNumber::from_str(&app).unwrap();
            EventQuery::new("history.registry.appStatusChanged")
                .condition(format!("app_account_id = '{}'", app))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
