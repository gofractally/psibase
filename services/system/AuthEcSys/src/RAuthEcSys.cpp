#include "services/system/RAuthEcSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/AuthEcSys.hpp>
#include <services/system/ProxySys.hpp>

#include <string>
#include <string_view>

using namespace psibase;
using std::move;
using std::optional;
using std::string;
using std::string_view;
using std::tuple;

namespace SystemService
{

   struct AuthEcQuery
   {
      auto accWithKey(PublicKey               key,
                      optional<AccountNumber> gt,
                      optional<AccountNumber> ge,
                      optional<AccountNumber> lt,
                      optional<AccountNumber> le,
                      optional<uint32_t>      first,
                      optional<uint32_t>      last,
                      optional<string>        before,
                      optional<string>        after) const
      {
         auto idx = AuthEcSys::Tables{AuthEcSys::service}
                        .open<AuthEcSys::AuthTable>()
                        .getIndex<1>()
                        .subindex(key);

         auto convert = [](const auto& opt)
         {
            optional<tuple<AccountNumber>> ret;
            if (opt)
               ret.emplace(std::make_tuple(opt.value()));
            return ret;
         };

         return makeConnection<Connection<AuthEcRecord::AuthRecord, "AuthConnection", "AuthEdge">>(
             idx, {convert(gt)}, {convert(ge)}, {convert(lt)}, {convert(le)}, first, last, before,
             after);
      }

      auto account(AccountNumber name) const
      {
         AuthEcSys::Tables db{AuthEcSys::service};
         auto              account = db.open<AuthEcSys::AuthTable>().get(name);

         return account.value_or(AuthEcRecord::AuthRecord{});
      }
   };
   PSIO_REFLECT(AuthEcQuery,
                method(accWithKey, key, gt, ge, lt, le, first, last, before, after),
                method(account, name)
                //
   );

   std::optional<HttpReply> RAuthEcSys::serveSys(HttpRequest request)
   {
      if (auto result = serveContent(request, Tables{getReceiver()}))
         return result;

      if (auto result = serveGraphQL(request, AuthEcQuery{}))
         return result;

      if (auto result = serveSimpleUI<AuthEcSys, true>(request))
         return result;

      return std::nullopt;

   }  // serveSys

   void RAuthEcSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      check(getSender() == getReceiver(), "wrong sender");
      storeContent(move(path), move(contentType), move(content), Tables{getReceiver()});
   }

   // getKeys
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RAuthEcSys)
