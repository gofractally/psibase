#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    pub const SPACE_KIND_DM: u8 = 1;
    pub const SPACE_KIND_GROUP: u8 = 2;

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "SpaceTable", index = 1)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SpaceRow {
        #[primary_key]
        pub space_uuid: String,
        pub kind: u8,
        pub created_at: i64,
    }

    #[table(name = "SpaceMemberTable", index = 2)]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, ToSchema, Serialize, Deserialize)]
    pub struct SpaceMemberRow {
        pub space_uuid: String,
        pub member: AccountNumber,
    }

    impl SpaceMemberRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber) {
            (self.space_uuid.clone(), self.member)
        }

        #[secondary_key(1)]
        fn by_member_space(&self) -> (AccountNumber, String) {
            (self.member, self.space_uuid.clone())
        }
    }

    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Space {
        pub space_uuid: String,
        pub members: Vec<AccountNumber>,
    }
}

pub mod spaces;

#[psibase::service(name = "chat", tables = "tables")]
pub mod service {
    use crate::spaces::{
        dm_members, group_members, open_space, space_with_members, spaces_for_user,
        validate_group_members, SpaceError,
    };
    use crate::tables::{InitRow, InitTable, Space};
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::*;

    fn now_micros() -> i64 {
        TransactSvc::call()
            .currentBlock()
            .time
            .seconds()
            .microseconds()
            .microseconds
    }

    fn abort_on_space_err(result: Result<(), SpaceError>) {
        if let Err(err) = result {
            abort_message(&err.message());
        }
    }

    fn open_space_or_abort(members: Vec<AccountNumber>) -> crate::tables::SpaceRow {
        match open_space(members, now_micros()) {
            Ok(row) => row,
            Err(err) => abort_message(&err.message()),
        }
    }

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureSpace(members: Vec<AccountNumber>) -> Space {
        let sender = get_sender();
        let members = crate::spaces::canonical_space_members(members);
        check(
            crate::spaces::sender_is_member(&members, sender),
            "caller must be included in space members",
        );
        let row = open_space_or_abort(members);
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureDm(contact: AccountNumber) -> Space {
        let sender = get_sender();
        let members = match dm_members(sender, contact) {
            Ok(m) => m,
            Err(err) => abort_message(&err.message()),
        };
        let row = open_space_or_abort(members);
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn ensureGroup(other_members: Vec<AccountNumber>) -> Space {
        let sender = get_sender();
        let members = group_members(sender, other_members);
        abort_on_space_err(validate_group_members(&members));
        let row = open_space_or_abort(members);
        space_with_members(row)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSpace(space_uuid: String) -> Option<Space> {
        let row = crate::tables::SpaceTable::read()
            .get_index_pk()
            .get(&space_uuid)?;
        Some(space_with_members(row))
    }

    #[action]
    #[allow(non_snake_case)]
    fn isSpaceMember(space_uuid: String, member: AccountNumber) -> bool {
        crate::spaces::is_space_member(&space_uuid, member)
    }

    #[action]
    #[allow(non_snake_case)]
    fn spacesForSender() -> Vec<Space> {
        let sender = get_sender();
        spaces_for_user(sender)
            .into_iter()
            .map(space_with_members)
            .collect()
    }
}

#[cfg(test)]
mod tests;
