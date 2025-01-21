use crate::ToKey;
use async_graphql::SimpleObject;
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

#[crate::service(name = "staged-tx", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::*;
    use crate::{AccountNumber, Action, Checksum256, TimePointUSec};

    #[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Pack, Unpack, SimpleObject)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct ActionList {
        pub actions: Vec<Action>,
    }

    #[table(name = "InitTable", index = 0)]
    #[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema, Pack, Unpack)]
    #[fracpack(fracpack_mod = "fracpack")]
    struct InitRow {}

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "StagedTxTable", index = 1)]
    #[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Pack, Unpack, SimpleObject)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct StagedTx {
        pub id: u32,
        pub txid: [u8; 32],
        pub propose_block: u32,
        pub propose_date: TimePointUSec,
        pub proposer: AccountNumber,
        pub action_list: ActionList,
    }

    impl StagedTx {
        #[primary_key]
        fn by_id(&self) -> u32 {
            self.id
        }
    }

    #[table(name = "LastUsedTable", index = 2)]
    #[derive(
        Debug, Clone, Default, Serialize, Deserialize, ToSchema, Pack, Unpack, SimpleObject,
    )]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct LastUsed {
        pub id: u32,
    }

    impl LastUsed {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "ResponseTable", index = 3)]
    #[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Pack, Unpack, SimpleObject)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct Response {
        pub id: u32,
        pub account: AccountNumber,
        pub accepted: bool,
    }

    impl Response {
        #[primary_key]
        fn by_id(&self) -> (u32, AccountNumber) {
            (self.id, self.account)
        }

        #[secondary_key(1)]
        fn by_responder(&self) -> (AccountNumber, u32) {
            (self.account, self.id)
        }
    }

    /// Initialize the service
    #[action]
    fn init() {
        unimplemented!()
    }

    /// Proposes a new staged transaction containing the specified actions.
    /// Returns the ID of the database record containing the staged transaction.
    #[action]
    fn propose(actions: Vec<Action>) -> u32 {
        unimplemented!()
    }

    /// Removes (deletes) a staged transaction
    /// A staged transaction can only be removed by its proposer.
    #[action]
    fn remove(id: u32, txid: Checksum256) {
        unimplemented!()
    }

    /// Indicates that the caller accepts the specified staged transaction
    /// Depending on the staging rules enforced by the auth service of the sender
    /// of the staged transaction, this could result in the execution of the transaction.
    #[action]
    fn accept(id: u32, txid: Checksum256) {
        unimplemented!()
    }

    /// Indicates that the caller rejects the staged transaction
    #[action]
    fn reject(id: u32, txid: Checksum256) {
        unimplemented!()
    }

    /// Gets a staged transaction by id.
    #[action]
    fn get_staged_tx(id: u32) -> StagedTx {
        unimplemented!()
    }
}
