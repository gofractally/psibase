#[cfg(test)]
mod tests {
    use crate::*;
    use constants::app_status;
    use constants::MAX_APP_NAME_LENGTH;
    use psibase::{account, AccountNumber, ChainEmptyResult, TimePointUSec};
    use service::{AppMetadata, TagRecord};

    fn default_metadata() -> AppMetadata {
        AppMetadata {
            account_id: AccountNumber::new(0),
            status: app_status::DRAFT,
            created_at: TimePointUSec::from(0),
            redirect_uris: vec!["http://localhost:3000/callback".to_string()],
            owners: vec![account!("alice"), account!("bob")],
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
        Wrapper::push_from(chain, account!("alice")).setMetadata(
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
            metadata.owners,
        )
    }

    #[psibase::test_case(packages("Registry"))]
    fn test_set_metadata_simple(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("bob"))?;

        push_set_metadata(&chain, default_metadata(), default_tags()).get()?;

        let app_metadata_with_tags = Wrapper::push(&chain)
            .getMetadata(account!("alice"))
            .get()?
            .unwrap();

        let metadata = app_metadata_with_tags.metadata;
        let tags = app_metadata_with_tags.tags;

        assert_eq!(metadata.name, "Super Cooking App");
        assert_eq!(metadata.short_description, "Alice's Cooking App");
        assert_eq!(metadata.long_description, "Super cooking app");
        assert_eq!(metadata.icon, "icon-as-base64");
        assert_eq!(metadata.icon_mime_type, "image/png");
        assert_eq!(metadata.tos_subpage, "/tos");
        assert_eq!(metadata.privacy_policy_subpage, "/privacy-policy");
        assert_eq!(metadata.app_homepage_subpage, "/");
        assert_eq!(metadata.status, 0);
        assert_eq!(metadata.status, app_status::DRAFT);

        assert_eq!(tags.len(), 3);
        assert!(tags.contains(&TagRecord {
            id: 1,
            tag: "cozy".to_string(),
        }));
        assert!(tags.contains(&TagRecord {
            id: 2,
            tag: "cuisine".to_string(),
        }));
        assert!(tags.contains(&TagRecord {
            id: 3,
            tag: "cooking".to_string(),
        }));

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
