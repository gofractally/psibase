#pragma once

#include <cstdint>
#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/nativeTables.hpp>
#include <string>

namespace TestService
{

   struct SubjectiveCounterRow
   {
      std::string   key;
      std::uint32_t value;
   };

   PSIO_REFLECT(SubjectiveCounterRow, key, value)

   using SubjectiveCounterTable = psibase::Table<SubjectiveCounterRow, &SubjectiveCounterRow::key>;
   PSIO_REFLECT_TYPENAME(SubjectiveCounterTable)

   struct SubjectiveCounterService : psibase::Service
   {
      using Tables                       = psibase::SubjectiveTables<SubjectiveCounterTable>;
      static constexpr auto service      = psibase::AccountNumber{"counter"};
      static constexpr auto serviceFlags = psibase::CodeRow::isPrivileged;
      std::uint32_t         inc(std::string key, std::uint32_t id);
      void                  checkIncRpc(std::string key, std::uint32_t id, std::uint32_t expected);
      void          checkIncCallback(std::string key, std::uint32_t id, std::uint32_t expected);
      std::uint32_t incImpl(std::string key, std::uint32_t id);
      std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest& req);
   };
   PSIO_REFLECT(SubjectiveCounterService,
                method(inc, key, id),
                method(checkIncRpc, key, id, expected),
                method(checkIncCallback, key, id, expected),
                method(incImpl, key, id),
                method(serveSys, req))
   PSIBASE_REFLECT_TABLES(SubjectiveCounterService, SubjectiveCounterService::Tables)

}  // namespace TestService
