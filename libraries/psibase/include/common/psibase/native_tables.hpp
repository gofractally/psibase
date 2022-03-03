#pragma once

#include <psibase/block.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   using table_num = uint32_t;

   static constexpr table_num status_table  = 1;
   static constexpr table_num account_table = 2;
   static constexpr table_num code_table    = 3;

   inline auto status_key() { return std::tuple{status_table}; }
   struct status_row
   {
      eosio::checksum256        chain_id;
      std::optional<block_info> head;
      uint32_t                  num_execution_memories = 32;

      static constexpr auto kv_map = psibase::kv_map::native_unconstrained;
      static auto           key() { return status_key(); }
   };
   EOSIO_REFLECT(status_row, chain_id, head, num_execution_memories)

   // TODO: Rename account to contract?
   inline auto account_key(account_num num)
   {
      // TODO: leave space for secondary index?
      return std::tuple{account_table, num};
   }
   struct account_row
   {
      static constexpr uint64_t allow_sudo         = uint64_t(1) << 0;
      static constexpr uint64_t allow_write_native = uint64_t(1) << 1;
      static constexpr uint64_t is_subjective      = uint64_t(1) << 2;

      account_num        num           = 0;
      account_num        auth_contract = 0;  // TODO: move out of native
      uint64_t           flags         = 0;
      eosio::checksum256 code_hash     = {};
      uint8_t            vm_type       = 0;
      uint8_t            vm_version    = 0;

      static constexpr auto kv_map = psibase::kv_map::native_unconstrained;
      auto                  key() const { return account_key(num); }
   };
   EOSIO_REFLECT(account_row, num, auth_contract, flags, code_hash, vm_type, vm_version)

   inline auto code_key(const eosio::checksum256& code_hash, uint8_t vm_type, uint8_t vm_version)
   {
      // TODO: leave space for secondary index?
      return std::tuple{code_table, code_hash, vm_type, vm_version};
   }
   struct code_row
   {
      eosio::checksum256   code_hash  = {};
      uint8_t              vm_type    = 0;
      uint8_t              vm_version = 0;
      uint32_t             ref_count  = 0;
      std::vector<uint8_t> code       = {};

      // The code table is in native_constrained. The native code
      // verifies code_hash and the key. This prevents a poison block
      // that could happen if the key->code map doesn't match the
      // key->(jitted code) map or the key->(optimized code) map.
      static constexpr auto kv_map = psibase::kv_map::native_constrained;
      auto                  key() const { return code_key(code_hash, vm_type, vm_version); }
   };
   EOSIO_REFLECT(code_row, code_hash, vm_type, vm_version, ref_count, code)
}  // namespace psibase
