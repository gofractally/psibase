#include "services/user/Explorer.hpp"

#include <psibase/crypto.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psio/to_hex.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/HttpServer.hpp>

using namespace psibase;

namespace
{
   // A transaction as stored in a block, decorated with its id (sha256 of the
   // packed Transaction bytes) so that clients don't have to re-pack it.
   struct TransactionRecord
   {
      Checksum256                    id;
      Transaction                    transaction;
      std::vector<std::vector<char>> proofs;
      PSIO_REFLECT(TransactionRecord, id, transaction, proofs)
   };

   // A block from the block log, decorated with its block id.
   struct BlockRecord
   {
      Checksum256                    id;
      BlockHeader                    header;
      std::vector<TransactionRecord> transactions;
      PSIO_REFLECT(BlockRecord, id, header, transactions)
   };

   // Where a transaction lives in the chain, returned by transaction lookups.
   struct TransactionLocation
   {
      BlockNum          blockNum;
      Checksum256       blockId;
      BlockTime         blockTime;
      AccountNumber     producer;
      uint32_t          index;
      TransactionRecord transaction;
      PSIO_REFLECT(TransactionLocation, blockNum, blockId, blockTime, producer, index, transaction)
   };

   Checksum256 transactionId(const SignedTransaction& trx)
   {
      return sha256(trx.transaction.data(), trx.transaction.size());
   }

   TransactionRecord toTransactionRecord(const SignedTransaction& trx)
   {
      return TransactionRecord{
          .id          = transactionId(trx),
          .transaction = trx.transaction.unpack(),
          .proofs      = trx.proofs,
      };
   }

   BlockRecord toBlockRecord(Block&& block)
   {
      BlockRecord result;
      result.id = BlockInfo{block.header}.blockId;
      result.transactions.reserve(block.transactions.size());
      for (const auto& trx : block.transactions)
         result.transactions.push_back(toTransactionRecord(trx));
      result.header = std::move(block.header);
      return result;
   }

   TableIndex<Block, uint32_t> blockLog()
   {
      return TableIndex<Block, uint32_t>{DbId::blockLog, {}, false};
   }

   std::optional<Checksum256> parseChecksum(const std::string& hex)
   {
      std::vector<char> bytes;
      if (!psio::from_hex(hex, bytes) || bytes.size() != 32)
         return std::nullopt;
      Checksum256 result;
      std::memcpy(result.data(), bytes.data(), result.size());
      return result;
   }

   struct Query
   {
      // Paginated access to the block log. Supports gt/ge/lt/le on block number
      // and first/last/before/after cursors.
      auto blocks() const
      {
         return TransformedConnection{blockLog(), [](Block&& block)
                                      { return toBlockRecord(std::move(block)); }};
      }

      // Fetch a single block by number.
      std::optional<BlockRecord> block(uint32_t blockNum) const
      {
         auto block = blockLog().get(blockNum);
         if (!block)
            return std::nullopt;
         return toBlockRecord(std::move(*block));
      }

      // Fetch only the header of a block. Much cheaper than `block` for
      // blocks that carry large transactions (e.g. the boot block).
      std::optional<BlockHeader> blockHeader(uint32_t blockNum) const
      {
         auto block = blockLog().get(blockNum);
         if (!block)
            return std::nullopt;
         return std::move(block->header);
      }

      // The most recent block header in the log (cheap poll target).
      std::optional<BlockHeader> head() const
      {
         auto idx = blockLog();
         auto it  = idx.end();
         if (it == idx.begin())
            return std::nullopt;
         --it;
         return (*it).header;
      }

      // Locate a transaction by id. Scans backwards from the head of the chain
      // through at most `maxBlocks` blocks (default 5000, capped at 50000).
      std::optional<TransactionLocation> transaction(std::string             id,
                                                     std::optional<uint32_t> maxBlocks) const
      {
         auto target = parseChecksum(id);
         if (!target)
            return std::nullopt;

         auto     idx       = blockLog();
         auto     begin     = idx.begin();
         auto     it        = idx.end();
         uint32_t remaining = std::min<uint32_t>(maxBlocks.value_or(5000), 50000);
         while (it != begin && remaining-- > 0)
         {
            --it;
            Block block = *it;
            for (uint32_t i = 0; i < block.transactions.size(); ++i)
            {
               const auto& trx = block.transactions[i];
               if (transactionId(trx) == *target)
               {
                  return TransactionLocation{
                      .blockNum    = block.header.blockNum,
                      .blockId     = BlockInfo{block.header}.blockId,
                      .blockTime   = block.header.time,
                      .producer    = block.header.producer,
                      .index       = i,
                      .transaction = toTransactionRecord(trx),
                  };
               }
            }
         }
         return std::nullopt;
      }
   };
   PSIO_REFLECT(Query,
                method(blocks),
                method(block, blockNum),
                method(blockHeader, blockNum),
                method(head),
                method(transaction, id, maxBlocks))
}  // namespace

namespace SystemService
{
   std::optional<psibase::HttpReply> Explorer::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Explorer)
