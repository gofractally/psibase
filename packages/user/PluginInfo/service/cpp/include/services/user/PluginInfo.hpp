#pragma once

#include <psibase/psibase.hpp>
#include <psibase/Rpc.hpp>

namespace UserService
{
   struct PluginInfo
   {
      static constexpr auto service = psibase::AccountNumber("plugin-info");

      void cachePlugin(psibase::AccountNumber service, std::string path);
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(PluginInfo, method(cachePlugin, service, path), method(serveSys, request));
}
