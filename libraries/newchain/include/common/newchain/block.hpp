// TODO: A serialization format which allows
//       * Easier support in other languages
//       * Extension of these types in the future

#pragma once

#include <eosio/crypto.hpp>
#include <eosio/fixed_bytes.hpp>
#include <eosio/time.hpp>
#include <newchain/crypto.hpp>

namespace newchain
{
   using account_num = uint32_t;

   // TODO: this may make it hard to define standard actions/notifications/etc.
   //       for contracts to communicate with each other. Maybe a registration
   //       contract? Registered scopes?
   using action_num = uint16_t;

   using block_num = uint32_t;

   struct action
   {
      account_num       sender   = 0;
      account_num       contract = 0;
      action_num        act      = 0;
      std::vector<char> raw_data;
   };
   EOSIO_REFLECT(action, sender, contract, act, raw_data)

   constexpr action_num auth_action_num = 1;  // raw_data contains action to authorize and run

   // The genesis action is the first action of the first transaction of
   // the first block. The action struct's fields (above) are ignored,
   // except raw_data, which contains this struct. This struct mirrors what
   // a setcode action's payload could look like. The action's sender,
   // contract, and act fields could be set to allow ABI decoding to view this
   // as a normal setcode action.
   struct genesis_action_data
   {
      account_num       contract   = 1;  // must be 1
      uint8_t           vm_type    = 0;
      uint8_t           vm_version = 0;
      std::string       memo;
      std::vector<char> code;
   };
   EOSIO_REFLECT(genesis_action_data, contract, vm_type, vm_version, memo, code)

   // Resources billed to trx.actions[0].sender
   // TODO: context-free actions?
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
   };
   EOSIO_REFLECT(transaction,
                 expiration,
                 ref_block_num,
                 ref_block_prefix,
                 max_net_usage_words,
                 max_cpu_usage_ms,
                 flags,
                 actions)

   // TODO: context-free data?
   // TODO: pruning signatures and context-free data?
   // TODO: compression? There's a time/space tradeoff and it complicates client libraries.
   //       e.g. complication: there are at least 2 different header formats for gzip.
   struct signed_transaction : transaction
   {
      std::vector<eosio::signature> signatures;
   };
   EOSIO_REFLECT(signed_transaction, base transaction, signatures)

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

   struct block : block_header
   {
      std::vector<signed_transaction> transactions;  // TODO: move inside receipts
   };
   EOSIO_REFLECT(block, base block_header, transactions)

   struct signed_block : block
   {
      eosio::signature signature;
   };
   EOSIO_REFLECT(signed_block, base block, signature)

   struct block_info : block_header
   {
      eosio::checksum256 id;

      block_info()                  = default;
      block_info(const block_info&) = default;
      block_info(const block& b) : block_header{b}, id{sha256(b)} {}
   };
   EOSIO_REFLECT(block_info, base block_header, id)

}  // namespace newchain
