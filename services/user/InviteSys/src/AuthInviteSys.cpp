#include <services/system/TransactionSys.hpp>
#include <services/system/VerifyEcSys.hpp>
#include <services/user/AuthInviteSys.hpp>
#include <services/user/InviteSys.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>

using namespace psibase;
using namespace UserService::Errors;
using namespace UserService::Invite;
using SystemService::AuthInterface;
using SystemService::ServiceMethod;

namespace UserService
{
   void AuthInviteSys::checkAuthSys(uint32_t                   flags,
                                    AccountNumber              requester,
                                    Action                     action,
                                    std::vector<ServiceMethod> allowedActions,
                                    std::vector<Claim>         claims)
   {
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

      if (getInviteClaim(claims))
      {
         check(action.service == InviteSys::service, restrictedService.data());

         // Compile time check that acceptCreate and reject are still methods in InviteSys
         using T1 = decltype(&UserService::Invite::InviteSys::acceptCreate);
         using T2 = decltype(&UserService::Invite::InviteSys::reject);
         check(action.method == "acceptCreate"_m || action.method == "reject"_m,
               restrictedActions.data());
         return;
      }

      std::string err = "checkAuthSys: ";
      err += missingInviteSig;
      abortMessage(err);

      // Billing notes: The point of an invite is to allow those without a psibase account to create one
      //    in a way that doesn't suffer from the chicken/egg problem that you *already* need an account
      //    to call an action (such as accepting an invite to create an account).
      // Therefore, this service allows the invited-sys user to be used by those without an account,
      //    specifically for calling the accept/reject invite actions on invite-sys. That means that if
      //    it succeeds, invited-sys is the account that will be billed for the action. Invited-sys is a
      //    system account and has infinite resources, so the billing will always succeed.
      // This does not mean that no one paid for the action to accept an invite, because the action is
      //    prepaid by the user who creates the invite.
   }

   void AuthInviteSys::canAuthUserSys(psibase::AccountNumber user)
   {
      check(user == InviteSys::payerAccount, notWhitelisted.data());
   }

   std::optional<Claim> AuthInviteSys::getInviteClaim(const std::vector<Claim>& claims)
   {
      for (const auto& claim : claims)
      {
         if (claim.service == SystemService::VerifyEcSys::service)
         {
            auto inviteKey = psio::convert_from_frac<PublicKey>(claim.rawData);
            auto inviteOpt = Invite::InviteSys::Tables{Invite::InviteSys::service}
                                 .open<Invite::InviteTable>()
                                 .get(inviteKey);

            if (inviteOpt.has_value())
            {
               return std::optional<Claim>{claim};
            }
         }
      }
      return std::nullopt;
   }

   void AuthInviteSys::requireAuth(const PublicKey& pubkey)
   {
      auto claimOpt = getInviteClaim(to<SystemService::TransactionSys>().getTransaction().claims);

      std::string err = "requireAuth: ";
      err += missingInviteSig;

      check(claimOpt.has_value(), err);
      check(claimOpt->service == SystemService::VerifyEcSys::service, err);
      check(psio::convert_from_frac<PublicKey>(claimOpt->rawData) == pubkey, err);
   }

}  // namespace UserService

PSIBASE_DISPATCH(UserService::AuthInviteSys)
