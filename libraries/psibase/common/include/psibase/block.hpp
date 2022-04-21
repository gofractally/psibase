#pragma once

#include <eosio/crypto.hpp>
#include <eosio/time.hpp>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/crypto.hpp>
#include <psibase/time.hpp>

namespace psibase
{
   using BlockNum  = uint32_t;
   using block_num = BlockNum;

   struct Action
   {
      AccountNumber     sender;
      AccountNumber     contract;
      MethodNumber      method;
      std::vector<char> raw_data;
   };
   using action = Action;
   PSIO_REFLECT(Action, sender, contract, method, raw_data)
   EOSIO_REFLECT(action, sender, contract, method, raw_data)

   struct genesis_contract
   {
      AccountNumber     contract;
      AccountNumber     auth_contract;
      uint64_t          flags      = 0;
      uint8_t           vm_type    = 0;
      uint8_t           vm_version = 0;
      std::vector<char> code       = {};
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

   struct Claim
   {
      AccountNumber     contract;
      std::vector<char> raw_data;
   };
   EOSIO_REFLECT(Claim, contract, raw_data)
   PSIO_REFLECT(Claim, contract, raw_data)

   // TODO: separate native-defined fields from contract-defined fields
   struct transaction
   {
      static constexpr uint32_t do_not_broadcast = 1u << 0;

      TimePointSec        expiration;
      uint16_t            ref_block_num       = 0;
      uint32_t            ref_block_prefix    = 0;
      uint16_t            max_net_usage_words = 0;  // 8-byte words
      uint16_t            max_cpu_usage_ms    = 0;
      uint32_t            flags               = 0;
      std::vector<Action> actions;
      std::vector<Claim>  claims;  // TODO: Is there standard terminology that we could use?
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
   struct BlockHeader
   {
      Checksum256  previous = {};
      block_num    num      = 0;  // TODO: pack into previous instead?
      TimePointSec time;          // TODO: switch to microseconds
   };
   EOSIO_REFLECT(BlockHeader, previous, num, time)
   PSIO_REFLECT(BlockHeader, previous, num, time)

   struct Block
   {
      BlockHeader                     header;
      std::vector<signed_transaction> transactions;  // TODO: move inside receipts
   };
   EOSIO_REFLECT(Block, header, transactions)
   PSIO_REFLECT(Block, header, transactions)

   /// TODO: you have signed block headers, not signed blocks
   struct signed_block
   {
      Block block;
      Claim signature;  // TODO: switch to proofs?
   };
   EOSIO_REFLECT(signed_block, block, signature)
   PSIO_REFLECT(signed_block, block, signature)

   struct BlockInfo
   {
      BlockHeader header;
      Checksum256 id;

      BlockInfo()                 = default;
      BlockInfo(const BlockInfo&) = default;

      // TODO: switch to fracpack for sha
      // TODO: don't repack to compute sha
      BlockInfo(const Block& b) : header{b.header}, id{sha256(b)} {}
   };
   EOSIO_REFLECT(BlockInfo, header, id)
   PSIO_REFLECT(BlockInfo, header, id)

   // TODO: remove dependency on these
   using block      = Block;
   using block_info = BlockInfo;
   using claim      = Claim;

}  // namespace psibase
