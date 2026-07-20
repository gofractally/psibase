use psibase::{sha256, AccountNumber, Table};

use crate::tables::{
    SpaceMemberRow, SpaceMemberTable, SpaceRow, SpaceTable, SPACE_KIND_DM, SPACE_KIND_GROUP,
};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SpaceError {
    #[error("{0}")]
    InvalidMemberSet(String),
    #[error("{0}")]
    UnknownSpace(String),
    #[error("{0}")]
    NotMember(String),
}

pub fn canonical_space_members(
    members: impl IntoIterator<Item = AccountNumber>,
) -> Vec<AccountNumber> {
    let mut members: Vec<AccountNumber> = members.into_iter().collect();
    members.sort_by_key(|member| member.value);
    members.dedup_by_key(|member| member.value);
    members
}

pub fn canonical_space_members_with_sender(
    sender: AccountNumber,
    members: impl IntoIterator<Item = AccountNumber>,
) -> Vec<AccountNumber> {
    canonical_space_members(std::iter::once(sender).chain(members))
}

pub fn validate_space_members(members: &[AccountNumber]) -> Result<(), SpaceError> {
    if members.len() < 2 {
        return Err(SpaceError::InvalidMemberSet(
            "space requires at least two members".into(),
        ));
    }
    Ok(())
}

pub fn space_kind_for_members(members: &[AccountNumber]) -> Result<u8, SpaceError> {
    validate_space_members(members)?;
    Ok(if members.len() == 2 {
        SPACE_KIND_DM
    } else {
        SPACE_KIND_GROUP
    })
}

pub fn space_id_for_members(members: &[AccountNumber]) -> Result<String, SpaceError> {
    validate_space_members(members)?;
    let encoded_members: Vec<String> = members.iter().map(ToString::to_string).collect();
    let bytes = serde_json::to_vec(&encoded_members)
        .map_err(|err| SpaceError::InvalidMemberSet(err.to_string()))?;
    Ok(format!("space:{}", sha256(&bytes)))
}

pub fn dm_members(
    sender: AccountNumber,
    other: AccountNumber,
) -> Result<Vec<AccountNumber>, SpaceError> {
    if sender == other {
        return Err(SpaceError::InvalidMemberSet(
            "dm member must be a different account".into(),
        ));
    }
    Ok(canonical_space_members([sender, other]))
}

pub fn group_members(
    sender: AccountNumber,
    others: impl IntoIterator<Item = AccountNumber>,
) -> Vec<AccountNumber> {
    canonical_space_members_with_sender(sender, others)
}

pub fn validate_group_members(members: &[AccountNumber]) -> Result<(), SpaceError> {
    if members.len() < 3 {
        return Err(SpaceError::InvalidMemberSet(
            "group space requires at least three members".into(),
        ));
    }
    Ok(())
}

pub fn sender_is_member(members: &[AccountNumber], sender: AccountNumber) -> bool {
    members.iter().any(|member| *member == sender)
}

pub fn space_exists(space_id: &str) -> bool {
    space_row(space_id).is_some()
}

pub fn space_row(space_id: &str) -> Option<SpaceRow> {
    SpaceTable::read()
        .get_index_pk()
        .get(&space_id.to_owned())
}

pub fn open_space(members: Vec<AccountNumber>, created_at: i64) -> Result<SpaceRow, SpaceError> {
    let members = canonical_space_members(members);
    let kind = space_kind_for_members(&members)?;
    if kind == SPACE_KIND_GROUP {
        validate_group_members(&members)?;
    }
    let space_id = space_id_for_members(&members)?;
    let space_table = SpaceTable::new();

    if let Some(existing) = space_table.get_index_pk().get(&space_id) {
        return Ok(existing);
    }

    let row = SpaceRow {
        space_id: space_id.clone(),
        kind,
        created_at,
    };
    space_table.put(&row).unwrap();

    let member_table = SpaceMemberTable::new();
    for member in members {
        member_table
            .put(&SpaceMemberRow {
                space_id: space_id.clone(),
                member,
            })
            .unwrap();
    }

    Ok(row)
}

pub fn ensure_sender_is_member(space_id: &str, sender: AccountNumber) -> Result<(), SpaceError> {
    if !space_exists(space_id) {
        return Err(SpaceError::UnknownSpace(format!(
            "unknown space {space_id}"
        )));
    }
    if is_space_member(space_id, sender) {
        Ok(())
    } else {
        Err(SpaceError::NotMember(format!(
            "account is not a member of space {space_id}"
        )))
    }
}

pub fn is_space_member(space_id: &str, member: AccountNumber) -> bool {
    SpaceMemberTable::read()
        .get_index_pk()
        .get(&(space_id.to_owned(), member))
        .is_some()
}

pub fn members_of(space_id: &str) -> Vec<AccountNumber> {
    SpaceMemberTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.space_id == space_id)
        .map(|row| row.member)
        .collect()
}

pub fn spaces_for_user(user: AccountNumber) -> Vec<SpaceRow> {
    let member_table = SpaceMemberTable::read();
    let space_table = SpaceTable::read();
    member_table
        .get_index_by_member_space()
        .iter()
        .filter(|row| row.member == user)
        .filter_map(|row| space_table.get_index_pk().get(&row.space_id))
        .collect()
}

pub fn space_with_members(row: SpaceRow) -> crate::tables::Space {
    let space_id = row.space_id.clone();
    crate::tables::Space {
        space_id: row.space_id,
        members: members_of(&space_id),
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn canonical_space_members_sorts_and_dedupes() {
        let bob: psibase::AccountNumber = "bob".parse().unwrap();
        let alice: psibase::AccountNumber = "alice".parse().unwrap();
        let members = canonical_space_members([bob, alice, bob]);
        assert_eq!(members, vec![alice, bob]);
    }

    #[test]
    fn space_id_is_stable_for_canonical_member_set() {
        let alice = "alice".parse().unwrap();
        let bob = "bob".parse().unwrap();
        let members_a = canonical_space_members([bob, alice]);
        let members_b = canonical_space_members([alice, bob]);
        let id_a = space_id_for_members(&members_a).unwrap();
        let id_b = space_id_for_members(&members_b).unwrap();
        assert_eq!(id_a, id_b);
        assert!(id_a.starts_with("space:"));
    }

    #[test]
    fn validate_space_members_requires_two() {
        let alice = "alice".parse().unwrap();
        let err = validate_space_members(&[alice]).unwrap_err();
        assert!(err.to_string().contains("at least two members"));
    }

    #[test]
    fn dm_members_rejects_self_dm() {
        let alice = "alice".parse().unwrap();
        let err = dm_members(alice, alice).unwrap_err();
        assert!(err.to_string().contains("different account"));
    }

    #[test]
    fn validate_group_members_requires_three() {
        let alice = "alice".parse().unwrap();
        let bob = "bob".parse().unwrap();
        let err = validate_group_members(&[alice, bob]).unwrap_err();
        assert!(err.to_string().contains("at least three members"));
    }

    #[test]
    fn space_kind_dm_vs_group() {
        let alice = "alice".parse().unwrap();
        let bob = "bob".parse().unwrap();
        let carol = "carol".parse().unwrap();
        assert_eq!(
            space_kind_for_members(&[alice, bob]).unwrap(),
            SPACE_KIND_DM
        );
        assert_eq!(
            space_kind_for_members(&[alice, bob, carol]).unwrap(),
            SPACE_KIND_GROUP
        );
    }
}
