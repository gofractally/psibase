#pragma once

#include <psibase/Contract.hpp>
#include <psibase/Rpc.hpp>

namespace system_contract
{
   struct PsiSpaceContentKey
   {
      psibase::AccountNumber account = {};
      std::string            path    = {};

      // TODO: upgrade wasi-sdk; <=> for string is missing
      friend bool operator<(const PsiSpaceContentKey& a, const PsiSpaceContentKey& b)
      {
         return std::tie(a.account, a.path) < std::tie(b.account, b.path);
      }
   };
   PSIO_REFLECT(PsiSpaceContentKey, account, path)

   struct PsiSpaceContentRow
   {
      psibase::AccountNumber account     = {};
      std::string            path        = {};
      std::string            contentType = {};
      std::vector<char>      content     = {};

      PsiSpaceContentKey key() const { return {account, path}; }
   };
   PSIO_REFLECT(PsiSpaceContentRow, account, path, contentType, content)
   using PsiSpaceContentTable = psibase::Table<PsiSpaceContentRow, &PsiSpaceContentRow::key>;

   struct PsiSpaceSys : psibase::Contract<PsiSpaceSys>
   {
      static constexpr auto contract = psibase::AccountNumber("psispace-sys");
      using Tables                   = psibase::ContractTables<PsiSpaceContentTable>;

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
   };

   PSIO_REFLECT(PsiSpaceSys,
                method(serveSys, request),
                method(storeSys, path, contentType, content))
}  // namespace system_contract
