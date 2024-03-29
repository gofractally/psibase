#include <psibase/dispatch.hpp>
#include <services/system/AuthK1.hpp>
#include <services/system/VerifyEcSys.hpp>

#include <cstdio>

using namespace psibase;
using SystemService::AuthK1Record::AuthRecord;

static constexpr bool enable_print = false;

namespace SystemService
{
   void AuthK1::checkAuthSys(uint32_t                    flags,
                             psibase::AccountNumber      requester,
                             psibase::AccountNumber      sender,
                             ServiceMethod               action,
                             std::vector<ServiceMethod>  allowedActions,
                             std::vector<psibase::Claim> claims)
   {
      if (enable_print)
         std::printf("auth_check\n");

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

      auto row = db.open<AuthTable>().getIndex<0>().get(sender);

      check(row.has_value(), "sender does not have a public key");

      auto expected = psio::convert_to_frac(row->pubkey);
      for (auto& claim : claims)
      {
         if (claim.service == VerifyEcSys::service && claim.rawData == expected)
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
      abortMessage("transaction does not include a claim for the key " +
                   publicKeyToString(row->pubkey) + " needed to authenticate sender " +
                   sender.str() + " for action " + action.service.str() +
                   "::" + action.method.str());
   }

   void AuthK1::canAuthUserSys(psibase::AccountNumber user)
   {
      // Anyone with a public key in the AuthTable may use AuthK1
      auto row = db.open<AuthTable>().getIndex<0>().get(user);
      check(row.has_value(), "sender does not have a public key");
   }

   void AuthK1::setKey(psibase::PublicKey key)
   {
      check(key.data.index() == 0, "only k1 currently supported");

      auto authTable = db.open<AuthTable>();
      authTable.put(AuthRecord{.account = getSender(), .pubkey = key});
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthK1)
