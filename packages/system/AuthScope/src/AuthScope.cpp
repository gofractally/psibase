#include <services/system/AuthScope.hpp>

#include <psibase/blob.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/VerifySig.hpp>

#include <algorithm>

using namespace psibase;

namespace SystemService
{
   namespace
   {
      bool actionAllowed(const AuthScopeRow& row, ServiceMethod action)
      {
         if (action.service == AuthScope::service)
            return false;
         return std::ranges::contains(row.allowed, AllowedAction{action.service, action.method});
      }
   }  // namespace

   bool AuthScope::checkAuthSys(uint32_t                    flags,
                                AccountNumber               sender,
                                ServiceMethod               action,
                                std::vector<psibase::Claim> claims)
   {
      auto row = get(sender);
      check(row.has_value(), "sender does not have a public key");

      auto matched =
          std::ranges::find_if(claims,
                               [&](const Claim& claim)
                               {
                                  return claim.service == VerifySig::service &&
                                         compare_blob(claim.rawData, row->pubkey.data) == 0;
                               });
      if (matched == claims.end() || !actionAllowed(*row, action))
         return false;
      if ((flags & AuthInterface::firstAuthFlag) && matched != claims.begin())
         return false;
      return true;
   }

   void AuthScope::canAuthUserSys(AccountNumber user)
   {
      check(get(user).has_value(), "sender does not have a public key");
   }

   std::vector<AccountNumber> AuthScope::getDlgsSys(AccountNumber, std::optional<ServiceMethod>)
   {
      return {};
   }

   bool AuthScope::isAuthSys(AccountNumber,
                             std::vector<AccountNumber>,
                             std::optional<ServiceMethod>)
   {
      abortMessage("isAuthSys is not supported");
   }

   bool AuthScope::isRejectSys(AccountNumber,
                               std::vector<AccountNumber>,
                               std::optional<ServiceMethod>)
   {
      abortMessage("isRejectSys is not supported");
   }

   void AuthScope::newAccount(AccountNumber                 name,
                              AuthSig::SubjectPublicKeyInfo key,
                              AccountNumber                 owner,
                              std::vector<AllowedAction>    allowed)
   {
      check(to<Accounts>().exists(owner), "owner account does not exist");

      open<AuthScopeTable>().put(AuthScopeRow{
          .account = name,
          .pubkey  = std::move(key),
          .owner   = owner,
          .allowed = std::move(allowed),
      });
      to<Accounts>().newAccount(name, AuthScope::service, NewAccountMode::requireNew);
   }

   std::optional<AuthScopeRow> AuthScope::get(AccountNumber account)
   {
      return open<AuthScopeTable>(KvMode::read).getIndex<0>().get(account);
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthScope)
