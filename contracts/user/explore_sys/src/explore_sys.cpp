#include "contracts/user/explore_sys.hpp"

#include <contracts/system/proxy_sys.hpp>
#include <psibase/KVGraphQLConnection.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>

using Tables = psibase::ContractTables<psibase::WebContentTable>;

struct Block
{
   std::shared_ptr<psibase::Block> block;

   const auto& header() const { return block->header; }
   const auto& transactions() const { return block->transactions; }
};
PSIO_REFLECT(Block, method(header), method(transactions))

using BlockEdge       = psio::Edge<Block>;
using BlockConnection = psio::Connection<Block>;
PSIO_REFLECT_GQL_EDGE(BlockEdge)
PSIO_REFLECT_GQL_CONNECTION(BlockConnection)

struct QueryRoot
{
   // TODO: avoid reading full blocks
   auto blocks(const std::optional<psibase::BlockNum>& gt,
               const std::optional<psibase::BlockNum>& ge,
               const std::optional<psibase::BlockNum>& lt,
               const std::optional<psibase::BlockNum>& le,
               std::optional<uint32_t>                 first,
               std::optional<uint32_t>                 last,
               const std::optional<std::string>&       before,
               const std::optional<std::string>&       after) const
   {
      return psibase::makeKVConnection<BlockConnection, psibase::Block>(
          gt, ge, lt, le, first, last, before, after, psibase::DbId::blockLog, psibase::BlockNum(0),
          ~psibase::BlockNum(0), 0,
          [](auto& block) {  //
             return block.header.blockNum;
          },
          [](auto& p) {  //
             return Block{p};
          });
   }  // blocks()
};
PSIO_REFLECT(  //
    QueryRoot,
    method(blocks, gt, ge, lt, le, first, last, before, after))

namespace system_contract
{
   std::optional<psibase::RpcReplyData> explore_sys::serveSys(psibase::RpcRequestData request)
   {
      if (auto result = psibase::serveGraphQL(request, [] { return QueryRoot{}; }))
         return result;
      if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
         return result;
      return std::nullopt;
   }

   void explore_sys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(getSender() == getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{getReceiver()});
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::explore_sys)
