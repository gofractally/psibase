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
#[psibase::service]
pub mod service {
    use crate::get_auth_service;
    use crate::sha256;
    use async_graphql::SimpleObject;
    use psibase::fracpack::Pack;
    use psibase::services::transact::auth_interface::auth_action_structs::*;
    use psibase::services::{accounts::Wrapper as Accounts, transact::Wrapper as Transact};
    use psibase::Checksum256;
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

        pub fn accept(&self, txid: Checksum256, actor: psibase::AccountNumber) {
            self.service_caller.call_returns_nothing(
                MethodNumber::from(stagedAccept::ACTION_NAME),
                stagedAccept { txid, actor }.packed(),
            )
        }

        pub fn reject(&self, txid: Checksum256, actor: psibase::AccountNumber) {
            self.service_caller.call_returns_nothing(
                MethodNumber::from(stagedReject::ACTION_NAME),
                stagedReject { txid, actor }.packed(),
            )
        }
    }

    #[table(name = "StagedTxTable", index = 0)]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct StagedTx {
        pub id: u32,
        pub txid: [u8; 32],
        pub propose_date: TimePointUSec,
        pub proposer: AccountNumber,
        pub tx: Transaction,
    }
    impl StagedTx {
        #[primary_key]
        fn by_id(&self) -> u32 {
            self.id
        }

        #[secondary_key(1)]
        fn by_act_sender(&self) -> (AccountNumber, u32) {
            check(
                self.tx.actions.len() > 0,
                "Staged transaction contains no actions",
            );
            (self.tx.actions[0].sender, self.id)
        }

        #[secondary_key(2)]
        fn by_staging_policy(&self) -> (AccountNumber, u32) {
            check(
                self.tx.actions.len() > 0,
                "Staged transaction contains no actions",
            );
            let sender = self.tx.actions[0].sender;
            let auth_service =
                get_auth_service(sender).expect("Action sender account in staged tx is invalid");
            (auth_service, self.id)
        }

        fn new(tx: Transaction) -> Self {
            check(
                tx.claims.is_empty(),
                "Staged transaction must not contain any claims",
            );
            check(
                tx.actions.len() > 0,
                "Staged transaction must contain at least one action",
            );

            let sender = tx.actions[0].sender;
            check(
                Accounts::call().getAccount(sender).is_some(),
                "Sender account in staged tx is invalid",
            );

            let packed = tx.packed();
            let txid = sha256(&packed);

            StagedTxTable::new()
                .get_index_by_act_sender()
                .range((sender, 0)..=(sender, u32::MAX))
                .for_each(|existing| {
                    if existing.txid == txid {
                        check(
                            false,
                            &format!("Staged transaction already exists at index {}", existing.id),
                        );
                    }
                });

            StagedTx {
                id: LastUsed::get_next_id(),
                txid,
                propose_date: Transact::call().currentBlock().time,
                proposer: get_sender(),
                tx,
            }
        }

        fn first_sender(&self) -> AccountNumber {
            self.tx.actions[0].sender
        }

        fn staged_tx_policy(&self) -> StagedTxPolicy {
            StagedTxPolicy::new(get_auth_service(self.first_sender()).unwrap())
        }

        fn emit(&self, event_type: u8) {
            Wrapper::emit().history().updated(
                StagedTxSummary {
                    id: self.id,
                    sender: self.first_sender(),
                },
                self.first_sender(),
                Transact::call().currentBlock().time,
                event_type.into(),
            );
        }
    }

    #[table(name = "LastUsedTable", index = 1)]
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

    #[table(name = "ResponseTable", index = 2)]
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

    /// Proposes a new staged transaction. The staged transaction must not contain any claims.
    ///
    /// * `tx` - The staged transaction
    #[action]
    fn propose(tx: Transaction) {
        let new_tx = StagedTx::new(tx);

        StagedTxTable::new().put(&new_tx).unwrap();

        new_tx.emit(StagedTxEvent::PROPOSED);

        // A proposal is also an implicit accept
        accept(new_tx.id);
    }

    /// Indicates that the caller accepts the staged transaction
    ///
    /// Depending on the staging rules enforced by the auth service of the sender
    /// of the staged transaction, this could result in the execution of the transaction.
    ///
    /// * `id`: The ID of the staged transaction
    #[action]
    fn accept(id: u32) {
        let staged_tx = StagedTxTable::new().get_index_pk().get(&id);
        check(staged_tx.is_some(), "Unknown staged tx");
        let staged_tx = staged_tx.unwrap();

        Response::upsert(id, true);

        staged_tx
            .staged_tx_policy()
            .accept(staged_tx.txid.into(), get_sender());

        staged_tx.emit(StagedTxEvent::ACCEPTED);
    }

    /// Indicates that the caller rejects the staged transaction
    ///
    /// * `id`: The ID of the staged transaction
    #[action]
    fn reject(id: u32) {
        let staged_tx = StagedTxTable::new().get_index_pk().get(&id);
        check(staged_tx.is_some(), "Unknown staged tx");
        let staged_tx = staged_tx.unwrap();

        Response::upsert(id, false);

        staged_tx
            .staged_tx_policy()
            .reject(staged_tx.txid.into(), get_sender());

        staged_tx.emit(StagedTxEvent::REJECTED);
    }

    /// Deletes a staged transaction
    ///
    /// A staged transaction can only be deleted by the proposer or the auth service of
    /// the staged tx sender.
    ///
    /// * `id`: The ID of the staged transaction
    #[action]
    fn delete(id: u32) {
        let staged_tx = StagedTxTable::new().get_index_pk().get(&id);
        check(staged_tx.is_some(), "Unknown staged tx");
        let staged_tx = staged_tx.unwrap();
        check(
            get_sender() == staged_tx.proposer
                || get_sender() == get_auth_service(staged_tx.first_sender()).unwrap(),
            "Only the proposer or the staged tx first sender's auth service can delete the staged tx",
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

    /// Notifies the staged-tx service that a staged transaction has been executed
    /// by the staged transaction first sender's auth service. This allows the staged-tx
    /// service to delete the old staged-tx record, and emit relevant events.
    ///
    /// * `id`: The ID of the staged transaction
    #[action]
    fn executed(id: u32) {
        let staged_tx = StagedTxTable::new().get_index_pk().get(&id);
        check(staged_tx.is_some(), "Unknown staged tx");
        let staged_tx = staged_tx.unwrap();
        check(
            get_sender() == get_auth_service(staged_tx.first_sender()).unwrap(),
            "Only the staged tx first sender's auth service can execute the staged tx",
        );

        staged_tx.emit(StagedTxEvent::EXECUTED);

        delete(id);
    }

    #[action]
    fn print() {
        psibase::write_console("debug print from staged tx service");
    }

    #[derive(Debug, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Clone)]
    struct StagedTxEvent {
        ty: u8,
    }

    #[allow(dead_code)] // Todo - remove
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

    #[derive(Debug, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject, Clone)]
    struct StagedTxSummary {
        id: u32,               // The ID in the StagedTxTable
        sender: AccountNumber, // The sender of the staged transaction
    }

    #[event(history)]
    pub fn updated(
        tx_summary: StagedTxSummary,
        actor: AccountNumber,      // The sender of the action causing the event
        datetime: TimePointUSec,   // The time of the event emission
        event_type: StagedTxEvent, // The type of event
    ) {
    }
}

#[cfg(test)]
mod tests;
