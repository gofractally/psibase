#include "services/user/Explorer.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/schema.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psio/schema.hpp>
#include <psio/to_hex.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>
#include <services/user/Packages.hpp>

#include <cstring>

using namespace psibase;
using namespace SystemService;

using SharedBlock = psio::shared_view_ptr<Block>;

// JSON value embedded directly into a GraphQL response (not re-quoted as a string).
struct EmbeddedJson
{
   std::string json;
};

template <typename S>
void to_json(const EmbeddedJson& value, S& stream)
{
   stream.write(value.json.data(), value.json.size());
}

inline constexpr bool use_json_string_for_gql(EmbeddedJson*)
{
   return true;
}

std::optional<EmbeddedJson> decodeActionData(AccountNumber         service,
                                             MethodNumber          method,
                                             std::span<const char> rawData)
{
   auto schema = to<UserService::Packages>().getSchema(service);
   if (!schema)
      return std::nullopt;

   auto pos = schema->actions.find(method.str());
   if (pos == schema->actions.end())
      return std::nullopt;

   const auto&                        params = pos->second.params;
   psio::schema_types::CompiledSchema cschema{schema->types, psibase_types(), {&params}};
   auto*                              cty = cschema.get(params.resolve(schema->types));
   if (!cty)
      return std::nullopt;

   psio::schema_types::FracParser parser{psio::FracStream{rawData}, cty, cschema.builtin};
   std::string                    json;
   psio::string_stream            stream{json};
   to_json(parser, stream);
   if (json.empty() || json == "null")
      return std::nullopt;
   return EmbeddedJson{std::move(json)};
}

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
   bool operator()(psio::view<const Action> action) const
   {
      return (*this)(action.sender()) || (*this)(action.service());
   }
   bool operator()(psio::view<const Transaction> transaction) const
   {
      for (auto action : transaction.actions())
      {
         if ((*this)(action))
            return true;
      }
      return false;
   }
   bool operator()(psio::view<const SignedTransaction> transaction) const
   {
      return (*this)(*transaction.transaction());
   }
};

struct ActionQuery
{
   psio::view<const Action> action;
   AccountNumber            sender() const { return action.sender(); }
   AccountNumber            service() const { return action.service(); }
   MethodNumber             method() const { return action.method(); }
   std::string              rawData() const
   {
      std::span<const char> result = action.rawData();
      return psio::to_hex(result);
   }
   // Action arguments decoded with the service's schema, if one is available
   std::optional<EmbeddedJson> data() const
   {
      return decodeActionData(action.service(), action.method(), action.rawData());
   }
   PSIO_REFLECT(ActionQuery,
                method(sender),
                method(service),
                method(method),
                method(rawData),
                method(data))
};

struct TransactionQuery
{
   psio::view<const Transaction> transaction;
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
   psio::view<const SignedTransaction> value;
   const TransactionAuthChecker*       censor;
   Checksum256 id() const { return sha256(value.transaction().data(), value.transaction().size()); }
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
   BlockHeader                         header() const { return block->header(); }
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
   psio::view<const SignedTransaction> value;
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
   auto                   blocks() const
   {
      return psibase::TransformedConnectionView{
          blockLog(),
          [this](SharedBlock&& block) { return BlockQuery{std::move(block), &transactionCensor}; }};
   }

   std::optional<BlockQuery> block(std::uint32_t blockNum) const
   {
      auto block = blockLog().getView(blockNum);
      if (!block)
         return std::nullopt;
      return BlockQuery{std::move(block), &transactionCensor};
   }

   std::optional<BlockHeader> head() const
   {
      auto index = blockLog();
      auto it    = index.end();
      --it;
      if (it == index.end())
         return std::nullopt;
      BlockHeader header = it.view()->header();
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
            if (sha256(trx.transaction().data(), trx.transaction().size()) == *target)
            {
               BlockHeader header = block->header();
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
    method(blocks),
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
      if (auto result = psibase::serveGraphQL(request, Query{user}))
         return result;
      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Explorer)
