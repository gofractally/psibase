#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSchema.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/AuthDelegate.hpp>
#include <services/system/RAuthDelegate.hpp>

using namespace psibase;
using namespace std;

namespace SystemService
{
   struct Query
   {
      /// Get the accounts that are owned by the specified account
      auto owned(AccountNumber account) const
      {
         return AuthDelegate::Tables{AuthDelegate::service}
             .open<AuthDelegateTable>()
             .getIndex<1>()
             .subindex<AccountNumber>(account);
      }

      /// Get the owner of the specified account
      auto owner(AccountNumber account) const
      {
         return AuthDelegate::Tables{AuthDelegate::service}
             .open<AuthDelegateTable>()
             .getIndex<0>()
             .get(account);
      }
   };
   PSIO_REFLECT(Query,                   //
                method(owned, account),  //
                method(owner, account)   //
                                         //
   );

   std::optional<HttpReply> RAuthDelegate::serveSys(HttpRequest request)
   {
      if (auto result = serveGraphQL(request, Query{}))
         return result;

      if (auto result = serveSimpleUI<AuthDelegate, false>(request))
         return result;

      if (auto result = serveSchema<AuthDelegate>(request))
         return result;

      return std::nullopt;

   }  // serveSys
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RAuthDelegate)
