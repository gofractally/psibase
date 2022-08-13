#include <contracts/system/AuthEcSys.hpp>
#include <contracts/system/VerifyEcSys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace system_contract
{
   void AuthEcSys::checkAuthSys(uint32_t                    flags,
                                psibase::AccountNumber      requester,
                                psibase::Action             action,
                                std::vector<ContractMethod> allowedActions,
                                std::vector<psibase::Claim> claims)
   {
      if (enable_print)
         print("auth_check\n");

      auto type = flags & AuthInterface::requestMask;
      if (type == AuthInterface::runAsRequesterReq)
         return;  // Request is valid
      else if (type == AuthInterface::runAsMatchedReq)
         return;  // Request is valid
      else if (type == AuthInterface::runAsMatchedExpandedReq)
         abortMessage("runAs: caller attempted to expand powers");
      else if (type == AuthInterface::runAsOtherReq)
         abortMessage("runAs: caller is not authorized");
      else if (type != AuthInterface::topActionReq)
         abortMessage("unsupported auth type");

      auto row = db.open<AuthTable>().getIndex<0>().get(action.sender);

      check(row.has_value(), "sender does not have a public key");

      auto expected = psio::convert_to_frac(row->pubkey);
      for (auto& claim : claims)
      {
         if (claim.contract == VerifyEcSys::contract && claim.rawData == expected)
         {
            // Billing rule: if first proof passes, and auth for first sender passes,
            // then then first sender will be charged even if the transaction fails,
            // including time for executing failed proofs and auths. We require the
            // first auth to be verified by the first signature here to prevent a
            // resource-billing attack against innocent accounts.
            //
            // We do this check after passing the other checks so we can produce the
            // other errors when appropriate.
            if ((flags & AuthInterface::firstAuthFlag) && &claim != &claims[0])
               abortMessage("first sender is not verified by first signature");
            return;
         }
      }
      abortMessage("transaction is not signed with key " + publicKeyToString(row->pubkey));
   }

   void AuthEcSys::newAccount(psibase::AccountNumber account, psibase::PublicKey payload)
   {
      check(false, "Not supported yet");
      //check(getSender() == InviteSys::contract, "Only invite-sys can create a new account");
      check(payload.data.index() == 0, "only k1 currently supported");
      auto authTable = db.open<AuthTable>();
      check(!authTable.getIndex<0>().get(account).has_value(), "account already exists");

      authTable.put(AuthRecord{.account = account, .pubkey = payload});
   }

   void AuthEcSys::setKey(psibase::PublicKey key)
   {
      check(key.data.index() == 0, "only k1 currently supported");

      auto authTable = db.open<AuthTable>();
      authTable.put(AuthRecord{.account = getSender(), .pubkey = key});
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::AuthEcSys)
