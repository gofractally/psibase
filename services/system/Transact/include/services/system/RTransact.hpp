#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/block.hpp>
#include <psibase/trace.hpp>

#include <cstdint>
#include <functional>

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

   struct BlockTxRecord
   {
      psibase::Checksum256      id;
      psibase::BlockNum         blockNum;
      psibase::TransactionTrace trace;

      [[nodiscard]] bool successful() const { return !trace.error.has_value(); }

      using ByBlockNum = psibase::CompositeKey<&BlockTxRecord::blockNum, &BlockTxRecord::id>;
      auto byBlockNum() const { return ByBlockNum{}(*this); }
   };
   PSIO_REFLECT(BlockTxRecord, id, blockNum, trace)
   using BlockTxsTable =
       psibase::Table<BlockTxRecord, &BlockTxRecord::id, BlockTxRecord::ByBlockNum{}>;
   PSIO_REFLECT_TYPENAME(BlockTxsTable)

   struct WaitFor
   {
      std::string wait_for;

      static constexpr uint8_t final_flag   = 1;
      static constexpr uint8_t applied_flag = 2;

      [[nodiscard]] uint8_t flag() const
      {
         if (wait_for == "final")
            return final_flag;
         else if (wait_for == "applied")
            return applied_flag;
         else if (wait_for.empty())
            return final_flag;
         else
            psibase::abortMessage("Invalid wait_for parameter");
      }
   };
   PSIO_REFLECT(WaitFor, wait_for)

   class RTransact : psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber{"r-transact"};
      using Subjective              = psibase::SubjectiveTables<PendingTransactionTable,
                                                                TransactionDataTable,
                                                                AvailableSequenceTable,
                                                                TraceClientTable,
                                                                JWTKeyTable,
                                                                BlockTxsTable>;
      using WriteOnly = psibase::WriteOnlyTables<UnappliedTransactionTable, ReversibleBlocksTable>;
      std::optional<psibase::SignedTransaction> next();
      // Handles transactions coming over P2P
      void recv(const psibase::SignedTransaction& transaction);
      // Callbacks used to track successful/expired transactions
      void onTrx(const psibase::Checksum256& id, psio::view<const psibase::TransactionTrace> trace);
      void onBlock();
      auto serveSys(const psibase::HttpRequest& request,
                    std::optional<std::int32_t> socket) -> std::optional<psibase::HttpReply>;

      std::optional<psibase::AccountNumber> getUser(psibase::HttpRequest request);

     private:
      using ClientFilter = std::function<bool(const TraceClientInfo&)>;
      auto claimClientReply(const psibase::Checksum256& id, const ClientFilter& clientFilter)
          -> std::tuple<std::vector<std::int32_t>, std::vector<std::int32_t>>;

      auto finalizeBlocks(const psibase::BlockHeader& current)
          -> std::pair<std::vector<psibase::BlockNum>, psibase::BlockTime>;

      void stopTracking(const std::vector<psibase::Checksum256>& txids);
      void sendReplies(const std::vector<psibase::Checksum256>& txids);

      void sendReply(
          const psibase::Checksum256&                 id,
          psio::view<const psibase::TransactionTrace> trace,
          const ClientFilter& clientFilter = [](const TraceClientInfo&) { return true; });
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
