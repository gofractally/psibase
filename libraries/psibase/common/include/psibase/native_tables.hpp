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

      AccountNumber num;            // TODO: rename
      AccountNumber auth_contract;  // TODO: move out of native
      uint64_t      flags = 0;      // allow_sudo | allow_write_native | is_subjective

      // TODO?  1 account with contract per 1000+ without - faster perf on dispatch because don't need to lookup new account
      Checksum256 code_hash  = {};
      uint8_t     vm_type    = 0;
      uint8_t     vm_version = 0;
      //==================================^^

      static constexpr auto kv_map = psibase::kv_map::native_unconstrained;
      auto                  key() const { return account_key(num); }
   };
   PSIO_REFLECT(account_row, num, auth_contract, flags, code_hash, vm_type, vm_version)

   inline auto code_key(const Checksum256& code_hash, uint8_t vm_type, uint8_t vm_version)
   {
      // TODO: leave space for secondary index?
      return std::tuple{code_table, code_hash, vm_type, vm_version};
   }

   /// where code is actually stored, duplicate contracts are reused
   struct code_row
   {
      // primary key
      Checksum256 code_hash  = {};
      uint8_t     vm_type    = 0;
      uint8_t     vm_version = 0;
      //==================

      uint32_t             ref_count = 0;   // number accounts that ref this
      std::vector<uint8_t> code      = {};  // actual code, TODO: compressed

      // The code table is in native_constrained. The native code
      // verifies code_hash and the key. This prevents a poison block
      // that could happen if the key->code map doesn't match the
      // key->(jitted code) map or the key->(optimized code) map.
      static constexpr auto kv_map = psibase::kv_map::native_constrained;
      auto                  key() const { return code_key(code_hash, vm_type, vm_version); }
   };
   PSIO_REFLECT(code_row, code_hash, vm_type, vm_version, ref_count, code)

   inline auto databaseStatusKey()
   {
      return std::tuple{databaseStatusTable};
   }
   struct DatabaseStatusRow
   {
      uint64_t nextEventNumber = 1;

      // This table is in native_constrained. The native code blocks contracts
      // from writing to this since it could break backing stores.
      static constexpr auto kv_map = psibase::kv_map::native_constrained;
      static auto           key() { return databaseStatusKey(); }
   };
   PSIO_REFLECT(DatabaseStatusRow, nextEventNumber)

}  // namespace psibase
