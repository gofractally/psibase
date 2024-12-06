#include <services/system/AuthDelegate.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/StagedTx.hpp>

using namespace psibase;

namespace SystemService
{
   void AuthDelegate::checkAuthSys(std::uint32_t              flags,
                                   AccountNumber              requester,
                                   AccountNumber              sender,
                                   ServiceMethod              action,
                                   std::vector<ServiceMethod> allowedActions,
                                   std::vector<Claim>         claims)
   {
      auto row = db.open<AuthDelegateTable>().getIndex<0>().get(sender);
      check(row.has_value(), "sender does not have an owning account");

      if (requester == row->owner)
         flags = (flags & ~AuthInterface::requestMask) | AuthInterface::runAsRequesterReq;

      auto accountsTables = Accounts::Tables(Accounts::service);
      auto accountTable   = accountsTables.open<AccountTable>();
      auto accountIndex   = accountTable.getIndex<0>();
      auto account        = accountIndex.get(row->owner);
      if (!account)
         abortMessage("unknown owner \"" + sender.str() + "\"");

      auto r = recurse();

      Actor<AuthInterface> auth(AuthDelegate::service, account->authService);
      auth.checkAuthSys(flags, requester, row->owner, std::move(action), std::move(allowedActions),
                        std::move(claims));
   }

   void AuthDelegate::canAuthUserSys(psibase::AccountNumber user)
   {
      auto row = db.open<AuthDelegateTable>().getIndex<0>().get(user);
      check(row.has_value(), "sender does not have an owning account");
   }

   /// Handle notification related to the acceptance of a staged transaction
   ///
   /// Auth-delegate will execute the staged transaction if the sender of the call to `accept`
   /// is the owner account of the sender of the staged transaction.
   void AuthDelegate::stagedAccept(uint32_t staged_tx_id, psibase::AccountNumber actor)
   {
      check(getSender() == StagedTxService::service, "can only be called by staged-tx");

      auto staged_tx = to<StagedTxService>().get_staged_tx(staged_tx_id);
      auto actions   = staged_tx.action_list.actions;
      check(actions.size() > 0, "staged tx has no actions");

      auto row = db.open<AuthDelegateTable>().getIndex<0>().get(actions[0].sender);
      check(row.has_value(), "staged sender does not have an owning account");
      if (row->owner == actor)
      {
         auto [execute, allowedActions] = to<StagedTxService>().get_exec_info(staged_tx_id);
         recurse().to<Transact>().runAs(std::move(execute), allowedActions);
      }
   }

   /// Handle notification related to the rejection of a staged transaction
   ///
   /// Auth-delegate will execute the staged transaction if the sender of the call to `accept`
   /// is the owner account of the sender of the staged transaction.
   void AuthDelegate::stagedReject(uint32_t staged_tx_id, psibase::AccountNumber actor)
   {
      check(getSender() == StagedTxService::service, "can only be called by staged-tx");

      auto staged_tx = to<StagedTxService>().get_staged_tx(staged_tx_id);
      auto actions   = staged_tx.action_list.actions;
      check(actions.size() > 0, "staged tx has no actions");

      auto row = db.open<AuthDelegateTable>().getIndex<0>().get(actions[0].sender);
      check(row.has_value(), "staged sender does not have an owning account");
      if (row->owner == actor)
      {
         to<StagedTxService>().remove(staged_tx.id, staged_tx.txid);
      }
   }

   void AuthDelegate::setOwner(psibase::AccountNumber owner)
   {
      auto authTable = db.open<AuthDelegateTable>();
      authTable.put(AuthDelegateRecord{.account = getSender(), .owner = owner});
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthDelegate)
