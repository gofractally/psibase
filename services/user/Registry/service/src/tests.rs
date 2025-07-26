#[cfg(test)]
mod tests {
    use crate::*;
    use constants::app_status;
    use constants::MAX_APP_NAME_LENGTH;
    use psibase::services::http_server;
    use psibase::{account, ChainEmptyResult, TimePointUSec};
    use serde_json::{json, Value};
    use service::AppMetadata;

    fn default_metadata() -> AppMetadata {
        AppMetadata {
            account_id: account!("cooking"),
            status: app_status::DRAFT,
            created_at: TimePointUSec::from(0),
            redirect_uris: vec!["http://localhost:3000/callback".to_string()],
            name: "Super Cooking App".to_string(),
            short_description: "Alice's Cooking App".to_string(),
            long_description: "Super cooking app".to_string(),
            icon: "icon-as-base64".to_string(),
            icon_mime_type: "image/png".to_string(),
            tos_subpage: "/tos".to_string(),
            privacy_policy_subpage: "/privacy-policy".to_string(),
            app_homepage_subpage: "/".to_string(),
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
            metadata.short_description,
            metadata.long_description,
            metadata.icon,
            metadata.icon_mime_type,
            metadata.tos_subpage,
            metadata.privacy_policy_subpage,
            metadata.app_homepage_subpage,
            tags,
            metadata.redirect_uris,
        );
        chain.finish_block();
        res
    }

    #[psibase::test_case(packages("Registry"))]
    fn test_set_metadata_simple(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("bob"))?;
        http_server::Wrapper::push_from(&chain, SERVICE).registerServer(account!("r-registry"));

        push_set_metadata(&chain, default_metadata(), default_tags()).get()?;

        let reply: Value = chain.graphql(
            SERVICE,
            &format!(
                r#"query {{
                    appMetadata(accountId: "{account}") {{
                        accountId,
                        name,
                        shortDescription,
                        longDescription,
                        icon,
                        iconMimeType,
                        tosSubpage,
                        privacyPolicySubpage,
                        appHomepageSubpage,
                        status,
                        redirectUris,
                        createdAt,
                        tags
                    }}
                }}"#,
                account = "alice"
            ),
        )?;

        assert_eq!(
            reply,
            json!({ "data": {
                "appMetadata": {
                    "accountId": "alice",
                    "name": "Super Cooking App",
                    "shortDescription": "Alice's Cooking App",
                    "longDescription": "Super cooking app",
                    "icon": "icon-as-base64",
                    "iconMimeType": "image/png",
                    "tosSubpage": "/tos",
                    "privacyPolicySubpage": "/privacy-policy",
                    "appHomepageSubpage": "/",
                    "status": 0,
                    "redirectUris": ["http://localhost:3000/callback"],
                    "createdAt": "1970-01-01T00:00:04+00:00",
                    "tags": [
                        "cozy",
                        "cuisine",
                        "cooking"
                    ]
                }
            }})
        );

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
        assert!(
            error.contains("App can only have up to 3 tags"),
            "error = {}",
            error
        );

        Ok(())
    }

    #[psibase::test_case(packages("Registry"))]
    fn test_app_name_max_length(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("bob"))?;

        let mut metadata = default_metadata();
        metadata.name = "a".repeat(MAX_APP_NAME_LENGTH + 1);

        let error = push_set_metadata(&chain, metadata, default_tags())
            .trace
            .error
            .unwrap();
        assert!(
            error.contains(
                format!(
                    "App name can only be up to {} characters long",
                    MAX_APP_NAME_LENGTH
                )
                .as_str()
            ),
            "error = {}",
            error
        );

        Ok(())
    }
}
