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
    use psibase::services::transact::{auth_interface::auth_action_structs, ServiceMethod};
    use psibase::services::{
        accounts::Wrapper as Accounts, events::Wrapper as Events, transact::Wrapper as Transact,
    };
    use psibase::*;
    use serde::{Deserialize, Serialize};

    struct StagedTxPolicy {
        service_caller: ServiceCaller,
    }
    impl StagedTxPolicy {
        pub fn new(auth_service: AccountNumber) -> Self {
            StagedTxPolicy {
                service_caller: ServiceCaller {
                    sender: Wrapper::SERVICE,
                    service: auth_service,
                },
            }
        }

        pub fn accept(&self, id: u32, actor: psibase::AccountNumber) {
            self.service_caller.call_returns_nothing(
                MethodNumber::from(auth_action_structs::stagedAccept::ACTION_NAME),
                auth_action_structs::stagedAccept {
                    staged_tx_id: id,
                    actor,
                },
            )
        }

        pub fn reject(&self, id: u32, actor: psibase::AccountNumber) {
            self.service_caller.call_returns_nothing(
                MethodNumber::from(auth_action_structs::stagedReject::ACTION_NAME),
                auth_action_structs::stagedReject {
                    staged_tx_id: id,
                    actor,
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
        pub propose_date: TimePointUSec,
        pub proposer: AccountNumber,
        pub action_list: ActionList,
    }
    impl StagedTx {
        #[primary_key]
        fn by_id(&self) -> u32 {
            self.id
        }

        #[secondary_key(1)]
        fn by_act_sender(&self) -> (AccountNumber, u32) {
            check(
                self.action_list.actions.len() > 0,
                "Staged transaction contains no actions",
            );
            (self.action_list.actions[0].sender, self.id)
        }

        #[secondary_key(2)]
        fn by_staging_policy(&self) -> (AccountNumber, u32) {
            check(
                self.action_list.actions.len() > 0,
                "Staged transaction contains no actions",
            );
            let sender = self.action_list.actions[0].sender;
            let auth_service =
                get_auth_service(sender).expect("Action sender account in staged tx is invalid");
            (auth_service, self.id)
        }

        fn new(actions: Vec<Action>) -> Self {
            check(
                actions.len() > 0,
                "Staged transaction must contain at least one action",
            );

            let sender = actions[0].sender;
            check(
                Accounts::call().getAccount(sender).is_some(),
                "Sender account in staged tx is invalid",
            );

            let monotonic_id = LastUsed::get_next_id();
            let current_block = Transact::call().currentBlock();
            let packed = (monotonic_id, current_block.blockNum, &actions).packed();
            let txid = sha256(&packed);

            StagedTx {
                id: monotonic_id,
                txid,
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

        fn first_sender(&self) -> AccountNumber {
            self.action_list.actions[0].sender
        }

        fn staged_tx_policy(&self) -> StagedTxPolicy {
            StagedTxPolicy::new(get_auth_service(self.first_sender()).unwrap())
        }

        fn emit(&self, event_type: u8) {
            Wrapper::emit().history().updated(
                self.txid,
                self.first_sender(),
                get_sender(),
                Transact::call().currentBlock().time,
                event_type.into(),
            );
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
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
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
        Events::call().addIndex(DbId::HistoryEvent, SERVICE, updated, 1); // Index events related to specific txid sender
        Events::call().addIndex(DbId::HistoryEvent, SERVICE, updated, 2); // Index events related to specific proposer/accepter/rejecter
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
    ///
    /// * `actions` - The actions to be staged
    #[action]
    fn propose(actions: Vec<Action>) {
        let new_tx = StagedTx::new(actions);

        StagedTxTable::new().put(&new_tx).unwrap();

        new_tx.emit(StagedTxEvent::PROPOSED);

        // A proposal is also an implicit accept
        accept(new_tx.id, new_tx.txid);
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

        Response::upsert(id, true);

        staged_tx
            .staged_tx_policy()
            .accept(staged_tx.id, get_sender());

        staged_tx.emit(StagedTxEvent::ACCEPTED);
    }

    /// Indicates that the caller rejects the staged transaction
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn reject(id: u32, txid: [u8; 32]) {
        let staged_tx = StagedTx::get(id, txid);

        Response::upsert(id, false);

        staged_tx
            .staged_tx_policy()
            .reject(staged_tx.id, get_sender());

        staged_tx.emit(StagedTxEvent::REJECTED);
    }

    /// Removes (deletes) a staged transaction
    ///
    /// A staged transaction can only be removed by the proposer or the auth service of
    /// the staged tx sender.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn remove(id: u32, txid: [u8; 32]) {
        let staged_tx = StagedTx::get(id, txid);

        check(
            get_sender() == staged_tx.proposer || get_sender() == staged_tx.first_sender(),
            "Only the proposer or the staged tx first sender can remove the staged tx",
        );

        // Delete all responses for this staged tx
        let responses = ResponseTable::new();
        let deletable = responses
            .get_index_pk()
            .range((id, AccountNumber::new(0))..=(id, AccountNumber::new(u64::MAX)))
            .collect::<Vec<_>>();
        for d in deletable {
            responses.erase(&(d.id, d.account));
        }

        // Delete the staged tx itself
        StagedTxTable::new().erase(&id);

        staged_tx.emit(StagedTxEvent::DELETED);
    }

    /// Notifies the staged-tx service that a staged transaction should be executed.
    /// Typically this call is facilitated by the staged transaction's first sender's auth
    /// service on behalf of the staged transaction's first sender.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    /// * `txid`: The unique txid of the staged transaction
    #[action]
    fn execute(id: u32, txid: [u8; 32]) {
        let staged_tx = StagedTx::get(id, txid);

        check(
            staged_tx.first_sender() == get_sender(),
            "Only the first sender of the staged tx can execute it",
        );

        staged_tx.action_list.actions.iter().for_each(|action| {
            let _ = Transact::call().runAs(action.clone(), Vec::new());
        });

        staged_tx.emit(StagedTxEvent::EXECUTED);

        remove(id, txid);
    }

    /// Gets a staged transaction by id. Typically used inline by auth services.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    #[action]
    fn get_staged_tx(id: u32) -> StagedTx {
        let staged_tx = StagedTxTable::new().get_index_pk().get(&id);
        check(staged_tx.is_some(), "Unknown staged tx");
        staged_tx.unwrap()
    }

    /// Gets info needed for staged tx execution. Typically used inline by auth services.
    ///
    /// * `id`: The ID of the database record containing the staged transaction
    #[action]
    fn get_exec_info(id: u32) -> (Action, Vec<ServiceMethod>) {
        let staged_tx = get_staged_tx(id);

        let make_service_method = |action: &Action| ServiceMethod {
            service: action.service,
            method: action.method,
        };

        let allowed_actions: Vec<ServiceMethod> = staged_tx
            .action_list
            .actions
            .iter()
            .map(make_service_method)
            .collect();

        let staged_tx_sender = staged_tx.action_list.actions[0].sender;

        let execute = Action {
            sender: staged_tx_sender,
            service: Wrapper::SERVICE,
            method: MethodNumber::from(action_structs::execute::ACTION_NAME),
            rawData: (id, staged_tx.txid).packed().into(),
        };

        (execute, allowed_actions)
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

    #[event(history)]
    pub fn updated(
        txid: [u8; 32],            // The txid of the staged transaction
        sender: AccountNumber,     // The sender of the staged transaction
        actor: AccountNumber,      // The sender of the action causing the event
        datetime: TimePointUSec,   // The time of the event emission
        event_type: StagedTxEvent, // The type of event
    ) {
    }
}

#[cfg(test)]
mod tests;
