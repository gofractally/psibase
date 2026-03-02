#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/psibase.hpp>

namespace UserService
{
   struct PluginInfo
   {
      static constexpr auto service = psibase::AccountNumber("plugin-info");

      void cachePlugin(psibase::AccountNumber service, std::string path);
      bool isCached(psibase::Checksum256 content_hash);
      auto getPluginContentHash(psibase::AccountNumber service,
                                std::string            path) -> std::optional<psibase::Checksum256>;
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(PluginInfo,
                method(cachePlugin, service, path),
                method(isCached, content_hash),
                method(getPluginContentHash, service, path),
                method(serveSys, request));
}  // namespace UserService
