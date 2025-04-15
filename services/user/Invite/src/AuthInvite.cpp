#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>
#include <services/user/AuthInvite.hpp>
#include <services/user/Invite.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace UserService::Errors;
using namespace UserService::InviteNs;
using SystemService::AuthInterface;
using SystemService::ServiceMethod;

namespace UserService
{
   void AuthInvite::checkAuthSys(uint32_t                   flags,
                                 AccountNumber              requester,
                                 AccountNumber              sender,
                                 ServiceMethod              action,
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

      check(action.service == Invite::service, restrictedService.data());

      // Compile time check that acceptCreate and reject are still methods in Invite
      using T1 = decltype(&UserService::InviteNs::Invite::acceptCreate);
      using T2 = decltype(&UserService::InviteNs::Invite::reject);
      check(action.method == "acceptCreate"_m || action.method == "reject"_m,
            restrictedActions.data());

      // Billing notes: The point of an invite is to allow those without a psibase account to create one
      //    in a way that doesn't suffer from the chicken/egg problem that you *already* need an account
      //    to call an action (such as accepting an invite to create an account).
      // Therefore, this service allows the invited-sys user to be used by those without an account,
      //    specifically for calling the acceptCreate/reject invite actions on invite. That means that if
      //    it succeeds, invited-sys is the account that will be billed for the action. Invited-sys is a
      //    system account and has infinite resources, so the billing will always succeed.
      // This does not mean that no one paid for the action to accept an invite, because the action is
      //    prepaid by the user who creates the invite.
   }

   void AuthInvite::canAuthUserSys(psibase::AccountNumber user)
   {
      check(user == Invite::payerAccount, notWhitelisted.data());
   }

   void AuthInvite::requireAuth(const SystemService::AuthSig::SubjectPublicKeyInfo& pubkey)
   {
      auto claims = to<SystemService::Transact>().getTransaction().claims;
      bool found  = std::find_if(claims.begin(), claims.end(),
                                 [&](const auto& claim)
                                 {
                                   return claim.service == SystemService::VerifySig::service &&
                                          psibase::compare_blob(claim.rawData, pubkey.data) == 0;
                                }) != claims.end();

      std::string err = "requireAuth: ";
      err += missingInviteSig;

      check(found, err);
   }

   auto AuthInvite::serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>
   {
      if (auto result = psibase::servePackAction<AuthInvite>(request))
         return result;

      return std::nullopt;
   }

}  // namespace UserService

PSIBASE_DISPATCH(UserService::AuthInvite)
