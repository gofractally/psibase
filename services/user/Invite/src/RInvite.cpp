#include <psibase/psibase.hpp>
#include <services/system/AuthSig.hpp>
#include <services/user/Invite.hpp>

namespace UserService
{
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
         {  //
            return Invite::Tables(Invite::service).open<InviteTable>().getIndex<0>();
         }

         auto inviter(psibase::AccountNumber user) const
         {
            return Invite::Tables(Invite::service).open<InviteNs::NewAccTable>().get(user);
         }

         auto inviteById(uint32_t inviteId) const
         {
            return Invite::Tables(Invite::service).open<InviteTable>().get(inviteId);
         }

         auto inviteById2(uint32_t secondaryId) const -> std::optional<InviteRecord>
         {
            auto idx = Invite::Tables(Invite::service)
                           .open<InviteTable>()
                           .getIndex<2>()
                           .subindex(std::optional<uint32_t>{secondaryId});
            if (idx.begin() == idx.end())
               return std::nullopt;
            return std::optional<InviteRecord>{*idx.begin()};
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
                   method(inviter, user),
                   method(inviteById, inviteId),
                   method(inviteById2, secondaryId),
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
   }  // namespace InviteNs
}  // namespace UserService

PSIBASE_DISPATCH(UserService::InviteNs::RInvite)
