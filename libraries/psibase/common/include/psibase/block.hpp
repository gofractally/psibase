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
   /// An Action represents a synchronous call between contracts.
   /// It is the argument to [call] and can be fetched using
   /// [getCurrentAction].
   ///
   /// [Transaction] also contains actions requested by the
   /// transaction authorizers.
   struct Action
   {
      AccountNumber     sender;    ///< Account sending the action
      AccountNumber     contract;  ///< Contract to execute the action
      MethodNumber      method;    ///< Contract method to execute
      std::vector<char> rawData;   ///< Data for the method
   };
   PSIO_REFLECT(Action, sender, contract, method, rawData)

   struct GenesisContract
   {
      AccountNumber     contract;
      AccountNumber     authContract;
      uint64_t          flags     = 0;
      uint8_t           vmType    = 0;
      uint8_t           vmVersion = 0;
      std::vector<char> code      = {};
   };
   PSIO_REFLECT(GenesisContract, contract, authContract, flags, vmType, vmVersion, code)

   // The genesis action is the first action of the first transaction of
   // the first block. The action struct's fields are ignored, except
   // rawData, which contains this struct.
   struct GenesisActionData
   {
      std::string                  memo;
      std::vector<GenesisContract> contracts;
   };
   PSIO_REFLECT(GenesisActionData, memo, contracts)

   struct Claim
   {
      AccountNumber     contract;
      std::vector<char> rawData;
   };
   PSIO_REFLECT(Claim, contract, rawData)

   struct Tapos
   {
      static constexpr uint16_t do_not_broadcast = 1u << 0;

      TimePointSec expiration;
      uint16_t     flags          = 0;
      uint32_t     refBlockPrefix = 0;
      uint16_t     refBlockNum    = 0;
   };
   PSIO_REFLECT(Tapos, definitionWillNotChange(), expiration, flags, refBlockPrefix, refBlockNum)

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
      psio::shared_view_ptr<Transaction> transaction;

      // TODO: Is there standard terminology that we could use?
      std::vector<std::vector<char>> proofs;
   };
   PSIO_REFLECT(SignedTransaction, transaction, proofs)

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   // TODO: Producer & Rotation
   // TODO: Consensus fields
   // TODO: Protocol Activation? Main reason to put here is to support light-client validation.
   // TODO: Are we going to attempt to support light-client validation? Didn't seem to work out easy last time.
   // TODO: Consider placing consensus alg in a contract; might affect how header is laid out.
   struct BlockHeader
   {
      Checksum256  previous = {};
      BlockNum     blockNum = 0;  // TODO: pack into previous instead?
      TimePointSec time;          // TODO: switch to microseconds
   };
   PSIO_REFLECT(BlockHeader, previous, blockNum, time)

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
      Block block;      // TODO: shared_view_ptr?
      Claim signature;  // TODO: switch to proofs?
   };
   PSIO_REFLECT(SignedBlock, block, signature)

   struct BlockInfo
   {
      BlockHeader header;  // TODO: shared_view_ptr?
      Checksum256 blockId;

      BlockInfo()                 = default;
      BlockInfo(const BlockInfo&) = default;

      // TODO: switch to fracpack for sha
      // TODO: don't repack to compute sha
      BlockInfo(const Block& b) : header{b.header}, blockId{sha256(b)} {}
   };
   PSIO_REFLECT(BlockInfo, header, blockId)
}  // namespace psibase
