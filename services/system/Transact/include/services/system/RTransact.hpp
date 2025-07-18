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
   PSIO_REFLECT(TransactionData, id, trx)

   using TransactionDataTable = psibase::Table<TransactionData, &TransactionData::id>;
   PSIO_REFLECT_TYPENAME(TransactionDataTable)

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
   PSIO_REFLECT(PendingTransactionRecord, id, expiration, ctime, sequence, verifies, speculative);

   using PendingTransactionTable = psibase::Table<PendingTransactionRecord,
                                                  &PendingTransactionRecord::id,
                                                  &PendingTransactionRecord::sequence,
                                                  PendingTransactionRecord::CTimeKey{},
                                                  PendingTransactionRecord::ExpirationKey{}>;
   PSIO_REFLECT_TYPENAME(PendingTransactionTable)

   struct AvailableSequenceRecord
   {
      std::uint64_t nextSequence;
   };
   PSIO_REFLECT(AvailableSequenceRecord, nextSequence);

   using AvailableSequenceTable = psibase::Table<AvailableSequenceRecord, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(AvailableSequenceTable)

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
      PSIO_REFLECT(UnverifiedTransactionRecord,
                   id,
                   expiration,
                   verifies,
                   verifyId,
                   verified,
                   speculative)
   };

   using UnverifiedTransactionTable =
       psibase::Table<UnverifiedTransactionRecord, &UnverifiedTransactionRecord::id>;
   PSIO_REFLECT_TYPENAME(UnverifiedTransactionTable)

   struct PendingVerifyRecord
   {
      psibase::Checksum256 txid;
      std::uint64_t        runid;
      PSIO_REFLECT(PendingVerifyRecord, txid, runid)
   };

   using PendingVerifyTable = psibase::Table<PendingVerifyRecord, &PendingVerifyRecord::runid>;
   PSIO_REFLECT_TYPENAME(PendingVerifyTable)

   struct ReverifySignaturesRecord
   {
      std::uint64_t        endSequence;
      psibase::Checksum256 verifyId;
      bool                 running;
      PSIO_REFLECT(ReverifySignaturesRecord, endSequence, verifyId, running)
   };
   using ReverifySignaturesTable =
       psibase::Table<ReverifySignaturesRecord, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(ReverifySignaturesTable)

   struct SpeculativeTransactionRecord
   {
      psibase::Checksum256 txid;
      std::uint64_t        runid;
      PSIO_REFLECT(SpeculativeTransactionRecord, txid, runid)
   };
   using SpeculativeTransactionTable =
       psibase::Table<SpeculativeTransactionRecord, &SpeculativeTransactionRecord::runid>;
   PSIO_REFLECT_TYPENAME(SpeculativeTransactionTable)

   // Follows forks
   struct UnappliedTransactionRecord
   {
      std::uint64_t nextSequence;
   };
   PSIO_REFLECT(UnappliedTransactionRecord, nextSequence)

   using UnappliedTransactionTable =
       psibase::Table<UnappliedTransactionRecord, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(UnappliedTransactionTable)

   struct VerifyIdRecord
   {
      std::uint64_t        verifyCodeSequence;
      psibase::Checksum256 verifyId;
      PSIO_REFLECT(VerifyIdRecord, verifyCodeSequence, verifyId)
   };
   using VerifyIdTable = psibase::Table<VerifyIdRecord, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(VerifyIdTable)

   struct ReversibleBlocksRow
   {
      psibase::BlockNum  blockNum;
      psibase::BlockTime time;
   };
   PSIO_REFLECT(ReversibleBlocksRow, blockNum, time)

   using ReversibleBlocksTable =
       psibase::Table<ReversibleBlocksRow, &ReversibleBlocksRow::blockNum>;
   PSIO_REFLECT_TYPENAME(ReversibleBlocksTable)

   struct TraceClientInfo
   {
      std::int32_t socket;
      bool         json = true;
      uint8_t      waitFor;

      PSIO_REFLECT(TraceClientInfo, socket, json, waitFor)
   };

   struct TraceClientRow
   {
      psibase::Checksum256         id;
      psibase::TimePointSec        expiration;
      std::vector<TraceClientInfo> clients;
   };
   PSIO_REFLECT(TraceClientRow, id, expiration, clients)

   using TraceClientTable = psibase::Table<TraceClientRow, &TraceClientRow::id>;
   PSIO_REFLECT_TYPENAME(TraceClientTable)

   struct JWTKeyRecord
   {
      std::vector<char> key;
   };
   PSIO_REFLECT(JWTKeyRecord, key)

   using JWTKeyTable = psibase::Table<JWTKeyRecord, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(JWTKeyTable)

   struct LoginReply
   {
      std::string access_token;
      std::string token_type = "bearer";
   };
   PSIO_REFLECT(LoginReply, access_token, token_type)

   struct TxSuccessRecord
   {
      psibase::Checksum256      id;
      psibase::BlockNum         blockNum;  // The block in which the tx was applied
      psibase::TransactionTrace trace;

      using ByBlockNum = psibase::CompositeKey<&TxSuccessRecord::blockNum, &TxSuccessRecord::id>;
      auto byBlockNum() const { return ByBlockNum{}(*this); }
   };
   PSIO_REFLECT(TxSuccessRecord, id, blockNum, trace)
   using TxSuccessTable =
       psibase::Table<TxSuccessRecord, &TxSuccessRecord::id, TxSuccessRecord::ByBlockNum{}>;
   PSIO_REFLECT_TYPENAME(TxSuccessTable)

   struct TxSuccessView
   {
      psibase::Checksum256                        id;
      psibase::BlockNum                           blockNum;
      psio::view<const psibase::TransactionTrace> trace;
   };
   PSIO_REFLECT(TxSuccessView, id, blockNum, trace)

   struct TxFailedRecord
   {
      psibase::Checksum256      id;
      psibase::TimePointSec     expiration;
      psibase::TransactionTrace trace;

      using ByExpiration = psibase::CompositeKey<&TxFailedRecord::expiration, &TxFailedRecord::id>;
   };
   PSIO_REFLECT(TxFailedRecord, id, expiration, trace)
   using TxFailedTable =
       psibase::Table<TxFailedRecord, &TxFailedRecord::id, TxFailedRecord::ByExpiration{}>;
   PSIO_REFLECT_TYPENAME(TxFailedTable)

   struct TxFailedView
   {
      psibase::Checksum256                        id;
      psibase::TimePointSec                       expiration;
      psio::view<const psibase::TransactionTrace> trace;
   };
   PSIO_REFLECT(TxFailedView, id, expiration, trace)

   // Transactions enter this service through the push_transaction endpoint
   // or over p2p (recv). Speculative execution and signature verification
   // are dispatched asynchronously. When they complete, the transaction
   // is pushed onto the queue to be included in blocks.
   class RTransact : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber{"r-transact"};
      using Subjective              = psibase::SubjectiveTables<PendingTransactionTable,
                                                                TransactionDataTable,
                                                                AvailableSequenceTable,
                                                                TraceClientTable,
                                                                JWTKeyTable,
                                                                TxFailedTable,
                                                                UnverifiedTransactionTable,
                                                                PendingVerifyTable,
                                                                ReverifySignaturesTable,
                                                                SpeculativeTransactionTable>;
      using WriteOnly               = psibase::WriteOnlyTables<UnappliedTransactionTable,
                                                               ReversibleBlocksTable,
                                                               TxSuccessTable,
                                                               VerifyIdTable>;

      std::optional<psibase::SignedTransaction>                    next();
      std::optional<std::vector<std::optional<psibase::RunToken>>> preverify(
          psio::view<const psibase::SignedTransaction> trx);
      // Handles transactions coming over P2P
      void recv(const psibase::SignedTransaction& transaction);
      // Callbacks used to track successful/expired transactions
      void onTrx(const psibase::Checksum256& id, psio::view<const psibase::TransactionTrace> trace);
      // Callback run when after signature verification
      void onVerify(std::uint64_t                               id,
                    psio::view<const psibase::TransactionTrace> trace,
                    std::optional<psibase::RunToken>            token);
      // Callback run after speculative transaction
      void onSpecTrx(std::uint64_t id, psio::view<const psibase::TransactionTrace> trace);
      void requeue();
      void onRequeue(std::uint64_t id, psio::view<const psibase::TransactionTrace> trace);
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
   PSIO_REFLECT(RTransact,
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
   PSIBASE_REFLECT_TABLES(RTransact, RTransact::Subjective, RTransact::WriteOnly)
}  // namespace SystemService
