#include "services/user/Explorer.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psio/to_hex.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>

#include <cstring>

using namespace psibase;
using namespace SystemService;

using SharedBlock = psio::shared_pssz<Block>;

struct TransactionAuthChecker
{
   TransactionAuthChecker(std::optional<AccountNumber> user)
       : user(user ? std::vector{*user} : std::vector<AccountNumber>{})
   {
   }
   std::vector<AccountNumber>            user;
   mutable std::map<AccountNumber, bool> visited;
   bool                                  operator()(AccountNumber account) const
   {
      if (account == AccountNumber{})
         return false;
      auto [pos, inserted] = visited.try_emplace(account, false);
      if (inserted)
      {
         pos->second = to<Transact>().isAuth(
             std::vector{
                 AuthTarget{account, ServiceMethod{getReceiver(), MethodNumber{"graphql"}}}},
             user);
      }
      return pos->second;
   }
   bool operator()(psio::pssz_view<Action> action) const
   {
      return (*this)(action.sender()) || (*this)(action.service());
   }
   bool operator()(psio::pssz_view<Transaction> transaction) const
   {
      for (auto action : transaction.actions())
      {
         if ((*this)(action))
            return true;
      }
      return false;
   }
   bool operator()(psio::pssz_view<SignedTransaction> transaction) const
   {
      return (*this)(*transaction.transaction());
   }
};

struct ActionQuery
{
   psio::pssz_view<Action> action;
   AccountNumber            sender() const { return action.sender(); }
   AccountNumber            service() const { return action.service(); }
   MethodNumber             method() const { return action.method(); }
   std::string              rawData() const
   {
      std::span<const char> result = action.rawData();
      return psio::to_hex(result);
   }
   PSIO_REFLECT(ActionQuery, method(sender), method(service), method(method), method(rawData))
};

struct TransactionQuery
{
   psio::pssz_view<Transaction> transaction;
   std::vector<ActionQuery>      actions() const
   {
      std::vector<ActionQuery> result;
      result.reserve(transaction.actions().size());
      for (auto action : transaction.actions())
      {
         result.push_back({action});
      }
      return result;
   }
   PSIO_REFLECT(TransactionQuery, method(actions))
};

struct SignedTransactionQuery
{
   psio::pssz_view<SignedTransaction> value;
   const TransactionAuthChecker*       censor;
   Checksum256 id() const { return sha256(value.transaction().bytes().data(), value.transaction().bytes().size()); }
   // Available even when the transaction is censored
   std::uint32_t numActions() const { return value.transaction()->actions().size(); }
   std::optional<TransactionQuery> transaction() const
   {
      if ((*censor)(value))
      {
         return TransactionQuery{*value.transaction()};
      }
      else
      {
         return std::nullopt;
      }
   }
   std::optional<std::vector<std::string>> proofs() const
   {
      if ((*censor)(value))
      {
         std::vector<std::string> result;
         result.reserve(value.proofs().size());
         for (std::span<const char> proof : value.proofs())
         {
            result.push_back(psio::to_hex(proof));
         }
         return result;
      }
      else
      {
         return std::nullopt;
      }
   }
   PSIO_REFLECT(SignedTransactionQuery,
                method(id),
                method(numActions),
                method(transaction),
                method(proofs))
};

struct ServiceActionCount
{
   AccountNumber service;
   std::uint32_t count;
   PSIO_REFLECT(ServiceActionCount, service, count)
};

struct BlockQuery
{
   SharedBlock                         block;
   const TransactionAuthChecker*       transactionCensor;
   Checksum256                         id() const { return BlockInfo{header()}.blockId; }
   BlockHeader                         header() const { return block->header().unpack(); }
   std::vector<SignedTransactionQuery> transactions() const
   {
      std::vector<SignedTransactionQuery> result;
      result.reserve(block->transactions().size());
      for (auto transaction : block->transactions())
      {
         result.push_back(SignedTransactionQuery{transaction, transactionCensor});
      }
      return result;
   }
   // Number of top-level actions received by each service, across all
   // transactions in the block. This is public even for censored transactions.
   std::vector<ServiceActionCount> actionsReceived() const
   {
      std::map<AccountNumber, std::uint32_t> counts;
      for (auto transaction : block->transactions())
      {
         for (auto action : transaction.transaction()->actions())
         {
            ++counts[action.service()];
         }
      }
      std::vector<ServiceActionCount> result;
      result.reserve(counts.size());
      for (const auto& [service, count] : counts)
      {
         result.push_back({service, count});
      }
      return result;
   }
   PSIO_REFLECT(BlockQuery,
                method(id),
                method(header),
                method(transactions),
                method(actionsReceived))
};

struct TransactionLocation
{
   SharedBlock                         block;
   BlockHeader                         blockHeader;
   std::uint32_t                       txIndex;
   psio::pssz_view<SignedTransaction> value;
   const TransactionAuthChecker*       censor;

   BlockNum               blockNum() const { return blockHeader.blockNum; }
   Checksum256            blockId() const { return BlockInfo{blockHeader}.blockId; }
   BlockTime              blockTime() const { return blockHeader.time; }
   AccountNumber          producer() const { return blockHeader.producer; }
   std::uint32_t          index() const { return txIndex; }
   SignedTransactionQuery transaction() const { return SignedTransactionQuery{value, censor}; }
   PSIO_REFLECT(TransactionLocation,
                method(blockNum),
                method(blockId),
                method(blockTime),
                method(producer),
                method(index),
                method(transaction))
};

static TableIndex<Block, std::uint32_t> blockLog()
{
   return TableIndex<Block, std::uint32_t>{DbId::blockLog, {}, false};
}

// Default limit on the stored size of a page of blocks. The rows, the query
// results, the hex-encoded JSON, and the packed response can need about 4x
// this much, which must fit in a query's 32 MiB of memory.
static constexpr std::uint32_t blocksPageBytes = 6 * 1024 * 1024;

// A page of blocks is bounded by its stored size, not by the number of rows
// asked for. The Explorer UI keeps a window of 720 blocks and asks for
// `blocks(last: 720) { ... transactions { ... actions { ... } } }`: the
// two lists inside a block count 10 elements each, about 500 per row and
// 360 000 for the page, above the engine's default of 100 000.
static constexpr psio::graphql::limits queryLimits{.max_complexity = 1'000'000};

static std::optional<Checksum256> parseChecksum(const std::string& hex)
{
   std::vector<char> bytes;
   if (!psio::from_hex(hex, bytes) || bytes.size() != Checksum256{}.size())
      return std::nullopt;
   Checksum256 result;
   std::memcpy(result.data(), bytes.data(), result.size());
   return result;
}

struct Query
{
   TransactionAuthChecker transactionCensor;
   /// A page may hold fewer blocks than requested, but never none if any match;
   /// use `pageInfo` to continue.
   auto blocks(psio::graphql::key_range<std::uint32_t> range, psio::graphql::page_args page) const
   {
      return psio::graphql::paginate(
          psio::graphql::transform(IndexView{blockLog()},
                                   [this](SharedBlock&& block)
                                   { return BlockQuery{std::move(block), &transactionCensor}; }),
          range, page,
          psio::graphql::page_budget{.max_bytes     = blocksPageBytes,
                                     .max_page_size = allRows.max_page_size});
   }

   std::optional<BlockQuery> block(std::uint32_t blockNum) const
   {
      auto block = blockLog().getView(blockNum);
      if (!block)
         return std::nullopt;
      return BlockQuery{std::move(*block), &transactionCensor};
   }

   std::optional<BlockHeader> head() const
   {
      auto index = blockLog();
      auto it    = index.end();
      --it;
      if (it == index.end())
         return std::nullopt;
      BlockHeader header = it.view()->header().unpack();
      return header;
   }

   // Scans backwards from the head through at most `maxBlocks` blocks
   // (default 5000, capped at 50000).
   std::optional<TransactionLocation> transaction(std::string                  id,
                                                  std::optional<std::uint32_t> maxBlocks) const
   {
      auto target = parseChecksum(id);
      if (!target)
         return std::nullopt;

      auto          index     = blockLog();
      auto          begin     = index.begin();
      auto          it        = index.end();
      std::uint32_t remaining = std::min<std::uint32_t>(maxBlocks.value_or(5000), 50000);
      while (it != begin && remaining-- > 0)
      {
         --it;
         auto          block = it.view();
         std::uint32_t i     = 0;
         for (auto trx : block->transactions())
         {
            if (sha256(trx.transaction().bytes().data(), trx.transaction().bytes().size()) == *target)
            {
               BlockHeader header = block->header().unpack();
               return TransactionLocation{std::move(block), std::move(header), i, trx,
                                          &transactionCensor};
            }
            ++i;
         }
      }
      return std::nullopt;
   }
};
PSIO_REFLECT(  //
    Query,
    attr(transactionCensor, psio::graphql::hidden),
    method(blocks, range, page),
    method(block, blockNum),
    method(head),
    method(transaction, id, maxBlocks))

namespace SystemService
{
   std::optional<psibase::HttpReply> Explorer::serveSys(psibase::HttpRequest   request,
                                                        std::optional<int32_t> socket,
                                                        std::optional<psibase::AccountNumber> user)
   {
      psibase::check(psibase::getSender() == HttpServer::service, "Wrong sender");
      if (auto result = psibase::serveGraphQL(request, Query{user}, queryLimits))
         return result;
      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Explorer)
