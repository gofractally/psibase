#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/crypto.hpp>
#include <psibase/time.hpp>

namespace psibase
{
   using BlockNum = uint32_t;

   /// A synchronous call
   ///
   /// An Action represents a synchronous call between services.
   /// It is the argument to [call] and can be fetched using
   /// [getCurrentAction].
   ///
   /// [Transaction] also contains actions requested by the
   /// transaction authorizers.
   struct Action
   {
      AccountNumber     sender;   ///< Account sending the action
      AccountNumber     service;  ///< Service to execute the action
      MethodNumber      method;   ///< Service method to execute
      std::vector<char> rawData;  ///< Data for the method
   };
   PSIO_REFLECT(Action, sender, service, method, rawData)

   struct GenesisService
   {
      AccountNumber     service;
      uint64_t          flags     = 0;
      uint8_t           vmType    = 0;
      uint8_t           vmVersion = 0;
      std::vector<char> code      = {};
   };
   PSIO_REFLECT(GenesisService, service, flags, vmType, vmVersion, code)

   // The genesis action is the first action of the first transaction of
   // the first block. The action struct's fields are ignored, except
   // rawData, which contains this struct.
   struct GenesisActionData
   {
      std::string                 memo;
      std::vector<GenesisService> services;
   };
   PSIO_REFLECT(GenesisActionData, memo, services)

   struct Claim
   {
      AccountNumber     service;
      std::vector<char> rawData;
      friend bool       operator==(const Claim&, const Claim&) = default;
   };
   PSIO_REFLECT(Claim, service, rawData)

   // Rules for TAPOS:
   // * Reference block's number must be either:
   //    * One of the most-recent 128 blocks. For this case, refBlockIndex = blockNum & 0x7f
   //    * A multiple of 8192. For this case, refBlockIndex = (blockNum >> 13) | 0x80
   // * refBlockSuffix = last 4 bytes of the block ID, bit-casted to uint32_t.
   //
   // TransactionSys maintains block suffixes for:
   // * The most-recent 128 blocks. This allows transactions to depend on other recent transactions.
   // * The most-recent 128 blocks which have block numbers which are a multiple of 8192. This gives
   //   users which sign transactions offline plenty of time to do so.
   //
   // If the blocks are all 1 second apart, then the second case allows up to 12 days to sign and execute
   // a transaction. If the blocks have variable length, then the amount of available time will vary with
   // network activity. If we assume a max sustained block rate of 4 per sec, then this still allows 3 days.
   //
   // A transaction will be rejected if:
   // * It is expired.
   // * It arrives earlier than (expired - maxTrxLifetime). maxTrxLifetime
   //   is defined in TransactionSys.cpp and may be changed in the future.
   // * It references a block that isn't on the current fork, or a block which
   //   is too old. For best results, use the most-recent irreversible block which
   //   meets the criteria.
   struct Tapos
   {
      static constexpr uint16_t do_not_broadcast_flag = 1u << 0;
      static constexpr uint16_t valid_flags           = 0x0001;

      TimePointSec expiration;
      uint32_t     refBlockSuffix = 0;
      uint16_t     flags          = 0;
      uint8_t      refBlockIndex  = 0;
   };
   PSIO_REFLECT(Tapos, definitionWillNotChange(), expiration, refBlockSuffix, flags, refBlockIndex)

   // TODO: separate native-defined fields from service-defined fields
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
      psio::shared_view_ptr<Transaction> transaction;

      // TODO: Is there standard terminology that we could use?
      std::vector<std::vector<char>> proofs;
   };
   PSIO_REFLECT(SignedTransaction, transaction, proofs)

   using TermNum = uint32_t;

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   // TODO: Producer & Rotation
   // TODO: Consensus fields
   // TODO: Protocol Activation? Main reason to put here is to support light-client validation.
   // TODO: Are we going to attempt to support light-client validation? Didn't seem to work out easy last time.
   // TODO: Consider placing consensus alg in a service; might affect how header is laid out.
   struct BlockHeader
   {
      Checksum256   previous = {};
      BlockNum      blockNum = 0;  // TODO: pack into previous instead?
      TimePointSec  time;          // TODO: switch to microseconds
      AccountNumber producer;
      TermNum       term;
   };
   PSIO_REFLECT(BlockHeader, previous, blockNum, time, producer, term)

   // TODO: switch fields to shared_view_ptr?
   struct Block
   {
      BlockHeader                    header;
      std::vector<SignedTransaction> transactions;  // TODO: move inside receipts
      std::vector<std::vector<char>> subjectiveData;
   };
   PSIO_REFLECT(Block, header, transactions, subjectiveData)

   /// TODO: you have signed block headers, not signed blocks
   struct SignedBlock
   {
      Block             block;  // TODO: shared_view_ptr?
      std::vector<char> signature;
   };
   PSIO_REFLECT(SignedBlock, block, signature)

   struct BlockInfo
   {
      BlockHeader header;  // TODO: shared_view_ptr?
      Checksum256 blockId;

      BlockInfo()                 = default;
      BlockInfo(const BlockInfo&) = default;

      // TODO: don't repack to compute sha
      BlockInfo(const Block& b) : header{b.header}, blockId{sha256(b)}
      {
         auto* src  = (const char*)&header.blockNum + sizeof(header.blockNum);
         auto* dest = blockId.data();
         while (src != (const char*)&header.blockNum)
            *dest++ = *--src;
      }
   };
   PSIO_REFLECT(BlockInfo, header, blockId)
}  // namespace psibase
