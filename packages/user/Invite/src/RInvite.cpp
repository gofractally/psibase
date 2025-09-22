#include <psibase/psibase.hpp>
#include <services/system/AuthSig.hpp>
#include <services/user/Invite.hpp>
#include <services/system/Credentials.hpp>
#include "psibase/Actor.hpp"
#include "psibase/Rpc.hpp"
#include "psibase/serveGraphQL.hpp"
#include "psibase/time.hpp"

namespace UserService
{

   // TODO - tell whether an invite is expired from a query

   namespace InviteNs
   {
      using namespace psibase;
      using SystemService::Credentials;

      struct InviteEvent
      {
         uint32_t               inviteId;
         AccountNumber actor;
         TimePointUSec datetime;
         std::string            event;
      };
      PSIO_REFLECT(InviteEvent, inviteId, actor, datetime, event);

      struct InviteDetails {
         uint32_t inviteId;
         uint32_t cid;
         AccountNumber inviter;
         uint16_t numAccounts;
         bool useHooks;
         std::string secret;
         
         auto expiryDate() const -> std::optional<TimePointSec> {
            return to<Credentials>().get_expiry_date(cid);
         }

      };
      PSIO_REFLECT(InviteDetails, inviteId, cid, inviter, numAccounts, useHooks, secret, method(expiryDate));


      auto toInviteDetails(const InviteRecord& invite)   
      {
         return InviteDetails{
            .inviteId = invite.id,
            .cid = invite.cid,
            .inviter = invite.inviter,
            .numAccounts = invite.numAccounts,
            .useHooks = invite.useHooks,
            .secret = invite.secret,
         };
      }

      struct Query
      {
         auto inviteById(uint32_t inviteId) const -> std::optional<InviteDetails>
         {
            auto invite = Invite::Tables(Invite::service).open<InviteTable>().get(inviteId);
            if (!invite.has_value())
               return std::nullopt;

            return toInviteDetails(invite.value());
         }

         auto invitesByInviter(AccountNumber owner) const
         {
            auto idx = Invite::Tables(Invite::service)
                .open<InviteTable>()
                .getIndex<1>()
                .subindex<uint32_t>(owner);

               return TransformedConnection(idx, [](auto&& row) {
                  return toInviteDetails(row);
               });
         }

         auto history(uint32_t                   inviteId,
                      std::optional<int32_t>     first,
                      std::optional<int32_t>     last,
                      std::optional<std::string> before,
                      std::optional<std::string> after) const
         {
            return EventQuery<InviteEvent>("history.invite.updated")
                .condition(std::format("inviteId = {}", inviteId))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query();
         }
      };
      PSIO_REFLECT(Query,
                   method(inviteById, inviteId),
                   method(invitesByInviter, inviter),
                   method(history, inviteId, first, last, before, after))

      class RInvite : public Service
      {
        public:
         static constexpr auto service = AccountNumber("r-invite");

         auto serveSys(HttpRequest request) -> std::optional<HttpReply>
         {
            if (auto result = serveSimpleUI<Invite, true>(request))
               return result;

            if (auto result = serveGraphQL(request, Query{}))
               return result;

            return std::nullopt;
         }
      };
      PSIO_REFLECT(RInvite, method(serveSys, request))
      PSIBASE_REFLECT_TABLES(RInvite)
   }  // namespace InviteNs
}  // namespace UserService

PSIBASE_DISPATCH(UserService::InviteNs::RInvite)
