#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/block.hpp>
#include <psibase/trace.hpp>

#include <cstdint>

namespace SystemService
{
   // Does not follow forks. Transactions are added asynchronously and removed
   // at irreversible.
   //
   // This row exists iff there is a PendingTransactionRecord or an
   // UnverifiedTransactionRecord with hasError == false for the id.
   struct TransactionData
   {
      psibase::Checksum256       id;
      psibase::SignedTransaction trx;
   };
   PSIO1_REFLECT(TransactionData, id, trx)

   using TransactionDataTable = psibase::Table<TransactionData, &TransactionData::id>;
   PSIO1_REFLECT_TYPENAME(TransactionDataTable)

   struct PendingTransactionRecord
   {
      psibase::Checksum256  id;
      psibase::TimePointSec expiration;
      psibase::TimePointSec ctime;
      std::uint64_t         sequence;
      // One for each claim/proof
      std::vector<psibase::RunToken> verifies;
      // If missing, speculative execution succeeded
      std::optional<std::uint64_t> speculative;

      using CTimeKey      = psibase::CompositeKey<&PendingTransactionRecord::ctime,
                                                  &PendingTransactionRecord::sequence>;
      using ExpirationKey = psibase::CompositeKey<&PendingTransactionRecord::expiration,
                                                  &PendingTransactionRecord::sequence>;
   };
   PSIO1_REFLECT(PendingTransactionRecord, id, expiration, ctime, sequence, verifies, speculative);

   using PendingTransactionTable = psibase::Table<PendingTransactionRecord,
                                                  &PendingTransactionRecord::id,
                                                  &PendingTransactionRecord::sequence,
                                                  PendingTransactionRecord::CTimeKey{},
                                                  PendingTransactionRecord::ExpirationKey{}>;
   PSIO1_REFLECT_TYPENAME(PendingTransactionTable)

   struct AvailableSequenceRecord
   {
      std::uint64_t nextSequence;
   };
   PSIO1_REFLECT(AvailableSequenceRecord, nextSequence);

   using AvailableSequenceTable = psibase::Table<AvailableSequenceRecord, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(AvailableSequenceTable)

   struct UnverifiedTransactionRecord
   {
      using VerifyStatus = std::variant<std::uint64_t, psibase::RunToken>;
      psibase::Checksum256      id;
      psibase::TimePointSec     expiration;
      std::vector<VerifyStatus> verifies;
      psibase::Checksum256      verifyId;
      // Indicates that the signatures were successfully verified with
      // any verify state. This is used to track when to broadcast the
      // transaction.
      bool verified;
      // If missing, speculative execution succeeded
      std::optional<std::uint64_t> speculative;
      PSIO1_REFLECT(UnverifiedTransactionRecord,
                   id,
                   expiration,
                   verifies,
                   verifyId,
                   verified,
                   speculative)
   };

   using UnverifiedTransactionTable =
       psibase::Table<UnverifiedTransactionRecord, &UnverifiedTransactionRecord::id>;
   PSIO1_REFLECT_TYPENAME(UnverifiedTransactionTable)

   struct PendingVerifyRecord
   {
      psibase::Checksum256 txid;
      std::uint64_t        runid;
      PSIO1_REFLECT(PendingVerifyRecord, txid, runid)
   };

   using PendingVerifyTable = psibase::Table<PendingVerifyRecord, &PendingVerifyRecord::runid>;
   PSIO1_REFLECT_TYPENAME(PendingVerifyTable)

   struct ReverifySignaturesRecord
   {
      std::uint64_t        endSequence;
      psibase::Checksum256 verifyId;
      bool                 running;
      PSIO1_REFLECT(ReverifySignaturesRecord, endSequence, verifyId, running)
   };
   using ReverifySignaturesTable =
       psibase::Table<ReverifySignaturesRecord, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(ReverifySignaturesTable)

   struct SpeculativeTransactionRecord
   {
      psibase::Checksum256 txid;
      std::uint64_t        runid;
      PSIO1_REFLECT(SpeculativeTransactionRecord, txid, runid)
   };
   using SpeculativeTransactionTable =
       psibase::Table<SpeculativeTransactionRecord, &SpeculativeTransactionRecord::runid>;
   PSIO1_REFLECT_TYPENAME(SpeculativeTransactionTable)

   // Follows forks
   struct UnappliedTransactionRecord
   {
      std::uint64_t nextSequence;
   };
   PSIO1_REFLECT(UnappliedTransactionRecord, nextSequence)

   using UnappliedTransactionTable =
       psibase::Table<UnappliedTransactionRecord, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(UnappliedTransactionTable)

   struct VerifyIdRecord
   {
      std::uint64_t        verifyCodeSequence;
      psibase::Checksum256 verifyId;
      PSIO1_REFLECT(VerifyIdRecord, verifyCodeSequence, verifyId)
   };
   using VerifyIdTable = psibase::Table<VerifyIdRecord, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(VerifyIdTable)

   struct ReversibleBlocksRow
   {
      psibase::BlockNum  blockNum;
      psibase::BlockTime time;
   };
   PSIO1_REFLECT(ReversibleBlocksRow, blockNum, time)

   using ReversibleBlocksTable =
       psibase::Table<ReversibleBlocksRow, &ReversibleBlocksRow::blockNum>;
   PSIO1_REFLECT_TYPENAME(ReversibleBlocksTable)

   struct TraceClientInfo
   {
      std::int32_t socket;
      bool         json = true;
      uint8_t      waitFor;

      PSIO1_REFLECT(TraceClientInfo, socket, json, waitFor)
   };

   struct TraceClientRow
   {
      psibase::Checksum256         id;
      psibase::TimePointSec        expiration;
      std::vector<TraceClientInfo> clients;
   };
   PSIO1_REFLECT(TraceClientRow, id, expiration, clients)

   using TraceClientTable = psibase::Table<TraceClientRow, &TraceClientRow::id>;
   PSIO1_REFLECT_TYPENAME(TraceClientTable)

   struct JWTKeyRecord
   {
      std::vector<char> key;
   };
   PSIO1_REFLECT(JWTKeyRecord, key)

   using JWTKeyTable = psibase::Table<JWTKeyRecord, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(JWTKeyTable)

   struct LoginReply
   {
      std::string access_token;
      std::string token_type = "bearer";
   };
   PSIO1_REFLECT(LoginReply, access_token, token_type)

   struct TxSuccessRecord
   {
      psibase::Checksum256      id;
      psibase::BlockNum         blockNum;  // The block in which the tx was applied
      psibase::TransactionTrace trace;

      using ByBlockNum = psibase::CompositeKey<&TxSuccessRecord::blockNum, &TxSuccessRecord::id>;
      auto byBlockNum() const { return ByBlockNum{}(*this); }
   };
   PSIO1_REFLECT(TxSuccessRecord, id, blockNum, trace)
   using TxSuccessTable =
       psibase::Table<TxSuccessRecord, &TxSuccessRecord::id, TxSuccessRecord::ByBlockNum{}>;
   PSIO1_REFLECT_TYPENAME(TxSuccessTable)

   struct TxSuccessView
   {
      psibase::Checksum256                        id;
      psibase::BlockNum                           blockNum;
      psio1::view<const psibase::TransactionTrace> trace;
   };
   PSIO1_REFLECT(TxSuccessView, id, blockNum, trace)

   struct TxFailedRecord
   {
      psibase::Checksum256      id;
      psibase::TimePointSec     expiration;
      psibase::TransactionTrace trace;

      using ByExpiration = psibase::CompositeKey<&TxFailedRecord::expiration, &TxFailedRecord::id>;
   };
   PSIO1_REFLECT(TxFailedRecord, id, expiration, trace)
   using TxFailedTable =
       psibase::Table<TxFailedRecord, &TxFailedRecord::id, TxFailedRecord::ByExpiration{}>;
   PSIO1_REFLECT_TYPENAME(TxFailedTable)

   struct TxFailedView
   {
      psibase::Checksum256                        id;
      psibase::TimePointSec                       expiration;
      psio1::view<const psibase::TransactionTrace> trace;
   };
   PSIO1_REFLECT(TxFailedView, id, expiration, trace)

   struct TxStatsRecord
   {
      uint64_t unprocessed;
      uint64_t total;
      uint64_t failed;
      uint64_t succeeded;
      uint64_t expired;
   };
   PSIO1_REFLECT(TxStatsRecord, unprocessed, total, failed, succeeded, expired)

   using TxStatsTable = psibase::Table<TxStatsRecord, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(TxStatsTable)

   // This is used to limit the size of blocks before the chain
   struct BlockSizeRecord
   {
      uint32_t currentBlockSize;
   };
   PSIO1_REFLECT(BlockSizeRecord, currentBlockSize)
   using BlockSizeTable = psibase::Table<BlockSizeRecord, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(BlockSizeTable)

   // Transactions enter this service through the push_transaction endpoint
   // or over p2p (recv). Speculative execution and signature verification
   // are dispatched asynchronously. When they complete, the transaction
   // is pushed onto the queue to be included in blocks.
   class RTransact : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber{"transact+1"};
      using Subjective              = psibase::SubjectiveTables<PendingTransactionTable,
                                                                TransactionDataTable,
                                                                AvailableSequenceTable,
                                                                JWTKeyTable,
                                                                TxFailedTable,
                                                                UnverifiedTransactionTable,
                                                                PendingVerifyTable,
                                                                ReverifySignaturesTable,
                                                                SpeculativeTransactionTable,
                                                                TxStatsTable>;
      using Session                 = psibase::SessionTables<TraceClientTable>;
      using WriteOnly               = psibase::WriteOnlyTables<UnappliedTransactionTable,
                                                               ReversibleBlocksTable,
                                                               TxSuccessTable,
                                                               VerifyIdTable,
                                                               BlockSizeTable>;

      std::optional<psibase::SignedTransaction>                    next();
      std::optional<std::vector<std::optional<psibase::RunToken>>> preverify(
          psio1::view<const psibase::SignedTransaction> trx);
      // Handles transactions coming over P2P
      void recv(const psibase::SignedTransaction& transaction);
      // Callbacks used to track successful/expired transactions
      void onTrx(const psibase::Checksum256& id, psio1::view<const psibase::TransactionTrace> trace);
      // Callback run when after signature verification
      void onVerify(std::uint64_t                               id,
                    psio1::view<const psibase::TransactionTrace> trace,
                    std::optional<psibase::RunToken>            token);
      // Callback run after speculative transaction
      void onSpecTrx(std::uint64_t id, psio1::view<const psibase::TransactionTrace> trace);
      void requeue();
      void onRequeue(std::uint64_t id, psio1::view<const psibase::TransactionTrace> trace);
      void onBlock();
      auto serveSys(const psibase::HttpRequest&           request,
                    std::optional<std::int32_t>           socket,
                    std::optional<psibase::AccountNumber> user)
          -> std::optional<psibase::HttpReply>;
      // Returns a login token for the sender. A service can use
      // this to allow a custom authentication scheme.
      std::string login(std::string rootHost);

      std::optional<psibase::AccountNumber> getUser(psibase::HttpRequest request);
   };
   PSIO1_REFLECT(RTransact,
                method(next),
                method(preverify, transaction),
                method(recv, transaction),
                method(onTrx, id, trace),
                method(onBlock),
                method(onVerify, id, trace, token),
                method(onSpecTrx, id, trace),
                method(requeue),
                method(onRequeue, id, trace),
                method(serveSys, request, socket, user),
                method(login, rootHost),
                method(getUser, request))
   PSIBASE_REFLECT_TABLES(RTransact,
                          RTransact::Subjective,
                          RTransact::Session,
                          RTransact::WriteOnly)
}  // namespace SystemService
