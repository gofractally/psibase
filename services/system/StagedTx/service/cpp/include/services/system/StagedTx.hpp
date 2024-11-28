#pragma once

#include <psibase/psibase.hpp>

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

   struct StagedTxService : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("staged-tx");

      // Actions
      void     propose(const std::vector<psibase::Action>& actions);
      void     accept(uint32_t id, psibase::Checksum256 txid);
      void     reject(uint32_t id, psibase::Checksum256 txid);
      void     remove(uint32_t id, psibase::Checksum256 txid);
      void     execute(uint32_t id, psibase::Checksum256 txid);
      StagedTx get_staged_tx(uint32_t id);
   };

   // clang-format off
   PSIO_REFLECT(StagedTxService,
      method(propose, actions),
      method(accept, id, txid),
      method(reject, id, txid),
      method(remove, id, txid),
      method(execute, id, txid),
      method(get_staged_tx, id),
   );
   // clang-format on

}  // namespace SystemService
