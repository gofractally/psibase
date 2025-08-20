#[cfg(test)]
mod tests {
    use crate::*;
    use constants::app_status;
    use constants::MAX_NAME_SIZE;
    use psibase::services::http_server;
    use psibase::{account, ChainEmptyResult, TimePointUSec};
    use serde_json::{json, Value};
    use service::AppMetadata;

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
            metadata.short_desc,
            metadata.long_desc,
            metadata.icon,
            metadata.icon_mime_type,
            metadata.tos_subpage,
            metadata.privacy_policy_subpage,
            metadata.app_homepage_subpage,
            tags,
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
                        shortDesc,
                        longDesc,
                        icon,
                        iconMimeType,
                        tosSubpage,
                        privacyPolicySubpage,
                        appHomepageSubpage,
                        status,
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
                    "shortDesc": "Alice's Cooking App",
                    "longDesc": "Super cooking app",
                    "icon": "icon-as-base64",
                    "iconMimeType": "image/png",
                    "tosSubpage": "/tos",
                    "privacyPolicySubpage": "/privacy-policy",
                    "appHomepageSubpage": "/",
                    "status": "Draft",
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
