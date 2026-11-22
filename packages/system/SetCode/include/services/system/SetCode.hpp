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

      using Key = psibase::CompositeKey<&CodeRefCountRow::codeHash,
                                        &CodeRefCountRow::vmType,
                                        &CodeRefCountRow::vmVersion>;
      auto key() const { return Key{}(*this); }
      PSIO_REFLECT(CodeRefCountRow, codeHash, vmType, vmVersion)
   };
   using CodeRefCountTable = psibase::Table<CodeRefCountRow, CodeRefCountRow::Key{}>;
   PSIO_REFLECT_TYPENAME(CodeRefCountTable)

   struct StagedCodeRow
   {
      psibase::AccountNumber from;
      psibase::AccountNumber service;
      std::uint64_t          id;
      psibase::Checksum256   codeHash;
      std::uint8_t           vmType    = 0;
      std::uint8_t           vmVersion = 0;

      using Key =
          psibase::CompositeKey<&StagedCodeRow::from, &StagedCodeRow::id, &StagedCodeRow::service>;
      auto key() const { return Key{}(*this); }
      PSIO_REFLECT(StagedCodeRow, from, service, id, codeHash, vmType, vmVersion)
   };
   using StagedCodeTable = psibase::Table<StagedCodeRow, StagedCodeRow::Key{}>;
   PSIO_REFLECT_TYPENAME(StagedCodeTable)

   struct VerifySequenceRow
   {
      std::uint64_t seq;
      PSIO_REFLECT(VerifySequenceRow, seq)
   };
   using VerifySequenceTable = psibase::Table<VerifySequenceRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(VerifySequenceTable)

   /// The execution policy version stamped on code that is deployed without
   /// asking for one. Absent until the chain sets it; then
   /// psibase::defaultVmVersion applies.
   struct DefaultVmVersionRow
   {
      std::uint8_t vmVersion = psibase::defaultVmVersion;
      PSIO_REFLECT(DefaultVmVersionRow, vmVersion)
   };
   using DefaultVmVersionTable = psibase::Table<DefaultVmVersionRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(DefaultVmVersionTable)

   /// All compiled code is uploaded to the chain through this service
   struct SetCode : psibase::Service
   {
      /// "setcode"
      static constexpr auto service = psibase::AccountNumber("setcode");

      /// Flags this service must run with
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isPrivileged;

      using Tables = psibase::ServiceTables<CodeRefCountTable,
                                            StagedCodeTable,
                                            VerifySequenceTable,
                                            DefaultVmVersionTable>;

      void init();

      /// This action is called in order to upload compiled service code to the chain
      ///
      /// Uploaded code is automatically uploaded to the account that calls the action.
      ///
      /// * `service`   - Must match the sender account
      /// * `vmType`    - Specifies the type of the WebAssembly VM. Currently must be equal to 0.
      /// * `vmVersion` - The execution policy version the code runs under until it is next
      ///                 deployed. 0 asks for the chain's default (see `defaultVmVersion`),
      ///                 which is what gets recorded. Otherwise a version this chain supports.
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
      /// * `vmVersion` - The execution policy version, as for `setCode`: 0 asks for the chain's
      ///                 default, which is settled now and recorded with the staged code.
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
      /// * `vmVersion` - 0 to accept the version recorded when the code was staged, or that
      ///                 version.
      /// * `codeHash`  - SHA256 of the compiled code
      void setCodeStaged(psibase::AccountNumber from,
                         std::uint64_t          id,
                         std::uint8_t           vmType,
                         std::uint8_t           vmVersion,
                         psibase::Checksum256   codeHash);

      /// The execution policy version recorded for code deployed with `vmVersion` 0.
      std::uint8_t defaultVmVersion();

      /// Sets the version recorded for code deployed with `vmVersion` 0. Code already
      /// deployed keeps the version it has. Only this service's own account may call it.
      void setDefaultVmVersion(std::uint8_t vmVersion);

      /// Sets the flags that a particular service must be run with
      void setFlags(psibase::AccountNumber service, uint64_t flags);

      /// Returns a sequence number that is incremented whenever
      /// the verify services change.
      std::uint64_t verifySeq();
   };
   PSIO1_REFLECT(SetCode,
                method(init),
                method(setCode, service, vmType, vmVersion, code),
                method(stageCode, service, id, vmType, vmVersion, code),
                method(unstageCode, service, id),
                method(setCodeStaged, from, id, vmType, vmVersion, codeHash),
                method(setFlags, service, flags),
                method(verifySeq),
                method(defaultVmVersion),
                method(setDefaultVmVersion, vmVersion))

   PSIBASE_REFLECT_TABLES(SetCode, SetCode::Tables)
}  // namespace SystemService
