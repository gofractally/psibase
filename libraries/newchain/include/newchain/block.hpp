// TODO: A serialization format which allows
//       * Easier support in other languages
//       * Extension of these types in the future

#pragma once

#include <eosio/crypto.hpp>
#include <eosio/fixed_bytes.hpp>
#include <eosio/time.hpp>

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
      account_num sender   = 0;
      account_num contract = 0;
      action_num  act      = 0;
   };
   EOSIO_REFLECT(action, sender, contract, act)

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
   struct block
   {
      eosio::checksum256              previous;
      block_num                       num = 0;  // TODO: pack into previous instead?
      eosio::time_point_sec           time;
      std::vector<signed_transaction> transactions;  // TODO: move inside receipts
   };
   EOSIO_REFLECT(block, previous, num, time, transactions)

   struct signed_block : block
   {
      eosio::signature signature;
   };
   EOSIO_REFLECT(signed_block, base block, signature)

}  // namespace newchain
