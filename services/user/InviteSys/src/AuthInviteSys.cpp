#include <services/system/Transact.hpp>
#include <services/system/VerifyK1.hpp>
#include <services/user/AuthInviteSys.hpp>
#include <services/user/InviteSys.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace UserService::Errors;
using namespace UserService::Invite;
using SystemService::AuthInterface;
using SystemService::ServiceMethod;

namespace UserService
{
   void AuthInviteSys::checkAuthSys(uint32_t                   flags,
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

      check(action.service == InviteSys::service, restrictedService.data());

      // Compile time check that acceptCreate and reject are still methods in InviteSys
      using T1 = decltype(&UserService::Invite::InviteSys::acceptCreate);
      using T2 = decltype(&UserService::Invite::InviteSys::reject);
      check(action.method == "acceptCreate"_m || action.method == "reject"_m,
            restrictedActions.data());

      // Billing notes: The point of an invite is to allow those without a psibase account to create one
      //    in a way that doesn't suffer from the chicken/egg problem that you *already* need an account
      //    to call an action (such as accepting an invite to create an account).
      // Therefore, this service allows the invited-sys user to be used by those without an account,
      //    specifically for calling the acceptCreate/reject invite actions on invite-sys. That means that if
      //    it succeeds, invited-sys is the account that will be billed for the action. Invited-sys is a
      //    system account and has infinite resources, so the billing will always succeed.
      // This does not mean that no one paid for the action to accept an invite, because the action is
      //    prepaid by the user who creates the invite.
   }

   void AuthInviteSys::canAuthUserSys(psibase::AccountNumber user)
   {
      check(user == InviteSys::payerAccount, notWhitelisted.data());
   }

   void AuthInviteSys::requireAuth(const PublicKey& pubkey)
   {
      auto claims = to<SystemService::Transact>().getTransaction().claims;
      bool found  = std::find_if(claims.begin(), claims.end(),
                                 [&](auto claim)
                                 {
                                   return claim.service == SystemService::VerifyK1::service &&
                                          psio::from_frac<PublicKey>(claim.rawData) == pubkey;
                                }) != claims.end();

      std::string err = "requireAuth: ";
      err += missingInviteSig;

      check(found, err);
   }

   auto AuthInviteSys::serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>
   {
      if (auto result = psibase::servePackAction<AuthInviteSys>(request))
         return result;

      if (auto result = psibase::serveContent(request, Tables{}))
         return result;

      return std::nullopt;
   }

   void AuthInviteSys::storeSys(std::string       path,
                                std::string       contentType,
                                std::vector<char> content)
   {
      psibase::check(psibase::getSender() == psibase::getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content), Tables{});
   }

}  // namespace UserService

PSIBASE_DISPATCH(UserService::AuthInviteSys)
