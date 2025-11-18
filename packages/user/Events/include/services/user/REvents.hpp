#pragma once

#include <optional>
#include <psibase/AccountNumber.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psio/reflect.hpp>

namespace UserService
{
   struct REvents : psibase::Service
   {
      static constexpr psibase::AccountNumber service{"r-events"};

      // Synchronous calls between other services
      std::vector<char> sqlQuery(const std::string& query, const std::vector<std::string>& params);

      // Standard HTTP API
      std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest&);
   };
   PSIO_REFLECT(REvents, method(sqlQuery, query, params), method(serveSys, request))
   PSIBASE_REFLECT_TABLES(REvents)

}  // namespace UserService
