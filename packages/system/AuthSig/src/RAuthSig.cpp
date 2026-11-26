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
      // An account as the queries report it: its record as of the current
      // block (see `effective`), not as it was last written, and the
      // recovery requests waiting for its partner.
      struct AccountStatus
      {
         AuthRecord record;
         /// Keys proposed for the account while it is frozen
         std::vector<RecoveryRequest> recoveryRequests;
         PSIO_REFLECT(AccountStatus, attr(record, psio::graphql::flatten), recoveryRequests)
      };

      namespace
      {
         TimePointSec currentTime()
         {
            return std::chrono::time_point_cast<Seconds>(getStatus().current.time);
         }

         AccountStatus status(AuthRecord stored)
         {
            AccountStatus result{effective(std::move(stored), currentTime()), {}};
            // Requests exist only while an account is frozen.
            if (result.record.state == AccountState::frozen)
               for (auto row : AuthSig::Tables{AuthSig::service, KvMode::read}
                                   .open<AuthSig::RecoveryTable>()
                                   .getIndex<0>()
                                   .subindex(result.record.account))
                  result.recoveryRequests.push_back(std::move(row));
            return result;
         }

         auto authTable()
         {
            return AuthSig::Tables{AuthSig::service, KvMode::read}.open<AuthSig::AuthTable>();
         }

         // A page of an index of accounts, each shown as its AccountStatus
         template <typename Index>
         auto accounts(Index                                   index,
                       psio::graphql::key_range<AccountNumber> range,
                       psio::graphql::page_args                page)
         {
            return psio::graphql::paginate(
                psio::graphql::transform(IndexView{std::move(index)},
                                         [](psio::shared_pssz<AuthRecord> row)
                                         { return status(row.unpack()); }),
                range, page, allRows);
         }
      }  // namespace

      struct AuthQuery
      {
         /// The accounts whose active key is this key
         auto accWithKey(string                                  pubkeyPem,
                         psio::graphql::key_range<AccountNumber> range,
                         psio::graphql::page_args                page) const
         {
            return accounts(
                authTable().getIndex<1>().subindex<AccountNumber>(
                    keyFingerprint(SubjectPublicKeyInfo{parseSubjectPublicKeyInfo(pubkeyPem)})),
                range, page);
         }

         /// The accounts whose owner key is this key
         auto accWithOwnerKey(string                                  pubkeyPem,
                              psio::graphql::key_range<AccountNumber> range,
                              psio::graphql::page_args                page) const
         {
            return accounts(
                authTable().getIndex<2>().subindex<AccountNumber>(
                    keyFingerprint(SubjectPublicKeyInfo{parseSubjectPublicKeyInfo(pubkeyPem)})),
                range, page);
         }

         /// The account as of the current block
         auto account(AccountNumber name) const -> std::optional<AccountStatus>
         {
            auto row = authTable().get(name);
            if (!row)
               return std::nullopt;
            return status(std::move(*row));
         }

         /// The accounts whose recovery partner is `partner`
         auto accountsByPartner(AccountNumber                           partner,
                                psio::graphql::key_range<AccountNumber> range,
                                psio::graphql::page_args                page) const
         {
            return accounts(authTable().getIndex<3>().subindex<AccountNumber>(partner), range,
                            page);
         }

         /// What is waiting for `partner`: its accounts that are paused, with the change
         /// that is pending if there is one (`pending`; it takes effect by itself at
         /// `stateUntil`), and its accounts that are frozen, with their recovery
         /// requests.
         ///
         /// The accounts are found by the state that is stored. An account whose pause
         /// has run out since its record was last written is still listed, in its
         /// normal state, until its record is written again (`auth-sig::refresh`).
         auto requestsForPartner(AccountNumber                           partner,
                                 psio::graphql::key_range<AccountNumber> range,
                                 psio::graphql::page_args                page) const
         {
            // The null account is where the accounts that wait for nobody are indexed.
            check(partner != AccountNumber{}, "partner required");
            return accounts(authTable().getIndex<4>().subindex<AccountNumber>(partner), range,
                            page);
         }
      };
      PSIO_REFLECT(AuthQuery,
                   method(accWithKey, pubkeyPem, range, page),
                   method(accWithOwnerKey, pubkeyPem, range, page),
                   method(account, name),
                   method(accountsByPartner, partner, range, page),
                   method(requestsForPartner, partner, range, page)
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

// The connections keep the names they had
template <>
struct psio::graphql::type_name<
    psio::graphql::connection<SystemService::AuthSig::AccountStatus>>
{
   static constexpr std::string_view value = "AuthConnection";
};
template <>
struct psio::graphql::type_name<psio::graphql::edge<SystemService::AuthSig::AccountStatus>>
{
   static constexpr std::string_view value = "AuthEdge";
};

PSIBASE_DISPATCH(SystemService::AuthSig::RAuthSig)
