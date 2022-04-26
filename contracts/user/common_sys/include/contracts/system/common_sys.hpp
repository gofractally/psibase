#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/native_tables.hpp>

namespace psibase
{
   struct common_sys : psibase::Contract<common_sys>
   {
      static constexpr auto contract = psibase::AccountNumber("common-sys");

      auto serveSys(rpc_request_data request) -> std::optional<rpc_reply_data>;
      void uploadSys(psio::const_view<std::string>       path,
                     psio::const_view<std::string>       contentType,
                     psio::const_view<std::vector<char>> content);
   };
   PSIO_REFLECT(common_sys,
                method(serveSys, request),
                method(uploadSys, path, contentType, content))
}  // namespace psibase
