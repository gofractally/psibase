#include <psibase/psibase.hpp>
#include <services/system/AuthSig.hpp>
#include <services/user/Invite.hpp>

namespace UserService
{

   // TODO - tell whether an invite is expired from a query

   namespace InviteNs
   {
      struct InviteEvent
      {
         uint32_t               inviteId;
         psibase::AccountNumber actor;
         psibase::TimePointUSec datetime;
         std::string            event;
      };
      PSIO_REFLECT(InviteEvent, inviteId, actor, datetime, event);

      struct Query
      {
         auto invites() const
         {  // TODO: Paginate
            return Invite::Tables(Invite::service).open<InviteTable>().getIndex<0>();
         }

         auto inviteById(uint32_t inviteId) const
         {
            return Invite::Tables(Invite::service).open<InviteTable>().get(inviteId);
         }

         auto invitesByInviter(psibase::AccountNumber owner) const
         {
            return Invite::Tables(Invite::service)
                .open<InviteTable>()
                .getIndex<1>()
                .subindex<uint32_t>(owner);
         }

         auto history(uint32_t                   inviteId,
                      std::optional<int32_t>     first,
                      std::optional<int32_t>     last,
                      std::optional<std::string> before,
                      std::optional<std::string> after) const
         {
            return psibase::EventQuery<InviteEvent>("history.invite.updated")
                .condition(std::format("inviteId = {}", inviteId))
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query();
         }
      };
      PSIO_REFLECT(Query,
                   method(invites),
                   method(inviteById, inviteId),
                   method(invitesByInviter, inviter),
                   method(history, inviteId, first, last, before, after))

      class RInvite : public psibase::Service
      {
        public:
         static constexpr auto service = psibase::AccountNumber("r-invite");

         auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>
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
