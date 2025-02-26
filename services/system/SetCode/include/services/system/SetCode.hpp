#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   struct CodeRefCountRow
   {
      psibase::Checksum256 codeHash  = {};
      std::uint8_t         vmType    = 0;
      std::uint8_t         vmVersion = 0;
      std::uint32_t        numRefs   = 0;

      auto key() const { return std::tuple{codeHash, vmType, vmVersion}; }
      PSIO_REFLECT(CodeRefCountRow, codeHash, vmType, vmVersion)
   };
   using CodeRefCountTable = psibase::Table<CodeRefCountRow, &CodeRefCountRow::key>;

   /// All compiled code is uploaded to the chain through this service
   struct SetCode : psibase::Service
   {
      /// "setcode"
      static constexpr auto service = psibase::AccountNumber("setcode");

      /// Flags this service must run with
      static constexpr uint64_t serviceFlags = psibase::CodeRow::allowWriteNative;

      using Tables = psibase::ServiceTables<CodeRefCountTable>;

      void init();

      /// This action is called in order to upload compiled service code to the chain
      ///
      /// Uploaded code is automatically uploaded to the account that calls the action.
      ///
      /// * `service`   - Must match the sender account
      /// * `vmType`    - Specifies the type of the WebAssembly VM. Currently must be equal to 0.
      /// * `vmVersion` - Specifies the version of the WebAssembly VM. Currently must be equal to 0.
      /// * `code`      - A byte array containing the compiled code to upload
      void setCode(psibase::AccountNumber service,
                   uint8_t                vmType,
                   uint8_t                vmVersion,
                   std::vector<char>      code);

      /// Sets the flags that a particular service must be run with
      void setFlags(psibase::AccountNumber service, uint64_t flags);
   };
   PSIO_REFLECT(SetCode,
                method(init),
                method(setCode, service, vmType, vmVersion, code),
                method(setFlags, service, flags))
}  // namespace SystemService
