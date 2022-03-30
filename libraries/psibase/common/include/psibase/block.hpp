#pragma once

#include <eosio/crypto.hpp>
#include <eosio/fixed_bytes.hpp>
#include <eosio/time.hpp>
#include <psibase/crypto.hpp>
#include <psio/fracpack.hpp>

// TODO
namespace eosio
{
   PSIO_REFLECT(time_point_sec, utc_seconds)
}

namespace psibase
{
   // TODO: Rename to contract_num?
   using account_num = uint64_t;
   using method_num  = uint64_t;

   using block_num = uint32_t;

   struct action
   {
      account_num       sender   = 0;
      account_num       contract = 0;
      method_num        method   = 0;
      std::vector<char> raw_data;
   };
   PSIO_REFLECT(action, sender, contract, method, raw_data)
   EOSIO_REFLECT(action, sender, contract, method, raw_data)

   struct genesis_contract
   {
      account_num       contract      = 0;
      account_num       auth_contract = 0;
      uint64_t          flags         = 0;
      uint8_t           vm_type       = 0;
      uint8_t           vm_version    = 0;
      std::vector<char> code          = {};
   };
   PSIO_REFLECT(genesis_contract, contract, auth_contract, flags, vm_type, vm_version, code)
   EOSIO_REFLECT(genesis_contract, contract, auth_contract, flags, vm_type, vm_version, code)

   // The genesis action is the first action of the first transaction of
   // the first block. The action struct's fields are ignored, except
   // raw_data, which contains this struct.
   struct genesis_action_data
   {
      std::string                   memo;
      std::vector<genesis_contract> contracts;
   };
   EOSIO_REFLECT(genesis_action_data, memo, contracts)
   PSIO_REFLECT(genesis_action_data, memo, contracts)

   struct claim
   {
      account_num       contract;
      std::vector<char> raw_data;
   };
   EOSIO_REFLECT(claim, contract, raw_data)
   PSIO_REFLECT(claim, contract, raw_data)

   // TODO: separate native-defined fields from contract-defined fields
   struct transaction
   {
      static constexpr uint32_t do_not_broadcast = 1u << 0;

      eosio::time_point_sec expiration;
      uint16_t              ref_block_num       = 0;
      uint32_t              ref_block_prefix    = 0;
      uint16_t              max_net_usage_words = 0;  // 8-byte words
      uint16_t              max_cpu_usage_ms    = 0;
      uint32_t              flags               = 0;
      std::vector<action>   actions;
      std::vector<claim>    claims;  // TODO: Is there standard terminology that we could use?
   };
   EOSIO_REFLECT(transaction,
                 expiration,
                 ref_block_num,
                 ref_block_prefix,
                 max_net_usage_words,
                 max_cpu_usage_ms,
                 flags,
                 actions,
                 claims)

   PSIO_REFLECT(transaction,
                expiration,
                ref_block_num,
                ref_block_prefix,
                max_net_usage_words,
                max_cpu_usage_ms,
                flags,
                actions,
                claims)

   // TODO: pruning proofs?
   // TODO: compression? There's a time/space tradeoff and it complicates client libraries.
   //       e.g. complication: there are at least 2 different header formats for gzip.
   struct signed_transaction
   {
      transaction trx;

      // TODO: Is there standard terminology that we could use?
      std::vector<std::vector<char>> proofs;
   };
   EOSIO_REFLECT(signed_transaction, trx, proofs)
   PSIO_REFLECT(signed_transaction, trx, proofs)

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   // TODO: Producer & Rotation
   // TODO: Consensus fields
   // TODO: Protocol Activation? Main reason to put here is to support light-client validation.
   // TODO: Are we going to attempt to support light-client validation? Didn't seem to work out easy last time.
   // TODO: Consider placing consensus alg in a contract; might affect how header is laid out.
   struct block_header
   {
      eosio::checksum256    previous;
      block_num             num = 0;  // TODO: pack into previous instead?
      eosio::time_point_sec time;
   };
   EOSIO_REFLECT(block_header, previous, num, time)
   PSIO_REFLECT(block_header, /*previous,*/ num, time)

   struct block
   {
      block_header                    header;
      std::vector<signed_transaction> transactions;  // TODO: move inside receipts
   };
   EOSIO_REFLECT(block, header, transactions)
   PSIO_REFLECT(block, header, transactions)

   /// TODO: you have signed block headers, not signed blocks
   struct signed_block
   {
      psibase::block   block;
      eosio::signature signature;
   };
   EOSIO_REFLECT(signed_block, block, signature)
   PSIO_REFLECT(signed_block, block /*, signature*/)

   struct block_info
   {
      block_header       header;
      eosio::checksum256 id;

      block_info()                  = default;
      block_info(const block_info&) = default;

      // TODO: switch to fracpack for sha
      // TODO: don't repack to compute sha
      block_info(const block& b) : header{b.header}, id{sha256(b)} {}
   };
   EOSIO_REFLECT(block_info, header, id)
   PSIO_REFLECT(block_info, header /*, id*/)

}  // namespace psibase
