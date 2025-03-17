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

   struct StagedCodeRow
   {
      psibase::AccountNumber from;
      psibase::AccountNumber service;
      std::uint64_t          id;
      psibase::Checksum256   codeHash;
      std::uint8_t           vmType    = 0;
      std::uint8_t           vmVersion = 0;
      auto                   key() const { return std::tuple(from, id, service); }
      PSIO_REFLECT(StagedCodeRow, from, service, id, codeHash, vmType, vmVersion)
   };
   using StagedCodeTable = psibase::Table<StagedCodeRow, &StagedCodeRow::key>;

   /// All compiled code is uploaded to the chain through this service
   struct SetCode : psibase::Service
   {
      /// "setcode"
      static constexpr auto service = psibase::AccountNumber("setcode");

      /// Flags this service must run with
      static constexpr uint64_t serviceFlags = psibase::CodeRow::allowWriteNative;

      using Tables = psibase::ServiceTables<CodeRefCountTable, StagedCodeTable>;

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

      /// This action is called in order to upload compiled service code to the chain
      ///
      /// The uploaded code will not take effect until the service calls setCodeStaged.
      ///
      /// * `service`   - The service account that the code is intended for. This account is not required to exists when stageCode is called.
      /// * `id`        - A unique id chosen by the sender.
      /// * `vmType`    - Specifies the type of the WebAssembly VM. Currently must be equal to 0.
      /// * `vmVersion` - Specifies the version of the WebAssembly VM. Currently must be equal to 0.
      /// * `code`      - A byte array containing the compiled code to upload
      void stageCode(psibase::AccountNumber service,
                     std::uint64_t          id,
                     std::uint8_t           vmType,
                     std::uint8_t           vmVersion,
                     std::vector<char>      code);

      /// Removes previously staged code.
      void unstageCode(psibase::AccountNumber service, std::uint64_t id);

      /// Loads compiled service code that was previously uploaded by stageCode
      ///
      /// * `from`      - The account that staged the code
      /// * `id`        - The id that was passed to `stageCode`
      /// * `vmType`    - Specifies the type of the WebAssembly VM. Currently must be equal to 0.
      /// * `vmVersion` - Specifies the version of the WebAssembly VM. Currently must be equal to 0.
      /// * `codeHash`  - SHA256 of the compiled code
      void setCodeStaged(psibase::AccountNumber from,
                         std::uint64_t          id,
                         std::uint8_t           vmType,
                         std::uint8_t           vmVersion,
                         psibase::Checksum256   codeHash);

      /// Sets the flags that a particular service must be run with
      void setFlags(psibase::AccountNumber service, uint64_t flags);
   };
   PSIO_REFLECT(SetCode,
                method(init),
                method(setCode, service, vmType, vmVersion, code),
                method(stageCode, service, id, vmType, vmVersion, code),
                method(unstageCode, service, id),
                method(setCodeStaged, from, id, vmType, vmVersion, codeHash),
                method(setFlags, service, flags))
}  // namespace SystemService
