#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/crypto.hpp>
#include <psibase/time.hpp>
#include <psio/shared_view_ptr.hpp>

namespace psibase
{
   using BlockNum = uint32_t;

   using BlockTime = TimePointUSec;

   /// A synchronous call
   ///
   /// An Action represents a synchronous call between services.
   /// It is the argument to [call] and can be fetched using
   /// [getCurrentAction].
   ///
   /// Transactions also contains actions requested by the
   /// transaction authorizers.
   struct Action
   {
      AccountNumber     sender;   ///< Account sending the action
      AccountNumber     service;  ///< Service to execute the action
      MethodNumber      method;   ///< Service method to execute
      std::vector<char> rawData;  ///< Data for the method
      //
      friend bool operator==(const Action&, const Action&) = default;
      PSIO_REFLECT(Action, sender, service, method, rawData)
   };

   struct GenesisService
   {
      AccountNumber     service;
      uint64_t          flags     = 0;
      uint8_t           vmType    = 0;
      uint8_t           vmVersion = 0;
      std::vector<char> code      = {};
      PSIO_REFLECT(GenesisService, service, flags, vmType, vmVersion, code)
   };

   // The genesis action is the first action of the first transaction of
   // the first block. The action struct's fields are ignored, except
   // rawData, which contains this struct.
   struct GenesisActionData
   {
      std::string                 memo;
      std::vector<GenesisService> services;
      PSIO_REFLECT(GenesisActionData, memo, services)
   };

   struct Claim
   {
      AccountNumber     service;
      std::vector<char> rawData;
      friend bool       operator==(const Claim&, const Claim&) = default;
      PSIO_REFLECT(Claim, service, rawData)
   };

   struct ClaimKey
   {
      AccountNumber     service;
      std::vector<char> rawData;
      PSIO_REFLECT(ClaimKey, service, rawData)
   };

   // Rules for TAPOS:
   // * Reference block's number must be either:
   //    * One of the most-recent 128 blocks. For this case, refBlockIndex = blockNum & 0x7f
   //    * A multiple of 8192. For this case, refBlockIndex = (blockNum >> 13) | 0x80
   // * refBlockSuffix = last 4 bytes of the block ID, bit-casted to uint32_t.
   //
   // Transact maintains block suffixes for:
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
   //   is defined in Transact.cpp and may be changed in the future.
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
      PSIO_REFLECT(Tapos,
                   definitionWillNotChange(),
                   expiration,
                   refBlockSuffix,
                   flags,
                   refBlockIndex)
   };

   // TODO: separate native-defined fields from service-defined fields
   struct Transaction
   {
      Tapos               tapos;
      std::vector<Action> actions;
      std::vector<Claim>  claims;  // TODO: Is there standard terminology that we could use?
      PSIO_REFLECT(Transaction, tapos, actions, claims)
   };

   // TODO: pruning proofs?
   // TODO: compression? There's a time/space tradeoff and it complicates client libraries.
   //       e.g. complication: there are at least 2 different header formats for gzip.
   struct SignedTransaction
   {
      psio::shared_view_ptr<Transaction> transaction;

      // TODO: Is there standard terminology that we could use?
      std::vector<std::vector<char>> proofs;

      std::optional<std::vector<std::vector<char>>> subjectiveData;
      PSIO_REFLECT(SignedTransaction, transaction, proofs, subjectiveData)
   };

   using TermNum = uint32_t;

   struct BlockHeaderAuthAccount
   {
      AccountNumber codeNum;

      Checksum256 codeHash                                  = {};
      uint8_t     vmType                                    = 0;
      uint8_t     vmVersion                                 = 0;
      friend bool operator==(const BlockHeaderAuthAccount&,
                             const BlockHeaderAuthAccount&) = default;
      PSIO_REFLECT(BlockHeaderAuthAccount, codeNum, codeHash, vmType, vmVersion);
   };

   struct Producer
   {
      AccountNumber name;
      Claim         auth;

      static AccountNumber getName(const Producer& p) { return p.name; }
      static Claim         getAuthClaim(const Producer& p) { return p.auth; }

      friend bool operator==(const Producer&, const Producer&) = default;
      PSIO_REFLECT(Producer, name, auth);
   };

   struct CftConsensus
   {
      std::vector<Producer> producers;
      friend bool           operator==(const CftConsensus&, const CftConsensus&) = default;
      PSIO_REFLECT(CftConsensus, producers);
   };

   struct BftConsensus
   {
      std::vector<Producer> producers;
      friend bool           operator==(const BftConsensus&, const BftConsensus&) = default;
      PSIO_REFLECT(BftConsensus, producers);
   };

   using ConsensusData = std::variant<CftConsensus, BftConsensus>;

   inline auto get_gql_name(ConsensusData*)
   {
      return "ConsensusData";
   }

   struct Consensus
   {
      ConsensusData                       data;
      std::vector<BlockHeaderAuthAccount> services;
      friend bool                         operator==(const Consensus&, const Consensus&) = default;
      PSIO_REFLECT(Consensus, data, services)
   };

   struct BlockHeaderCode
   {
      uint8_t vmType    = 0;
      uint8_t vmVersion = 0;

      std::vector<uint8_t> code = {};
      PSIO_REFLECT(BlockHeaderCode, vmType, vmVersion, code);
   };

   struct PendingConsensus
   {
      Consensus consensus;
      BlockNum  blockNum;
      PSIO_REFLECT(PendingConsensus, consensus, blockNum)
   };

   // This commits to all the state used to verify block signatures.
   struct JointConsensus
   {
      Consensus                       current;
      std::optional<PendingConsensus> next;
      PSIO_REFLECT(JointConsensus, current, next)
   };

   // TODO: Receipts & Merkles. Receipts need sequence numbers, resource consumption, and events.
   // TODO: Consensus fields
   // TODO: Protocol Activation? Main reason to put here is to support light-client validation.
   // TODO: Are we going to attempt to support light-client validation? Didn't seem to work out easy last time.
   // TODO: Consider placing consensus alg in a service; might affect how header is laid out.
   struct BlockHeader
   {
      Checksum256   previous = {};
      BlockNum      blockNum = 0;  // TODO: pack into previous instead?
      BlockTime     time;
      AccountNumber producer;
      TermNum       term;
      BlockNum      commitNum;

      // Holds a sha256 of the current JointConsensus
      Checksum256 consensusState;

      // Holds a merkle root of the transactions in the block.
      // This does not depend on execution, so that it can be
      // verified early. The leaves of the tree have type
      // TransactionInfo.
      Checksum256 trxMerkleRoot;
      // The merkle root of events generated while processing the block.
      // The leaves have type EventInfo.
      Checksum256 eventMerkleRoot;

      // If newConsensus is set, activates joint consensus on
      // this block. Joint consensus must not be active already.
      // Joint consensus ends after this block becomes irreversible.
      std::optional<Consensus> newConsensus;
      // This contains the code for authServices
      // It MUST contain all code that was added in this block
      // It MUST NOT contain code that is not in authServices
      // It MAY contain code that is unchanged from the previous block
      // authCode MUST NOT be included when calculating a block hash.
      std::optional<std::vector<BlockHeaderCode>> authCode;
      PSIO_REFLECT(BlockHeader,
                   previous,
                   blockNum,
                   time,
                   producer,
                   term,
                   commitNum,
                   consensusState,
                   trxMerkleRoot,
                   eventMerkleRoot,
                   newConsensus,
                   authCode)
   };

   struct TransactionInfo
   {
      TransactionInfo(const SignedTransaction& trx)
          : transactionId(sha256(trx.transaction.data(), trx.transaction.size())),
            signatureHash(sha256(trx.proofs)),
            subjectiveDataHash((check(!!trx.subjectiveData, "Missing subjective data"),
                                sha256(*trx.subjectiveData)))
      {
      }
      Checksum256 transactionId;
      // TODO: Is there ever a reason to prune an individual signature?
      Checksum256 signatureHash;
      Checksum256 subjectiveDataHash;
      PSIO_REFLECT(TransactionInfo, transactionId, signatureHash, subjectiveDataHash)
   };

   struct EventInfo
   {
      std::uint64_t id;
      // TODO: Should we use a hash instead of including the data directly?
      std::span<const char> data;
      PSIO_REFLECT(EventInfo)
   };

   // TODO: switch fields to shared_view_ptr?
   struct Block
   {
      BlockHeader                    header;
      std::vector<SignedTransaction> transactions;
      PSIO_REFLECT(Block, header, transactions)
   };

   /// TODO: you have signed block headers, not signed blocks
   struct SignedBlock
   {
      Block             block;  // TODO: shared_view_ptr?
      std::vector<char> signature;
      // Contains additional signatures if required by the consensus algorithm
      std::optional<std::vector<char>> auxConsensusData;
      PSIO_REFLECT(SignedBlock, block, signature, auxConsensusData)
   };

   struct BlockInfo
   {
      BlockHeader header;
      Checksum256 blockId;

      BlockInfo()                 = default;
      BlockInfo(const BlockInfo&) = default;

      BlockInfo(const BlockHeader& h) : header(h), blockId{makeBlockId(header)}
      {
         auto* src  = (const char*)&header.blockNum + sizeof(header.blockNum);
         auto* dest = blockId.data();
         while (src != (const char*)&header.blockNum)
            *dest++ = *--src;
      }

      BlockInfo(const Block& b) : BlockInfo{b.header} {}
      static Checksum256 makeBlockId(BlockHeader header);
      PSIO_REFLECT(BlockInfo, header, blockId)
   };

   struct BlockSignatureInfo
   {
      BlockSignatureInfo(const BlockInfo& info)
      {
         data[0] = 0x00;
         data[1] = 0xce;
         data[2] = 0xa8;
         data[3] = 'B';
         std::memcpy(data + 4, info.blockId.data(), info.blockId.size());
      }
      operator std::span<const char>() const { return data; }
      static_assert(decltype(BlockInfo::blockId){}.size() != 0);
      char data[4 + decltype(BlockInfo::blockId){}.size()];
   };

}  // namespace psibase
