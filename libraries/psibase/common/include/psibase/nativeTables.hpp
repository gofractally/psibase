#pragma once

#include <psibase/block.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   using NativeTableNum = uint16_t;

   static constexpr NativeTableNum statusTable         = 1;
   static constexpr NativeTableNum accountTable        = 2;
   static constexpr NativeTableNum codeTable           = 3;
   static constexpr NativeTableNum databaseStatusTable = 4;

   inline auto statusKey()
   {
      return std::tuple{statusTable};
   }
   struct StatusRow
   {
      Checksum256              chainId;
      std::optional<BlockInfo> head;
      uint32_t                 numExecutionMemories = 32;

      static constexpr auto db = psibase::DbId::nativeUnconstrained;
      static auto           key() { return statusKey(); }
   };
   PSIO_REFLECT(StatusRow, chainId, head, numExecutionMemories)

   // TODO: Rename account to contract?
   inline auto accountKey(AccountNumber num)
   {
      // TODO: leave space for secondary index?
      return std::tuple{accountTable, num};
   }
   struct AccountRow
   {
      static constexpr uint64_t allowSudo        = uint64_t(1) << 0;
      static constexpr uint64_t allowWriteNative = uint64_t(1) << 1;
      static constexpr uint64_t isSubjective     = uint64_t(1) << 2;
      static constexpr uint64_t canNotTimeOut    = uint64_t(1) << 3;
      static constexpr uint64_t canSetTimeLimit  = uint64_t(1) << 4;

      AccountNumber num;           // TODO: rename
      AccountNumber authContract;  // TODO: move out of native
      uint64_t      flags = 0;     // allowSudo | allowWriteNative | isSubjective

      // TODO?  1 account with contract per 1000+ without - faster perf on dispatch because don't need to lookup new account
      Checksum256 codeHash  = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;
      //==================================^^

      static constexpr auto db = psibase::DbId::nativeUnconstrained;
      auto                  key() const { return accountKey(num); }
   };
   PSIO_REFLECT(AccountRow, num, authContract, flags, codeHash, vmType, vmVersion)

   inline auto codeKey(const Checksum256& codeHash, uint8_t vmType, uint8_t vmVersion)
   {
      // TODO: leave space for secondary index?
      return std::tuple{codeTable, codeHash, vmType, vmVersion};
   }

   /// where code is actually stored, duplicate contracts are reused
   struct codeRow
   {
      // primary key
      Checksum256 codeHash  = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;
      //==================

      uint32_t             numRefs = 0;   // number accounts that ref this
      std::vector<uint8_t> code    = {};  // actual code, TODO: compressed

      // The code table is in nativeConstrained. The native code
      // verifies codeHash and the key. This prevents a poison block
      // that could happen if the key->code map doesn't match the
      // key->(jitted code) map or the key->(optimized code) map.
      static constexpr auto db = psibase::DbId::nativeConstrained;
      auto                  key() const { return codeKey(codeHash, vmType, vmVersion); }
   };
   PSIO_REFLECT(codeRow, codeHash, vmType, vmVersion, numRefs, code)

   inline auto databaseStatusKey()
   {
      return std::tuple{databaseStatusTable};
   }
   struct DatabaseStatusRow
   {
      uint64_t nextHistoryEventNumber = 1;
      uint64_t nextUIEventNumber      = 1;

      // This table is in nativeConstrained. The native code blocks contracts
      // from writing to this since it could break backing stores.
      static constexpr auto db = psibase::DbId::nativeConstrained;
      static auto           key() { return databaseStatusKey(); }
   };
   PSIO_REFLECT(DatabaseStatusRow, nextHistoryEventNumber, nextUIEventNumber)

}  // namespace psibase
