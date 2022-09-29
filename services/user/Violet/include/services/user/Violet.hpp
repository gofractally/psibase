#pragma once

#include <compare>
#include <psibase/Service.hpp>
#include <string_view>
#include <psibase/Rpc.hpp>
#include <optional>
#include <string>
#include <vector>
#include <psibase/Table.hpp>
#include <psibase/serveContent.hpp>


namespace Violet
{

   struct CounterRow
   {
      psibase::AccountNumber account;
      uint32_t               counter;
   };
   PSIO_REFLECT(CounterRow, account, counter);

   using CounterTable = psibase::Table<CounterRow, &CounterRow::account>;
   using Tables = psibase::ServiceTables<psibase::WebContentTable, CounterTable>;

   class VioletService
   {
     public:
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

      void increment(uint32_t num);
   };

   // clang-format off
   PSIO_REFLECT(
      VioletService, 
      method(increment, num),
      method(serveSys, request), 
      method(storeSys, path, contentType, content)
   );
   // clang-format on

}  // namespace Violet
