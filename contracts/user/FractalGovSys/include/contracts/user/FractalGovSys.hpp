#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/nativeTables.hpp>

namespace UserContract
{
   struct FractalGovSys : public psibase::Contract<FractalGovSys>
   {
      static constexpr auto contract = psibase::AccountNumber("fgov-sys");

      auto serveSys(psibase::RpcRequestData request) -> std::optional<psibase::RpcReplyData>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(FractalGovSys,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace UserContract
