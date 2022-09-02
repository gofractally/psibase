#pragma once
#include <psibase/Contract.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   struct ExploreSys : public psibase::Contract<ExploreSys>
   {
      static constexpr auto service = psibase::AccountNumber("explore-sys");

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };
   PSIO_REFLECT(ExploreSys,  //
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace system_contract
