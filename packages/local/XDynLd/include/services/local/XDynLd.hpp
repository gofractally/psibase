#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <services/user/DynLd.hpp>

namespace LocalService
{
   struct XDynLdLinkRequest
   {
      psibase::AccountNumber              service;
      std::string                         group;
      std::vector<UserService::DynDep> deps;
      PSIO_REFLECT(XDynLdLinkRequest, service, group, deps)
   };

   struct XDynLdUnlinkRequest
   {
      psibase::AccountNumber service;
      std::string            group;
      PSIO_REFLECT(XDynLdUnlinkRequest, service, group)
   };

   struct XDynLd : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-dyn-ld"};
      using Subjective =
          psibase::SubjectiveTables<UserService::DynDepsTable, UserService::DynDepGroupsTable>;
      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        request,
                                                 std::optional<std::int32_t> socket);

      void link(psibase::AccountNumber              service,
                std::string                         group,
                std::vector<UserService::DynDep> deps);
      void unlink(psibase::AccountNumber service, std::string group);
   };
   PSIO_REFLECT(XDynLd, method(serveSys, request, socket))
   PSIBASE_REFLECT_TABLES(XDynLd, XDynLd::Subjective)
}  // namespace LocalService
