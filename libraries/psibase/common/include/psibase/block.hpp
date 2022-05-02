#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/crypto.hpp>
#include <psibase/time.hpp>

namespace psibase
{
   using BlockNum = uint32_t;

   struct Action
   {
      AccountNumber     sender;
      AccountNumber     contract;
      MethodNumber      method;
      std::vector<char> raw_data;
   };
   PSIO_REFLECT(Action, sender, contract, method, raw_data)

   struct GenesisContract
   {
      AccountNumber     contract;
      AccountNumber     auth_contract;
      uint64_t          flags      = 0;
      uint8_t           vm_type    = 0;
      uint8_t           vm_version = 0;
      std::vector<char> code       = {};
   };
   PSIO_REFLECT(GenesisContract, contract, auth_contract, flags, vm_type, vm_version, code)

   // The genesis action is the first action of the first transaction of
   // the first block. The action struct's fields are ignored, except
   // raw_data, which contains this struct.
   struct GenesisActionData
   {
      std::string                  memo;
      std::vector<GenesisContract> contracts;
   };
   PSIO_REFLECT(GenesisActionData, memo, contracts)

   struct Claim
   {
      AccountNumber     contract;
      std::vector<char> raw_data;
   };
   PSIO_REFLECT(Claim, contract, raw_data)

   /* mark this as final and put it in memory order that
    * has no padding nor alignment requirements so these fields
    * can be effeciently memcpy 
    *
    * - do not add any fields that may allocate memory 
    *
    *   Tapos = Transactions as Proof of Stake
    */
   // TODO Dan: __attribute__((packed, aligned(1))) causes UB in to_json, from_json,
   //           the TimePointSec comparison operator, fracpack if the memcpy
   //           optimization ever gets disabled (e.g. its condition for enabling fails
   //           to trigger), to_bin, from_bin, and more; see Todd for details
   struct FRACPACK Tapos final
   {
      static constexpr uint16_t do_not_broadcast = 1u << 0;

      TimePointSec expiration;
      uint16_t     flags            = 0;
      uint32_t     ref_block_prefix = 0;
      uint16_t     ref_block_num    = 0;
   };
   PSIO_REFLECT(Tapos, expiration, flags, ref_block_prefix, ref_block_num)

   // TODO: separate native-defined fields from contract-defined fields
   struct Transaction
   {
      Tapos               tapos;
      std::vector<Action> actions;
      std::vector<Claim>  claims;  // TODO: Is there standard terminology that we could use?
   };
   PSIO_REFLECT(Transaction, tapos, actions, claims)

   // TODO: pruning proofs?
   // TODO: compression? There's a time/space tradeoff and it complicates client libraries.
   //       e.g. complication: there are at least 2 different header formats for gzip.
   struct SignedTransaction
   {
      Transaction trx;

      // TODO: Is there standard terminology that we could use?
      std::vector<std::vector<char>> proofs;
   };
   PSIO_REFLECT(SignedTransaction, trx, proofs)

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   // TODO: Producer & Rotation
   // TODO: Consensus fields
   // TODO: Protocol Activation? Main reason to put here is to support light-client validation.
   // TODO: Are we going to attempt to support light-client validation? Didn't seem to work out easy last time.
   // TODO: Consider placing consensus alg in a contract; might affect how header is laid out.
   struct BlockHeader
   {
      Checksum256  previous = {};
      BlockNum     num      = 0;  // TODO: pack into previous instead?
      TimePointSec time;          // TODO: switch to microseconds
   };
   PSIO_REFLECT(BlockHeader, previous, num, time)

   struct Block
   {
      BlockHeader                    header;
      std::vector<SignedTransaction> transactions;  // TODO: move inside receipts
   };
   PSIO_REFLECT(Block, header, transactions)

   /// TODO: you have signed block headers, not signed blocks
   struct SignedBlock
   {
      Block block;
      Claim signature;  // TODO: switch to proofs?
   };
   PSIO_REFLECT(SignedBlock, block, signature)

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
   PSIO_REFLECT(BlockInfo, header, id)
}  // namespace psibase
