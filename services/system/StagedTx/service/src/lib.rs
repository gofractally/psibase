use psibase::services::accounts::Wrapper as Accounts;
use psibase::AccountNumber;
use sha2::{Digest, Sha256};

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

pub fn get_auth_service(sender: AccountNumber) -> Option<AccountNumber> {
    Accounts::call().getAccount(sender).map(|a| a.authService)
}
/// A service for staged transaction proposal and execution
///
/// A staged transaction allows an account (the proposer) to propose a set of
/// actions to be executed by another account (the executor). The set of actions
/// proposed is known as the staged transaction. The staged transaction is not
/// executed unless and until the executor's auth service authorizes the execution.
///
/// The rules for authorization may vary depending on the staged-tx policy enforced
/// by the executor's auth service.
///
/// This can be used, for example, to propose a transaction on behalf of an account
/// that is only authorized by the combined authorization of multiple other accounts
/// (a.k.a. a "multi-sig" or multi-signature transaction), among many other uses.
#[psibase::service(recursive = true)]
pub mod service {
    use crate::get_auth_service;
    use crate::sha256;
    use async_graphql::SimpleObject;
    use psibase::fracpack::Pack;
    use psibase::services::transact::auth_interface::auth_action_structs;
    use psibase::services::{
        accounts::Wrapper as Accounts, events::Wrapper as Events, transact::Wrapper as Transact,
    };
    use psibase::*;
    use serde::{Deserialize, Serialize};

    const ENABLE_PRINT: bool = true;

    fn debug_print(msg: &str) {
        if ENABLE_PRINT {
            psibase::write_console(msg);
        }
    }

    struct StagedTxPolicy {
        user: AccountNumber,
        service_caller: ServiceCaller,
    }
    impl StagedTxPolicy {
        pub fn new(user: AccountNumber) -> Self {
            StagedTxPolicy {
                user,
                service_caller: ServiceCaller {
                    sender: Wrapper::SERVICE,
                    service: get_auth_service(user).unwrap(),
                },
            }
        }

        pub fn does_auth(&self, accepters: Vec<AccountNumber>) -> bool {
            self.service_caller.call(
                MethodNumber::from(auth_action_structs::isAuthSys::ACTION_NAME),
                auth_action_structs::isAuthSys {
                    sender: self.user,
                    authorizers: accepters,
                    authSet: None,
                },
            )
        }

        pub fn does_reject(&self, rejecters: Vec<AccountNumber>) -> bool {
            self.service_caller.call(
                MethodNumber::from(auth_action_structs::isRejectSys::ACTION_NAME),
                auth_action_structs::isRejectSys {
                    sender: self.user,
                    rejecters,
                    authSet: None,
                },
            )
        }
    }

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct ActionList {
        actions: Vec<Action>,
    }

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "StagedTxTable", index = 1)]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
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

        fn new(actions: Vec<Action>) -> Self {
            check(
                actions.len() > 0,
                "Staged transaction must contain at least one action",
            );

            for action in &actions {
                let sender = action.sender;
                check(
                    Accounts::call().getAccount(sender).is_some(),
                    "Sender account in staged tx is invalid",
                );
            }

            let monotonic_id = LastUsed::get_next_id();
            let current_block = Transact::call().currentBlock();
            let packed = (monotonic_id, current_block.blockNum, &actions).packed();
            let txid = sha256(&packed);

            StagedTx {
                id: monotonic_id,
                txid,
                propose_block: current_block.blockNum,
                propose_date: current_block.time,
                proposer: get_sender(),
                action_list: ActionList { actions },
            }
        }

        fn get(id: u32, txid: [u8; 32]) -> Self {
            let staged_tx = StagedTxTable::new().get_index_pk().get(&id);
            check(staged_tx.is_some(), "Unknown staged tx");
            let staged_tx = staged_tx.unwrap();
            check(
                staged_tx.txid == txid,
                "specified txid must match staged tx txid",
            );

            staged_tx
        }

        fn accept(&self) {
            Response::upsert(self.id, true);
        }

        fn reject(&self) {
            Response::upsert(self.id, false);
        }

        fn delete(&self) {
            // Delete all responses for this staged tx
            let id = self.id;
            let responses = ResponseTable::new();
            responses
                .get_index_pk()
                .range((id, AccountNumber::new(0))..=(id, AccountNumber::new(u64::MAX)))
                .for_each(|r| responses.erase(&(r.id, r.account)));

            // Delete the staged tx itself
            StagedTxTable::new().erase(&id);
        }

        fn accepters(&self) -> Vec<AccountNumber> {
            ResponseTable::new()
                .get_index_pk()
                .range((self.id, AccountNumber::new(0))..=(self.id, AccountNumber::new(u64::MAX)))
                .filter(|response| response.accepted)
                .map(|response| response.account)
                .collect()
        }

        fn rejecters(&self) -> Vec<AccountNumber> {
            ResponseTable::new()
                .get_index_pk()
                .range((self.id, AccountNumber::new(0))..=(self.id, AccountNumber::new(u64::MAX)))
                .filter(|response| !response.accepted)
                .map(|response| response.account)
                .collect()
        }
    }

    #[table(name = "LastUsedTable", index = 2)]
    #[derive(Default, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct LastUsed {
        pub id: u32,
    }
    impl LastUsed {
        #[primary_key]
        fn pk(&self) {}

        fn get_next_id() -> u32 {
            let table = LastUsedTable::new();
            let mut last_used = table.get_index_pk().get(&()).unwrap_or_default();
            last_used.id += 1;
            table.put(&last_used).unwrap();

            last_used.id
        }
    }

    #[table(name = "ResponseTable", index = 3)]
    #[derive(Debug, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
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
        fn by_responder(&self) -> AccountNumber {
            self.account
        }

        fn upsert(id: u32, accepted: bool) {
            let table = ResponseTable::new();
            let response = table
                .get_index_pk()
                .get(&(id, get_sender()))
                .map(|mut response| {
                    response.accepted = accepted;
                    response
                })
                .unwrap_or_else(|| Response {
                    id,
                    account: get_sender(),
                    accepted,
                });

            table.put(&response).unwrap();
        }
    }

    /// Initialize the staged-tx service
    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        let updated = MethodNumber::from("updated");
        Events::call().setSchema(create_schema::<Wrapper>());
        Events::call().addIndex(DbId::HistoryEvent, SERVICE, updated, 0); // Index events related to specific txid
        Events::call().addIndex(DbId::HistoryEvent, SERVICE, updated, 1); // Index events related to specific proposer/accepter/rejecter
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table: InitTable = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not initialized",
        );
    }

    /// Proposes a new staged transaction containing the specified actions.
    /// Returns the ID of the database record containing the staged transaction.
    ///
    /// All actions must have the same sender.
    ///
    /// * `actions` - The actions to be staged
    #[action]
    fn propose(actions: Vec<Action>) -> u32 {
        let new_tx = StagedTx::new(actions);

        StagedTxTable::new().put(&new_tx).unwrap();

        emit_update(new_tx.txid, StagedTxEvent::PROPOSED);

        // A proposal is also an implicit accept
        accept(new_tx.id, new_tx.txid);

        new_tx.id
    }

    /// Indicates that the caller accepts the specified staged transaction
    ///
    /// Depending on the staging rules enforced by the auth service of the sender
    /// of the staged transaction, this could result in the execution of the transaction.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn accept(id: u32, txid: [u8; 32]) {
        let staged_tx = StagedTx::get(id, txid);

        staged_tx.accept();

        emit_update(staged_tx.txid, StagedTxEvent::ACCEPTED);

        let authorized = staged_tx
            .action_list
            .actions
            .iter()
            .all(|action| StagedTxPolicy::new(action.sender).does_auth(staged_tx.accepters()));

        debug_print(&format!("authorized: {}\n", authorized.to_string()));

        if authorized {
            execute(staged_tx);
        }
    }

    /// Indicates that the caller rejects the staged transaction
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn reject(id: u32, txid: [u8; 32]) {
        let staged_tx = StagedTx::get(id, txid);

        staged_tx.reject();

        emit_update(staged_tx.txid, StagedTxEvent::REJECTED);

        let rejected =
            staged_tx.action_list.actions.iter().any(|action| {
                StagedTxPolicy::new(action.sender).does_reject(staged_tx.rejecters())
            });

        if rejected {
            staged_tx.delete();
            emit_update(staged_tx.txid, StagedTxEvent::DELETED);
        }
    }

    /// Removes (deletes) a staged transaction
    ///
    /// A staged transaction can only be removed by its proposer.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn remove(id: u32, txid: [u8; 32]) {
        let staged_tx = StagedTx::get(id, txid);

        check(
            staged_tx.proposer == get_sender(),
            "only the proposer can explicitly remove a staged transaction",
        );

        staged_tx.delete();
        emit_update(staged_tx.txid, StagedTxEvent::DELETED);
    }

    fn execute(staged_tx: StagedTx) {
        debug_print("Executing staged tx\n");
        staged_tx.delete();

        staged_tx
            .action_list
            .actions
            .into_iter()
            .for_each(|action| {
                debug_print(&format!(
                    "Executing action: {}@{}:{}\n",
                    &action.sender.to_string(),
                    &action.service.to_string(),
                    &action.method.to_string()
                ));

                let act = action.packed();
                unsafe { native_raw::call(act.as_ptr(), act.len() as u32) };
            });

        emit_update(staged_tx.txid, StagedTxEvent::EXECUTED);
        emit_update(staged_tx.txid, StagedTxEvent::DELETED);
    }

    /// Gets a staged transaction by id.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    #[action]
    fn get_staged_tx(id: u32) -> StagedTx {
        let staged_tx = StagedTxTable::new().get_index_pk().get(&id);
        check(staged_tx.is_some(), "Unknown staged tx");
        staged_tx.unwrap()
    }

    #[derive(Debug, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Clone)]
    struct StagedTxEvent {
        ty: u8,
    }

    impl StagedTxEvent {
        const PROPOSED: u8 = 0;
        const ACCEPTED: u8 = 1;
        const REJECTED: u8 = 2;
        const DELETED: u8 = 3;
        const EXECUTED: u8 = 4;
    }

    impl From<u8> for StagedTxEvent {
        fn from(value: u8) -> Self {
            check(value <= 4, "Invalid staged tx event type");
            StagedTxEvent { ty: value }
        }
    }

    fn emit_update(txid: [u8; 32], event_type: u8) {
        Wrapper::emit().history().updated(
            txid,
            get_sender(),
            Transact::call().currentBlock().time,
            event_type.into(),
        );
    }

    #[event(history)]
    pub fn updated(
        txid: [u8; 32],            // The txid of the staged transaction
        actor: AccountNumber,      // The sender of the action causing the event
        datetime: TimePointUSec,   // The time of the event emission
        event_type: StagedTxEvent, // The type of event
    ) {
    }
}

#[cfg(test)]
mod tests;
