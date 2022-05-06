#pragma once

#include <psibase/block.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   // TODO: replace with a name type?
   // TODO: rename to make it clear it's only for native tables
   using table_num = uint16_t;

   static constexpr table_num status_table        = 1;
   static constexpr table_num account_table       = 2;
   static constexpr table_num code_table          = 3;
   static constexpr table_num databaseStatusTable = 4;

   inline auto status_key()
   {
      return std::tuple{status_table};
   }
   struct status_row
   {
      Checksum256              chain_id;
      std::optional<BlockInfo> head;
      uint32_t                 num_execution_memories = 32;

      static constexpr auto kv_map = psibase::kv_map::native_unconstrained;
      static auto           key() { return status_key(); }
   };
   PSIO_REFLECT(status_row, chain_id, head, num_execution_memories)

   // TODO: Rename account to contract?
   inline auto account_key(AccountNumber num)
   {
      // TODO: leave space for secondary index?
      return std::tuple{account_table, num};
   }
   struct account_row
   {
      static constexpr uint64_t allow_sudo         = uint64_t(1) << 0;
      static constexpr uint64_t allow_write_native = uint64_t(1) << 1;
      static constexpr uint64_t is_subjective      = uint64_t(1) << 2;
      static constexpr uint64_t can_not_time_out   = uint64_t(1) << 3;
      static constexpr uint64_t can_set_time_limit = uint64_t(1) << 4;

      AccountNumber num;           // TODO: rename
      AccountNumber authContract;  // TODO: move out of native
      uint64_t      flags = 0;     // allow_sudo | allow_write_native | is_subjective

      // TODO?  1 account with contract per 1000+ without - faster perf on dispatch because don't need to lookup new account
      Checksum256 code_hash = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;
      //==================================^^

      static constexpr auto kv_map = psibase::kv_map::native_unconstrained;
      auto                  key() const { return account_key(num); }
   };
   PSIO_REFLECT(account_row, num, authContract, flags, code_hash, vmType, vmVersion)

   inline auto code_key(const Checksum256& code_hash, uint8_t vmType, uint8_t vmVersion)
   {
      // TODO: leave space for secondary index?
      return std::tuple{code_table, code_hash, vmType, vmVersion};
   }

   /// where code is actually stored, duplicate contracts are reused
   struct code_row
   {
      // primary key
      Checksum256 code_hash = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;
      //==================

      uint32_t             ref_count = 0;   // number accounts that ref this
      std::vector<uint8_t> code      = {};  // actual code, TODO: compressed

      // The code table is in native_constrained. The native code
      // verifies code_hash and the key. This prevents a poison block
      // that could happen if the key->code map doesn't match the
      // key->(jitted code) map or the key->(optimized code) map.
      static constexpr auto kv_map = psibase::kv_map::native_constrained;
      auto                  key() const { return code_key(code_hash, vmType, vmVersion); }
   };
   PSIO_REFLECT(code_row, code_hash, vmType, vmVersion, ref_count, code)

   inline auto databaseStatusKey()
   {
      return std::tuple{databaseStatusTable};
   }
   struct DatabaseStatusRow
   {
      uint64_t nextEventNumber   = 1;
      uint64_t nextUIEventNumber = 1;

      // This table is in native_constrained. The native code blocks contracts
      // from writing to this since it could break backing stores.
      static constexpr auto kv_map = psibase::kv_map::native_constrained;
      static auto           key() { return databaseStatusKey(); }
   };
   PSIO_REFLECT(DatabaseStatusRow, nextEventNumber, nextUIEventNumber)

}  // namespace psibase
