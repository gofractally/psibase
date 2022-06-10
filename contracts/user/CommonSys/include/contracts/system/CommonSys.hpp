#pragma once

#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>

namespace psibase
{
   ///
   struct CommonSys : psibase::Contract<CommonSys>
   {
      static constexpr auto contract = psibase::AccountNumber("common-sys");

      auto serveSys(RpcRequestData request) -> std::optional<RpcReplyData>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(CommonSys, method(serveSys, request), method(storeSys, path, contentType, content))
}  // namespace psibase
