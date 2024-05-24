#include "services/system/RAuthK1.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/AuthK1.hpp>
#include <services/system/HttpServer.hpp>

#include <string>
#include <string_view>

using namespace psibase;
using std::optional;
using std::string;
using std::string_view;
using std::tuple;

namespace SystemService
{

   struct AuthK1Query
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
         auto idx =
             AuthK1::Tables{AuthK1::service}.open<AuthK1::AuthTable>().getIndex<1>().subindex(key);

         auto convert = [](const auto& opt)
         {
            optional<tuple<AccountNumber>> ret;
            if (opt)
               ret.emplace(std::make_tuple(opt.value()));
            return ret;
         };

         return makeConnection<Connection<AuthK1Record::AuthRecord, "AuthConnection", "AuthEdge">>(
             idx, {convert(gt)}, {convert(ge)}, {convert(lt)}, {convert(le)}, first, last, before,
             after);
      }

      auto account(AccountNumber name) const
      {
         AuthK1::Tables db{AuthK1::service};
         auto           account = db.open<AuthK1::AuthTable>().get(name);

         return account.value_or(AuthK1Record::AuthRecord{});
      }
   };
   PSIO_REFLECT(AuthK1Query,
                method(accWithKey, key, gt, ge, lt, le, first, last, before, after),
                method(account, name)
                //
   );

   std::optional<HttpReply> RAuthK1::serveSys(HttpRequest request)
   {
      if (auto result = serveContent(request, Tables{getReceiver()}))
         return result;

      if (auto result = serveGraphQL(request, AuthK1Query{}))
         return result;

      if (auto result = serveSimpleUI<AuthK1, true>(request))
         return result;

      return std::nullopt;

   }  // serveSys

   void RAuthK1::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      check(getSender() == getReceiver(), "wrong sender");
      storeContent(std::move(path), std::move(contentType), std::move(content),
                   Tables{getReceiver()});
   }

   // getKeys
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RAuthK1)
