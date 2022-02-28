#pragma once

#include <newchain/block.hpp>

namespace newchain
{
   using table_num = uint32_t;

   static constexpr account_num native_account = 0;  // native tables live in this space
   static constexpr table_num   status_table   = 1;
   static constexpr table_num   account_table  = 2;
   static constexpr table_num   code_table     = 3;

   inline auto status_key() { return std::tuple{native_account, status_table}; }
   struct status_row
   {
      eosio::checksum256        chain_id;
      std::optional<block_info> head;
      account_num               next_account_num       = 2;  // TODO: move out of native
      uint32_t                  num_execution_memories = 32;

      static auto key() { return status_key(); }
   };
   EOSIO_REFLECT(status_row, chain_id, head, next_account_num, num_execution_memories)

   // TODO: Rename account to contract?
   inline auto account_key(account_num num)
   {
      // TODO: leave space for secondary index?
      return std::tuple{native_account, account_table, num};
   }
   struct account_row
   {
      static constexpr uint32_t allow_sudo            = 0x01;
      static constexpr uint32_t transaction_psi_flags = allow_sudo;

      account_num        num           = 0;
      account_num        auth_contract = 0;  // TODO: move out of native
      uint32_t           flags         = 0;
      eosio::checksum256 code_hash     = {};
      uint8_t            vm_type       = 0;
      uint8_t            vm_version    = 0;

      auto key() const { return account_key(num); }
   };
   EOSIO_REFLECT(account_row, num, auth_contract, flags, code_hash, vm_type, vm_version)

   inline auto code_key(const eosio::checksum256& code_hash, uint8_t vm_type, uint8_t vm_version)
   {
      // TODO: leave space for secondary index?
      return std::tuple{native_account, code_table, code_hash, vm_type, vm_version};
   }
   struct code_row
   {
      eosio::checksum256   code_hash  = {};
      uint8_t              vm_type    = 0;
      uint8_t              vm_version = 0;
      uint32_t             ref_count  = 0;
      std::vector<uint8_t> code       = {};

      auto key() const { return code_key(code_hash, vm_type, vm_version); }
   };
   EOSIO_REFLECT(code_row, code_hash, vm_type, vm_version, ref_count, code)
}  // namespace newchain
