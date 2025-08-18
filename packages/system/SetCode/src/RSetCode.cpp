#include <services/system/RSetCode.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/SetCode.hpp>

namespace SystemService
{
   using namespace psibase;

   namespace
   {
      std::string to_hex(const std::vector<unsigned char>& code)
      {
         const char* xdigits = "0123456789ABCDEF";
         std::string result;
         for (unsigned char ch : code)
         {
            result += xdigits[(ch >> 4) & 0xF];
            result += xdigits[ch & 0xF];
         }
         return result;
      }
      struct CodeRecord
      {
         AccountNumber            codeNum;
         std::vector<std::string> flags;
         Checksum256              codeHash  = {};
         uint8_t                  vmType    = 0;
         uint8_t                  vmVersion = 0;

         std::string codeHex() const
         {
            auto codeByHasRow =
                kvGet<CodeByHashRow>(CodeByHashRow::db, codeByHashKey(codeHash, vmType, vmVersion));
            check(!!codeByHasRow, "Raw code not found");
            return to_hex((*codeByHasRow).code);
         }

         PSIO_REFLECT(CodeRecord, codeNum, flags, codeHash, vmType, vmVersion, method(codeHex))
      };

      auto convertFlags(uint64_t flags) -> std::vector<std::string>
      {
         std::vector<std::string> result;
         if (flags & CodeRow::isPrivileged)
            result.push_back("isPrivileged");
         if (flags & CodeRow::isVerify)
            result.push_back("isVerify");
         switch (flags & CodeRow::runMode)
         {
            case CodeRow::runModeRpc:
               result.push_back("runModeRpc");
               break;
            case CodeRow::runModeCallback:
               result.push_back("runModeCallback");
               break;
         }
         return result;
      }

      auto toCodeRecord(CodeRow&& codeRow) -> CodeRecord
      {
         return CodeRecord{.codeNum   = codeRow.codeNum,
                           .flags     = convertFlags(codeRow.flags),
                           .codeHash  = codeRow.codeHash,
                           .vmType    = codeRow.vmType,
                           .vmVersion = codeRow.vmVersion};
      }
   }  // namespace

   struct Query
   {
      auto code(AccountNumber account) const -> std::optional<CodeRecord>
      {
         auto codeRow = kvGet<CodeRow>(CodeRow::db, codeKey(account));
         if (!codeRow)
            return std::nullopt;
         return toCodeRecord(std::move(*codeRow));
      }
   };
   PSIO_REFLECT(Query, method(code, account))

   std::optional<psibase::HttpReply> RSetCode::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RSetCode)
