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
         auto accWithKey(string                                  pubkeyPem,
                         psio::graphql::key_range<AccountNumber> range,
                         psio::graphql::page_args                page) const
         {
            auto idx =
                AuthSig::Tables{AuthSig::service}.open<AuthSig::AuthTable>().getIndex<1>().subindex(
                    keyFingerprint(SubjectPublicKeyInfo{parseSubjectPublicKeyInfo(pubkeyPem)}));

            return psio::graphql::paginate(IndexView{std::move(idx)}, range, page, allRows);
         }

         auto account(AccountNumber name) const
         {
            AuthSig::Tables db{AuthSig::service};
            auto            account = db.open<AuthSig::AuthTable>().get(name);

            return account;
         }
      };
      PSIO_REFLECT(AuthQuery,
                   method(accWithKey, pubkeyPem, range, page),
                   method(account, name)
                   //
      );
      PSIO_TYPE_ATTRS(AuthQuery, psio::graphql::name_as{"Query"})

      std::optional<HttpReply> RAuthSig::serveSys(HttpRequest request)
      {
         if (auto result = serveGraphQL(request, AuthQuery{}))
            return result;

         if (auto result = serveSimpleUI<AuthSig, false>(request))
            return result;

         return std::nullopt;

      }  // serveSys
   }  // namespace AuthSig
}  // namespace SystemService

// The connection of `accWithKey` keeps its names
template <>
struct psio::graphql::type_name<
    psio::graphql::connection<psio::shared_pssz<SystemService::AuthSig::AuthRecord>>>
{
   static constexpr std::string_view value = "AuthConnection";
};
template <>
struct psio::graphql::type_name<
    psio::graphql::edge<psio::shared_pssz<SystemService::AuthSig::AuthRecord>>>
{
   static constexpr std::string_view value = "AuthEdge";
};

PSIBASE_DISPATCH(SystemService::AuthSig::RAuthSig)
