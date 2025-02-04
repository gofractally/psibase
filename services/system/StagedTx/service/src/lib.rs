use sha2::{Digest, Sha256};

mod db;
mod event;
mod policy;

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
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
    pub use crate::db::tables::*;
    pub use crate::event::StagedTxEvent;
    use crate::policy::StagedTxPolicy;
    use fracpack::Pack;
    use psibase::services::{events::Wrapper as Events, transact::Wrapper as Transact};
    use psibase::*;

    const ENABLE_PRINT: bool = false;

    fn debug_print(msg: &str) {
        if ENABLE_PRINT {
            psibase::write_console(msg);
        }
    }

    /// Runs before every other action except 'init', verifies that the service
    /// has been initialized.
    #[pre_action(exclude(init))]
    fn check_init() {
        let table: InitTable = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not initialized",
        );
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

    /// Proposes a new staged transaction containing the specified actions.
    /// Returns the ID of the database record containing the staged transaction.
    ///
    /// * `actions` - The actions to be staged
    #[action]
    fn propose(actions: Vec<Action>) -> u32 {
        let new_tx = StagedTx::add(actions);

        emit_update(new_tx.txid.clone(), StagedTxEvent::PROPOSED);

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
    fn accept(id: u32, txid: Checksum256) {
        let staged_tx = StagedTx::get(id, txid);

        staged_tx.accept();

        emit_update(staged_tx.txid.clone(), StagedTxEvent::ACCEPTED);

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
    fn reject(id: u32, txid: Checksum256) {
        let staged_tx = StagedTx::get(id, txid);

        staged_tx.reject();

        emit_update(staged_tx.txid.clone(), StagedTxEvent::REJECTED);

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
    fn remove(id: u32, txid: Checksum256) {
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

        emit_update(staged_tx.txid.clone(), StagedTxEvent::EXECUTED);
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

    fn emit_update(txid: Checksum256, event_type: u8) {
        Wrapper::emit().history().updated(
            txid,
            get_sender(),
            Transact::call().currentBlock().time,
            StagedTxEvent::from(event_type).to_string(),
        );
    }

    #[event(history)]
    pub fn updated(
        txid: Checksum256,       // The txid of the staged transaction
        actor: AccountNumber,    // The sender of the action causing the event
        datetime: TimePointUSec, // The time of the event emission
        event_type: String,      // The type of event
    ) {
    }
}

#[cfg(test)]
mod tests;
