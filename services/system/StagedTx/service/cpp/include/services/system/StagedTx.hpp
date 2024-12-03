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
      psibase::TimePointUSec propose_date;
      psibase::AccountNumber proposer;
      ActionList             action_list;
   };
   PSIO_REFLECT(StagedTx, id, txid, propose_date, proposer, action_list)

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
      /// All actions must have the same sender.
      ///
      /// * `actions` - The actions to be staged
      void propose(const std::vector<psibase::Action>& actions);

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

      /// Removes (deletes) a staged transaction
      ///
      /// A staged transaction can only be removed by the proposer or the auth service of
      /// the staged tx sender.
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      /// * `txid`: The unique txid of the staged transaction
      void remove(uint32_t id, psibase::Checksum256 txid);

      /// Notifies the staged-tx service that a staged transaction should be executed.
      /// Typically this call is facilitated by the staged transaction's first sender's auth
      /// service on behalf of the staged transaction's first sender.
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      /// * `txid`: The unique txid of the staged transaction
      void execute(uint32_t id, psibase::Checksum256 txid);

      /// Gets a staged transaction by id. Typically used inline by auth services.
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      StagedTx get_staged_tx(uint32_t id);

      /// Gets info needed for staged tx execution. Typically used inline by auth services.
      ///
      /// * `id`: The ID of the database record containing the staged transaction
      std::tuple<psibase::Action, std::vector<ServiceMethod>> get_exec_info(uint32_t id);
   };

   // clang-format off
   PSIO_REFLECT(StagedTxService,
      method(init),
      method(propose, actions),
      method(accept, id, txid),
      method(reject, id, txid),
      method(remove, id, txid),
      method(execute, id, txid),
      method(get_staged_tx, id),
      method(get_exec_info, id)
   );
   // clang-format on

}  // namespace SystemService
