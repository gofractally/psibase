use crate::tables::tables::*;
use psibase::*;

pub fn process_tag(
    tag: &str,
    account_id: AccountNumber,
    existing_app_tags: &Vec<AppTag>,
) -> AppTag {
    if let Some(existing_tag) = find_existing_app_tag(tag, existing_app_tags) {
        existing_tag.clone()
    } else {
        create_new_app_tag(tag, account_id)
    }
}

pub fn create_new_app_tag(tag: &str, account_id: AccountNumber) -> AppTag {
    let app_tags_table = AppTagsTable::new();
    let tag_id = get_or_create_tag_id(tag);
    let new_app_tag = AppTag {
        app_id: account_id,
        tag_id,
    };
    app_tags_table.put(&new_app_tag).unwrap();
    new_app_tag
}

pub fn find_existing_app_tag(tag: &str, existing_app_tags: &Vec<AppTag>) -> Option<AppTag> {
    let tags_table = TagsTable::new();
    existing_app_tags
        .iter()
        .find(|at| {
            tags_table
                .get_index_pk()
                .get(&at.tag_id)
                .map(|tr| tr.tag == tag)
                .unwrap_or(false)
        })
        .cloned()
}

pub fn update_app_tags(account_id: AccountNumber, tags: &Vec<String>) {
    let app_tags_table = AppTagsTable::new();

    // Get existing app tags
    let existing_app_tags: Vec<AppTag> = app_tags_table
        .get_index_pk()
        .range((account_id, 0)..(account_id, u32::MAX))
        .collect();

    let mut new_app_tags = Vec::new();

    for tag in tags {
        let app_tag = process_tag(tag, account_id, &existing_app_tags);
        new_app_tags.push(app_tag);
    }

    remove_obsolete_tags(&existing_app_tags, &new_app_tags);
}

pub fn get_or_create_tag_id(tag: &str) -> u32 {
    let tags_table = TagsTable::new();
    let idx = tags_table.get_index_by_tags();
    let tag_str = tag.to_string();
    idx.get(&tag_str)
        .map(|tag_row| tag_row.id)
        .unwrap_or_else(|| create_new_tag(tag_str))
}

pub fn create_new_tag(tag: String) -> u32 {
    let tags_table = TagsTable::new();
    let new_id = tags_table
        .get_index_pk()
        .into_iter()
        .last()
        .map(|last_tag| last_tag.id + 1)
        .unwrap_or(1);
    let new_tag = TagRecord {
        id: new_id,
        tag: tag.to_string(),
    };
    new_tag.check_valid();
    tags_table.put(&new_tag).unwrap();
    new_id
}

pub fn remove_obsolete_tags(existing_app_tags: &[AppTag], new_app_tags: &[AppTag]) {
    let app_tags_table = AppTagsTable::new();
    for existing_tag in existing_app_tags {
        if !new_app_tags
            .iter()
            .any(|at| at.tag_id == existing_tag.tag_id)
        {
            app_tags_table.remove(existing_tag);

            // If there are no apps using the tag, remove the tag
            let tag_apps_count = app_tags_table
                .get_index_by_tag_id_apps()
                .range(
                    (existing_tag.tag_id, AccountNumber::new(0))
                        ..(existing_tag.tag_id + 1, AccountNumber::new(0)),
                )
                .count();
            if tag_apps_count == 0 {
                let tags_table = TagsTable::new();
                tags_table.erase(&existing_tag.tag_id);
            }
        }
    }
}
