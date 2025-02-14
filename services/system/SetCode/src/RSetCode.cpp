#include <services/system/RSetCode.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSchema.hpp>
#include <services/system/SetCode.hpp>

namespace SystemService
{
   using namespace psibase;

   struct Query
   {
      auto code(AccountNumber account) const
      {
         return kvGet<CodeRow>(CodeRow::db, codeKey(account));
      }

      auto codeRaw(Checksum256 code_hash, uint8_t vm_type, uint8_t vm_version) const
      {
         return kvGet<CodeByHashRow>(CodeByHashRow::db,
                                     codeByHashKey(code_hash, vm_type, vm_version));
      }
   };
   PSIO_REFLECT(  //
       Query,
       method(code, account),
       method(codeRaw, code_hash, vm_type, vm_version))

   std::optional<psibase::HttpReply> RSetCode::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveSchema<SetCode>(request))
         return result;
      else if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RSetCode)
