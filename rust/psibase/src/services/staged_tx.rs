#[crate::service(name = "staged-tx", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, Action, Checksum256, Fracpack, TimePointUSec};
    use async_graphql::SimpleObject;
    use fracpack::ToSchema;
    use serde::{Deserialize, Serialize};

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct ActionList {
        pub actions: Vec<Action>,
    }

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct StagedTx {
        pub id: u32,
        pub txid: Checksum256,
        pub propose_block: u32,
        pub propose_date: TimePointUSec,
        pub proposer: AccountNumber,
        pub action_list: ActionList,
    }

    /// Initialize the service
    #[action]
    fn init() {
        unimplemented!()
    }

    /// Proposes a new staged transaction containing the specified actions.
    /// Returns the ID of the database record containing the staged transaction.
    ///
    /// * `actions`: The actions to be staged
    /// * `auto_exec`: Enables automatic execution as soon as the transaction has enough approvals
    #[action]
    fn propose(actions: Vec<Action>, auto_exec: bool) -> u32 {
        unimplemented!()
    }

    /// Removes (deletes) a staged transaction
    ///
    /// A staged transaction can only be removed by its proposer.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn remove(id: u32, txid: Checksum256) {
        unimplemented!()
    }

    /// Indicates that the caller accepts the specified staged transaction
    ///
    /// Depending on the staging rules enforced by the auth service of the sender
    /// of the staged transaction, this could result in the execution of the transaction.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn accept(id: u32, txid: Checksum256) {
        unimplemented!()
    }

    /// Indicates that the caller rejects the staged transaction
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn reject(id: u32, txid: Checksum256) {
        unimplemented!()
    }

    /// Executes a transaction
    ///
    /// This is only needed when automatic execution is disabled
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn execute(id: u32, txid: Checksum256) {
        unimplemented!()
    }

    /// Gets a staged transaction by id.
    #[action]
    fn get_staged_tx(id: u32) -> StagedTx {
        unimplemented!()
    }

    #[event(history)]
    pub fn updated(
        txid: String,            // The txid of the staged transaction
        actor: AccountNumber,    // The sender of the action causing the event
        datetime: TimePointUSec, // The time of the event emission
        event_type: String,      // The type of event
    ) {
        unimplemented!()
    }
}
