use psibase::{sha256, AccountNumber, Table};

use crate::tables::{
    SpaceMemberRow, SpaceMemberTable, SpaceRow, SpaceTable, SPACE_KIND_DM, SPACE_KIND_GROUP,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpaceError {
    InvalidMemberSet(String),
    UnknownSpace(String),
    NotMember(String),
}

impl SpaceError {
    pub fn message(&self) -> String {
        match self {
            SpaceError::InvalidMemberSet(msg) => msg.clone(),
            SpaceError::UnknownSpace(msg) => msg.clone(),
            SpaceError::NotMember(msg) => msg.clone(),
        }
    }
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

pub fn space_uuid_for_members(members: &[AccountNumber]) -> Result<String, SpaceError> {
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

pub fn space_exists(space_uuid: &str) -> bool {
    SpaceTable::read()
        .get_index_pk()
        .get(&space_uuid.to_owned())
        .is_some()
}

pub fn open_space(members: Vec<AccountNumber>, created_at: i64) -> Result<SpaceRow, SpaceError> {
    let members = canonical_space_members(members);
    let kind = space_kind_for_members(&members)?;
    if kind == SPACE_KIND_GROUP {
        validate_group_members(&members)?;
    }
    let space_uuid = space_uuid_for_members(&members)?;
    let space_table = SpaceTable::new();

    if let Some(existing) = space_table.get_index_pk().get(&space_uuid) {
        return Ok(existing);
    }

    let row = SpaceRow {
        space_uuid: space_uuid.clone(),
        kind,
        created_at,
    };
    space_table.put(&row).unwrap();

    let member_table = SpaceMemberTable::new();
    for member in members {
        member_table
            .put(&SpaceMemberRow {
                space_uuid: space_uuid.clone(),
                member,
            })
            .unwrap();
    }

    Ok(row)
}

pub fn ensure_sender_is_member(space_uuid: &str, sender: AccountNumber) -> Result<(), SpaceError> {
    if !space_exists(space_uuid) {
        return Err(SpaceError::UnknownSpace(format!(
            "unknown space {space_uuid}"
        )));
    }
    if is_space_member(space_uuid, sender) {
        Ok(())
    } else {
        Err(SpaceError::NotMember(format!(
            "account is not a member of space {space_uuid}"
        )))
    }
}

pub fn is_space_member(space_uuid: &str, member: AccountNumber) -> bool {
    SpaceMemberTable::read()
        .get_index_pk()
        .get(&(space_uuid.to_owned(), member))
        .is_some()
}

pub fn members_of(space_uuid: &str) -> Vec<AccountNumber> {
    SpaceMemberTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.space_uuid == space_uuid)
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
        .filter_map(|row| space_table.get_index_pk().get(&row.space_uuid))
        .collect()
}

pub fn space_with_members(row: SpaceRow) -> crate::tables::Space {
    let space_uuid = row.space_uuid.clone();
    crate::tables::Space {
        space_uuid: row.space_uuid,
        members: members_of(&space_uuid),
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use psibase::AccountNumber;

    #[test]
    fn canonical_space_members_sorts_and_dedupes() {
        let bob = AccountNumber::from("bob");
        let alice = AccountNumber::from("alice");
        let members = canonical_space_members([bob, alice, bob]);
        assert_eq!(members, vec![alice, bob]);
    }

    #[test]
    fn space_uuid_is_stable_for_canonical_member_set() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let members_a = canonical_space_members([bob, alice]);
        let members_b = canonical_space_members([alice, bob]);
        let uuid_a = space_uuid_for_members(&members_a).unwrap();
        let uuid_b = space_uuid_for_members(&members_b).unwrap();
        assert_eq!(uuid_a, uuid_b);
        assert!(uuid_a.starts_with("space:"));
    }

    #[test]
    fn validate_space_members_requires_two() {
        let alice = AccountNumber::from("alice");
        let err = validate_space_members(&[alice]).unwrap_err();
        assert!(err.message().contains("at least two members"));
    }

    #[test]
    fn dm_members_rejects_self_dm() {
        let alice = AccountNumber::from("alice");
        let err = dm_members(alice, alice).unwrap_err();
        assert!(err.message().contains("different account"));
    }

    #[test]
    fn validate_group_members_requires_three() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let err = validate_group_members(&[alice, bob]).unwrap_err();
        assert!(err.message().contains("at least three members"));
    }

    #[test]
    fn space_kind_dm_vs_group() {
        let alice = AccountNumber::from("alice");
        let bob = AccountNumber::from("bob");
        let carol = AccountNumber::from("carol");
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
