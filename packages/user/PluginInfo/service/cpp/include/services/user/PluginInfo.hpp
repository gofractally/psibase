#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/psibase.hpp>
#include <services/user/pluginInfoTables.hpp>

namespace UserService
{
   class PluginInfo : public psibase::Service
   {
     public:
      using Tables = psibase::ServiceTables<PluginCacheTable, PluginMappingTable>;

      static constexpr auto service = psibase::AccountNumber("plugin-info");

      void cachePlugin(psibase::AccountNumber service, std::string path);

      std::optional<PluginCacheRow> getPluginCache(psibase::Checksum256 content_hash);
   };

   PSIO_REFLECT(PluginInfo,
                method(cachePlugin, service, path),
                method(getPluginCache, content_hash));

   PSIBASE_REFLECT_TABLES(PluginInfo, PluginInfo::Tables)
}  // namespace UserService
