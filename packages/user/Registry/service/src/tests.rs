#[cfg(test)]
mod tests {
    use crate::*;
    use constants::app_status;
    use constants::MAX_NAME_SIZE;
    use psibase::{
        account, AccountNumber,
        services::http_server,
        ChainEmptyResult, TimePointUSec,
    };
    use serde::Deserialize;
    use serde_json::Value;
    use service::AppMetadata;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AppMetadataResponse {
        account_id: AccountNumber,
        name: String,
        short_desc: String,
        long_desc: String,
        icon: String,
        icon_mime_type: String,
        status: u32,
        created_at: Value,
    }

    fn default_metadata() -> AppMetadata {
        AppMetadata {
            account_id: account!("cooking"),
            status: app_status::DRAFT,
            created_at: TimePointUSec::from(0),
            name: "Super Cooking App".to_string(),
            short_desc: "Alice's Cooking App".to_string(),
            long_desc: "Super cooking app".to_string(),
            icon: "icon-as-base64".to_string(),
            icon_mime_type: "image/png".to_string(),
        }
    }

    fn default_tags() -> Vec<String> {
        vec![
            "cozy".to_string(),
            "cuisine".to_string(),
            "cooking".to_string(),
        ]
    }

    fn push_set_metadata(
        chain: &psibase::Chain,
        metadata: AppMetadata,
        tags: Vec<String>,
    ) -> ChainEmptyResult {
        let res = Wrapper::push_from(chain, account!("alice")).setMetadata(
            metadata.name,
            metadata.short_desc,
            metadata.long_desc,
            metadata.icon,
            metadata.icon_mime_type,
            tags,
        );
        chain.finish_block();
        res
    }

    #[psibase::test_case(packages("Registry"))]
    fn test_set_metadata_simple(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("bob"))?;

        push_set_metadata(&chain, default_metadata(), default_tags()).get()?;

        http_server::Wrapper::push_from(&chain, Wrapper::SERVICE)
            .registerServer(account!("r-registry"))
            .get()?;
        chain.finish_block();

        let response: Value = chain.graphql(
            Wrapper::SERVICE,
            r#"
                query {
                    appMetadata(accountId: "alice") {
                        accountId
                        name
                        shortDesc
                        longDesc
                        icon
                        iconMimeType
                        status
                        createdAt
                    }
                }
            "#,
        )?;
        let metadata: AppMetadataResponse = serde_json::from_value(
            response
                .get("data")
                .and_then(|d| d.get("appMetadata"))
                .cloned()
                .expect("appMetadata in response"),
        )
        .expect("valid appMetadata response");

        assert_eq!(metadata.account_id, account!("alice"));
        assert_eq!(metadata.name, "Super Cooking App");
        assert_eq!(metadata.short_desc, "Alice's Cooking App");
        assert_eq!(metadata.long_desc, "Super cooking app");
        assert_eq!(metadata.icon, "icon-as-base64");
        assert_eq!(metadata.icon_mime_type, "image/png");
        assert_eq!(metadata.status, app_status::DRAFT);
        assert_ne!(metadata.created_at, Value::Null);

        Ok(())
    }

    #[psibase::test_case(packages("Registry"))]
    fn test_tags_max_limit(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("bob"))?;

        let mut tags = default_tags();
        tags.push("new-tag".to_string());

        let error = push_set_metadata(&chain, default_metadata(), tags)
            .trace
            .error
            .unwrap();
        assert!(error.contains("Max 3 tags per app"), "error = {}", error);

        Ok(())
    }

    #[psibase::test_case(packages("Registry"))]
    fn test_app_name_max_length(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("bob"))?;

        let mut metadata = default_metadata();
        metadata.name = "a".repeat(MAX_NAME_SIZE + 1);

        let error = push_set_metadata(&chain, metadata, default_tags())
            .trace
            .error
            .unwrap();
        assert!(
            error.contains(
                format!(
                    "App name can only be up to {} characters long",
                    MAX_NAME_SIZE
                )
                .as_str()
            ),
            "error = {}",
            error
        );

        Ok(())
    }
}
