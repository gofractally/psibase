#pragma once

#include <psibase/block.hpp>
#include <psibase/db.hpp>

#include <algorithm>

namespace psibase
{
   using NativeTableNum = uint16_t;

   static constexpr NativeTableNum statusTable                = 1;
   static constexpr NativeTableNum codeTable                  = 2;
   static constexpr NativeTableNum codeByHashTable            = 3;
   static constexpr NativeTableNum databaseStatusTable        = 4;
   static constexpr NativeTableNum transactionWasmConfigTable = 5;
   static constexpr NativeTableNum proofWasmConfigTable       = 6;  // Also for first auth
   static constexpr NativeTableNum configTable                = 7;

   static constexpr uint8_t nativeTablePrimaryIndex = 0;

   inline auto statusKey()
   {
      return std::tuple{statusTable, nativeTablePrimaryIndex};
   }
   struct StatusRow
   {
      Checksum256                                    chainId;
      BlockHeader                                    current;
      std::optional<BlockInfo>                       head;
      Consensus                                      consensus;
      std::optional<std::tuple<Consensus, BlockNum>> nextConsensus;
      std::vector<BlockHeaderAuthAccount>            authServices;

      static constexpr auto db = psibase::DbId::nativeUnconstrained;
      static auto           key() { return statusKey(); }
   };
   PSIO_REFLECT(StatusRow, chainId, current, head, consensus, nextConsensus, authServices)

   struct ConfigRow
   {
      uint32_t maxKeySize   = 128;
      uint32_t maxValueSize = 8 << 20;

      static constexpr auto db = psibase::DbId::nativeConstrained;

      static auto key() { return std::tuple{configTable, nativeTablePrimaryIndex}; }
   };
   PSIO_REFLECT(ConfigRow, maxKeySize, maxValueSize)

   // The existing eos-vm implementation limits are:
   // - branch offsets, and stack offsets must fit in a signed 32-bit int
   // - The total compiled module size must be < 1 GB (note that this
   //   implies that 32-bit branches are okay.) The maximum amplification
   //   factor is currently 79, if we round up to 128, that means that
   //   wasms up to 8 MB are safe, which is coincidentally the db maxValueSize.
   //
   struct VMOptions
   {
      // This is a safe value that is larger than any reasonable stack size
      static constexpr std::uint32_t max_func_local_bytes = 128 * 1024 * 1024;
      static constexpr bool          enable_simd          = true;
      static constexpr std::uint32_t stack_usage_for_call = 4096;

      std::uint32_t max_mutable_global_bytes = 1024;
      std::uint32_t max_pages                = 512;  // 32 MiB
      std::uint32_t max_table_elements       = 8192;
      // This is the total across all modules
      std::uint32_t max_stack_bytes = 1024 * 1024;

      friend auto operator<=>(const VMOptions&, const VMOptions&) = default;
   };
   PSIO_REFLECT(VMOptions, max_mutable_global_bytes, max_pages, max_table_elements, max_stack_bytes)

   struct WasmConfigRow
   {
      uint32_t  numExecutionMemories = 32;
      VMOptions vmOptions;

      static constexpr auto db = psibase::DbId::nativeConstrained;

      static auto key(NativeTableNum TableNum)
      {
         return std::tuple{TableNum, nativeTablePrimaryIndex};
      }
   };
   PSIO_REFLECT(WasmConfigRow, numExecutionMemories, vmOptions)

   inline auto codePrefix()
   {
      return std::tuple{codeTable, nativeTablePrimaryIndex};
   }
   inline auto codeKey(AccountNumber codeNum)
   {
      return std::tuple{codeTable, nativeTablePrimaryIndex, codeNum};
   }
   struct CodeRow
   {
      // Constants for flags
      static constexpr uint64_t allowSudo            = uint64_t(1) << 0;
      static constexpr uint64_t allowWriteNative     = uint64_t(1) << 1;
      static constexpr uint64_t isSubjective         = uint64_t(1) << 2;
      static constexpr uint64_t allowWriteSubjective = uint64_t(1) << 3;
      static constexpr uint64_t canNotTimeOut        = uint64_t(1) << 4;
      static constexpr uint64_t canSetTimeLimit      = uint64_t(1) << 5;
      static constexpr uint64_t isAuthService        = uint64_t(1) << 6;

      AccountNumber codeNum;
      uint64_t      flags = 0;  // Constants above

      Checksum256 codeHash  = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;

      static constexpr auto db = psibase::DbId::nativeConstrained;
      auto                  key() const { return codeKey(codeNum); }
   };
   PSIO_REFLECT(CodeRow, codeNum, flags, codeHash, vmType, vmVersion)

   inline auto codeByHashKey(const Checksum256& codeHash, uint8_t vmType, uint8_t vmVersion)
   {
      return std::tuple{codeByHashTable, nativeTablePrimaryIndex, codeHash, vmType, vmVersion};
   }

   /// where code is actually stored, duplicate services are reused
   struct CodeByHashRow
   {
      Checksum256 codeHash  = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;

      uint32_t             numRefs = 0;   // number accounts that ref this
      std::vector<uint8_t> code    = {};  // actual code, TODO: compressed

      // The code table is in nativeConstrained. The native code
      // verifies codeHash and the key. This prevents a poison block
      // that could happen if the key->code map doesn't match the
      // key->(jitted code) map or the key->(optimized code) map.
      static constexpr auto db = psibase::DbId::nativeConstrained;
      auto                  key() const { return codeByHashKey(codeHash, vmType, vmVersion); }
   };
   PSIO_REFLECT(CodeByHashRow, codeHash, vmType, vmVersion, numRefs, code)

   inline auto getCodeKeys(const std::vector<BlockHeaderAuthAccount>& services)
   {
      std::vector<decltype(codeByHashKey(Checksum256(), 0, 0))> result;
      for (const auto& s : services)
      {
         result.push_back(codeByHashKey(s.codeHash, s.vmType, s.vmVersion));
      }
      std::sort(result.begin(), result.end());
      result.erase(std::unique(result.begin(), result.end()), result.end());
      return result;
   }

   inline auto databaseStatusKey()
   {
      return std::tuple{databaseStatusTable, nativeTablePrimaryIndex};
   }
   struct DatabaseStatusRow
   {
      uint64_t nextHistoryEventNumber = 1;
      uint64_t nextUIEventNumber      = 1;
      uint64_t nextMerkleEventNumber  = 1;

      uint64_t blockMerkleEventNumber = 1;

      // This table is in nativeConstrained. The native code blocks services
      // from writing to this since it could break backing stores.
      static constexpr auto db = psibase::DbId::nativeConstrained;
      static auto           key() { return databaseStatusKey(); }
   };
   PSIO_REFLECT(DatabaseStatusRow, nextHistoryEventNumber, nextUIEventNumber, nextMerkleEventNumber)

}  // namespace psibase
