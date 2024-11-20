#include <services/system/RAuthSig.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/AuthSig.hpp>
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
   namespace AuthSig
   {
      struct AuthQuery
      {
         auto accWithKey(SubjectPublicKeyInfo    key,
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
                AuthSig::Tables{AuthSig::service}.open<AuthSig::AuthTable>().getIndex<1>().subindex(
                    keyFingerprint(key));

            auto convert = [](const auto& opt)
            {
               optional<tuple<AccountNumber>> ret;
               if (opt)
                  ret.emplace(std::make_tuple(opt.value()));
               return ret;
            };

            return makeConnection<Connection<AuthRecord, "AuthConnection", "AuthEdge">>(
                idx, {convert(gt)}, {convert(ge)}, {convert(lt)}, {convert(le)}, first, last,
                before, after);
         }

         auto account(AccountNumber name) const
         {
            AuthSig::Tables db{AuthSig::service};
            auto            account = db.open<AuthSig::AuthTable>().get(name);

            return account;
         }
      };
      PSIO_REFLECT(AuthQuery,
                   method(accWithKey, key, gt, ge, lt, le, first, last, before, after),
                   method(account, name)
                   //
      );

      std::optional<HttpReply> RAuthSig::serveSys(HttpRequest request)
      {
         if (auto result = serveGraphQL(request, AuthQuery{}))
            return result;

         if (auto result = serveSimpleUI<AuthSig, true>(request))
            return result;

         return std::nullopt;

      }  // serveSys
   }  // namespace AuthSig
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthSig::RAuthSig)
