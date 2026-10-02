#include "services/user/Explorer.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/HttpServer.hpp>

struct Query
{
   std::optional<psibase::AccountNumber> user;
   auto                                  blocks() const
   {
      return psibase::TransformedConnection{
          psibase::TableIndex<psibase::Block, uint32_t>{psibase::DbId::blockLog, {}, false},
          [this](psibase::Block&& block)
          {
             if (!user)
             {
                block.transactions.clear();
             }
             else
             {
                std::erase_if(block.transactions,
                              [user = *user](const psibase::SignedTransaction& tx)
                              {
                                 for (auto act : tx.transaction->actions())
                                 {
                                    if (act.sender() == user)
                                    {
                                       return false;
                                    }
                                 }
                                 return true;
                              });
             }
             return std::move(block);
          }};
   }
};
PSIO_REFLECT(  //
    Query,
    method(blocks))

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
