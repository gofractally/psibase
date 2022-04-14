#pragma once
#include <psibase/contract.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace psibase
{
   struct common_sys : psibase::contract
   {
      static constexpr auto contract = psibase::AccountNumber("common-sys");

      rpc_reply_data serveSys(rpc_request_data request);
      void           uploadSys(psio::const_view<std::string>       path,
                               psio::const_view<std::string>       contentType,
                               psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT(common_sys,
                method(serveSys, request),
                method(uploadSys, path, contentType, content))
}  // namespace psibase
