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

      using CTimeKey      = psibase::CompositeKey<&PendingTransactionRecord::ctime,
                                                  &PendingTransactionRecord::sequence>;
      using ExpirationKey = psibase::CompositeKey<&PendingTransactionRecord::expiration,
                                                  &PendingTransactionRecord::sequence>;
   };
   PSIO_REFLECT(PendingTransactionRecord, id, expiration, ctime, sequence);

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

   // Follows forks
   struct UnappliedTransactionRecord
   {
      std::uint64_t nextSequence;
   };
   PSIO_REFLECT(UnappliedTransactionRecord, nextSequence)

   using UnappliedTransactionTable =
       psibase::Table<UnappliedTransactionRecord, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(UnappliedTransactionTable)

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
      std::vector<TraceClientInfo> clients;
   };
   PSIO_REFLECT(TraceClientRow, id, clients)

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

   struct TxFailedRecord
   {
      psibase::Checksum256      id;
      psibase::TransactionTrace trace;
   };
   PSIO_REFLECT(TxFailedRecord, id, trace)
   using TxFailedTable = psibase::Table<TxFailedRecord, &TxFailedRecord::id>;
   PSIO_REFLECT_TYPENAME(TxFailedTable)

   class RTransact : psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber{"r-transact"};
      using Subjective              = psibase::SubjectiveTables<PendingTransactionTable,
                                                                TransactionDataTable,
                                                                AvailableSequenceTable,
                                                                TraceClientTable,
                                                                JWTKeyTable,
                                                                TxFailedTable>;
      using WriteOnly               = psibase::
          WriteOnlyTables<UnappliedTransactionTable, ReversibleBlocksTable, TxSuccessTable>;

      std::optional<psibase::SignedTransaction> next();
      // Handles transactions coming over P2P
      void recv(const psibase::SignedTransaction& transaction);
      // Callbacks used to track successful/expired transactions
      void onTrx(const psibase::Checksum256& id, psio::view<const psibase::TransactionTrace> trace);
      void onBlock();
      auto serveSys(const psibase::HttpRequest& request,
                    std::optional<std::int32_t> socket) -> std::optional<psibase::HttpReply>;

      std::optional<psibase::AccountNumber> getUser(psibase::HttpRequest request);
   };
   PSIO_REFLECT(RTransact,
                method(next),
                method(recv, transaction),
                method(onTrx, id, trace),
                method(onBlock),
                method(serveSys, request, socket),
                method(getUser, request))
   PSIBASE_REFLECT_TABLES(RTransact, RTransact::Subjective, RTransact::WriteOnly)
}  // namespace SystemService
