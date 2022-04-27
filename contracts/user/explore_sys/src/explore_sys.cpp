#include "contracts/user/explore_sys.hpp"

#include <contracts/system/proxy_sys.hpp>
#include <psibase/KVGraphQLConnection.hpp>
#include <psibase/dispatch.hpp>

using table_num = uint16_t;

static constexpr table_num web_content_table = 1;

inline auto webContentKey(psibase::AccountNumber thisContract, std::string_view path)
{
   return std::tuple{thisContract, web_content_table, path};
}
struct WebContentRow
{
   std::string       path        = {};
   std::string       contentType = {};
   std::vector<char> content     = {};

   auto key(psibase::AccountNumber thisContract) { return webContentKey(thisContract, path); }
};
PSIO_REFLECT(WebContentRow, path, contentType, content)

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
          gt, ge, lt, le, first, last, before, after, psibase::kv_map::block_log,
          psibase::BlockNum(0), ~psibase::BlockNum(0), 0,
          [](auto& block) {  //
             return block.header.num;
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
   std::optional<psibase::rpc_reply_data> explore_sys::serveSys(psibase::rpc_request_data request)
   {
      if (request.method == "GET")
      {
         auto content = kv_get<WebContentRow>(webContentKey(get_receiver(), request.target));
         if (!!content)
         {
            return psibase::rpc_reply_data{
                .contentType = content->contentType,
                .reply       = content->content,
            };
         }
      }

      if (request.method == "POST")
      {
         if (request.target == "/graphql")
         {
            auto result =
                psio::gql_query(QueryRoot(), {request.body.data(), request.body.size()}, {});
            return psibase::rpc_reply_data{
                .contentType = "application/json",
                .reply       = {result.data(), result.data() + result.size()},  // TODO: avoid copy
            };
         }
      }

      return std::nullopt;
   }  // explore_sys::proxy_sys

   void explore_sys::uploadSys(psio::const_view<std::string>       path,
                               psio::const_view<std::string>       contentType,
                               psio::const_view<std::vector<char>> content)
   {
      psibase::check(get_sender() == get_receiver(), "wrong sender");

      // TODO
      auto              size = content.size();
      std::vector<char> c(size);
      for (size_t i = 0; i < size; ++i)
         c[i] = content[i];

      // TODO: avoid copies before pack
      WebContentRow row{
          .path        = path,
          .contentType = contentType,
          .content     = std::move(c),
      };
      kv_put(row.key(get_receiver()), row);
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::explore_sys)
