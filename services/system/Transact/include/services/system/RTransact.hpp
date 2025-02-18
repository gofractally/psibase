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

   struct PendingTransactionRecord
   {
      psibase::Checksum256  id;
      psibase::TimePointSec expiration;
      psibase::TimePointSec ctime;
      std::uint64_t         sequence;

      auto ctimeKey() const { return std::tuple(ctime, sequence); }
      auto expirationKey() const { return std::tuple(expiration, sequence); }
   };
   PSIO_REFLECT(PendingTransactionRecord, id, expiration, ctime, sequence);

   using PendingTransactionTable = psibase::Table<PendingTransactionRecord,
                                                  &PendingTransactionRecord::id,
                                                  &PendingTransactionRecord::sequence,
                                                  &PendingTransactionRecord::ctimeKey,
                                                  &PendingTransactionRecord::expirationKey>;

   struct AvailableSequenceRecord
   {
      std::uint64_t nextSequence;
      auto          primary_key() const { return psibase::SingletonKey{}; }
   };
   PSIO_REFLECT(AvailableSequenceRecord, nextSequence);

   using AvailableSequenceTable =
       psibase::Table<AvailableSequenceRecord, &AvailableSequenceRecord::primary_key>;

   // Follows forks
   struct UnappliedTransactionRecord
   {
      std::uint64_t nextSequence;
      auto          primary_key() const { return psibase::SingletonKey{}; }
   };
   PSIO_REFLECT(UnappliedTransactionRecord, nextSequence)

   using UnappliedTransactionTable =
       psibase::Table<UnappliedTransactionRecord, &UnappliedTransactionRecord::primary_key>;

   struct ReversibleBlocksRow
   {
      psibase::BlockNum  blockNum;
      psibase::BlockTime time;
   };
   PSIO_REFLECT(ReversibleBlocksRow, blockNum, time)

   using ReversibleBlocksTable =
       psibase::Table<ReversibleBlocksRow, &ReversibleBlocksRow::blockNum>;

   struct TraceClientInfo
   {
      std::int32_t socket;
      bool         json = true;
      PSIO_REFLECT(TraceClientInfo, socket, json)
   };

   struct TraceClientRow
   {
      psibase::Checksum256         id;
      std::vector<TraceClientInfo> clients;
   };
   PSIO_REFLECT(TraceClientRow, id, clients)
   using TraceClientTable = psibase::Table<TraceClientRow, &TraceClientRow::id>;

   // Holds the size of the last transaction trace
   struct TraceSizeRow
   {
      psibase::Checksum256 id;
      uint64_t             size;
      auto                 primary_key() const { return psibase::SingletonKey{}; }
   };
   PSIO_REFLECT(TraceSizeRow, id, size)
   using TraceSizeTable = psibase::Table<TraceSizeRow, &TraceSizeRow::primary_key>;

   class RTransact : psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber{"r-transact"};
      using Subjective              = psibase::SubjectiveTables<PendingTransactionTable,
                                                                TransactionDataTable,
                                                                AvailableSequenceTable,
                                                                TraceClientTable,
                                                                TraceSizeTable>;
      using WriteOnly = psibase::WriteOnlyTables<UnappliedTransactionTable, ReversibleBlocksTable>;
      std::optional<psibase::SignedTransaction> next();
      // Handles transactions coming over P2P
      void recv(const psibase::SignedTransaction& transaction);
      // Callbacks used to track successful/expired transactions
      void onTrx(const psibase::Checksum256& id, psio::view<const psibase::TransactionTrace> trace);
      void onBlock();
      auto serveSys(const psibase::HttpRequest& request,
                    std::optional<std::int32_t> socket) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(RTransact,
                method(next),
                method(recv, transaction),
                method(onTrx, id, trace),
                method(onBlock),
                method(serveSys, request, socket))
}  // namespace SystemService
