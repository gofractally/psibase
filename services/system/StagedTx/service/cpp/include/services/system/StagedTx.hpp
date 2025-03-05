#pragma once

#include <psibase/psibase.hpp>
#include <services/system/Transact.hpp>

namespace SystemService
{
   struct ActionList
   {
      std::vector<psibase::Action> actions;
   };
   PSIO_REFLECT(ActionList, actions)

   struct StagedTx
   {
      uint32_t               id;
      psibase::Checksum256   txid;
      uint32_t               propose_block;
      psibase::TimePointUSec propose_date;
      psibase::AccountNumber proposer;
      ActionList             action_list;
      bool                   auto_exec;
   };
   PSIO_REFLECT(StagedTx, id, txid, propose_block, propose_date, proposer, action_list, auto_exec)

   struct Response
   {
      uint32_t               id;
      psibase::AccountNumber account;
      bool                   accepted;
   };
   PSIO_REFLECT(Response, id, account, accepted)

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
   struct StagedTxService : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("staged-tx");

      void init();

      /// Proposes a new staged transaction containing the specified actions.
      /// Returns the ID of the database record containing the staged transaction.
      ///
      /// * `actions` - The actions to be staged
      /// * `auto_exec`: Enables automatic execution as soon as the transaction has enough approvals
      uint32_t propose(const std::vector<psibase::Action>& actions, bool auto_exec);

      /// Removes (deletes) a staged transaction
      ///
      /// A staged transaction can only be removed by its proposer.
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      /// * `txid`: The unique txid of the staged transaction
      void remove(uint32_t id, psibase::Checksum256 txid);

      /// Indicates that the caller accepts the specified staged transaction
      ///
      /// Depending on the staging rules enforced by the auth service of the sender
      /// of the staged transaction, this could result in the execution of the transaction.
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      /// * `txid`: The unique txid of the staged transaction
      void accept(uint32_t id, psibase::Checksum256 txid);

      /// Indicates that the caller rejects the staged transaction
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      /// * `txid`: The unique txid of the staged transaction
      void reject(uint32_t id, psibase::Checksum256 txid);

      /// Executes a transaction
      ///
      /// This is only needed when automatic execution is disabled
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      /// * `txid`: The unique txid of the staged transaction
      void execute(uint32_t id, psibase::Checksum256 txid);

      /// Gets a staged transaction by id.
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      StagedTx get_staged_tx(uint32_t id);
   };

   // clang-format off
   PSIO_REFLECT(StagedTxService,
      method(init),
      method(propose, actions, auto_exec),
      method(remove, id, txid),
      method(accept, id, txid),
      method(reject, id, txid),
      method(execute, id, txid),
      method(get_staged_tx, id),
   );
   // clang-format on

}  // namespace SystemService
