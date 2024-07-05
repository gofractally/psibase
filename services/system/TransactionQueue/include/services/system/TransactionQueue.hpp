#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/block.hpp>

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
   };
   PSIO_REFLECT(PendingTransactionRecord, id, expiration, ctime, sequence);

   using PendingTransactionTable = psibase::Table<PendingTransactionRecord,
                                                  &PendingTransactionRecord::id,
                                                  &PendingTransactionRecord::sequence,
                                                  &PendingTransactionRecord::ctime>;

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

   class TransactionQueue : psibase::Service<TransactionQueue>
   {
     public:
      static constexpr auto service = psibase::AccountNumber{"txqueue"};
      using Subjective              = psibase::
          SubjectiveTables<PendingTransactionTable, TransactionDataTable, AvailableSequenceTable>;
      using WriteOnly = psibase::WriteOnlyTables<UnappliedTransactionTable>;
      std::optional<psibase::SignedTransaction> next();
      void                                      recv(int socket, const std::vector<char>& data);
      std::optional<psibase::HttpReply>         serveSys(const psibase::HttpRequest&);
   };
   PSIO_REFLECT(TransactionQueue,
                method(next),
                method(recv, socket, data),
                method(serveSys, request))
}  // namespace SystemService
