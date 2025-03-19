#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serveGraphQL.hpp>

using namespace psibase;

struct SocketListService : psibase::Service
{
   std::optional<HttpReply> serveSys(const HttpRequest& req);
};
PSIO_REFLECT(SocketListService, method(serveSys, request))

namespace
{

   struct QueryRoot
   {
      auto sockets() const
      {
         checkoutSubjective();
         auto table =
             Table<SocketRow, &SocketRow::fd>{SocketRow::db, psio::convert_to_key(socketTable)};
         return table.getIndex<0>();
      }
   };
   PSIO_REFLECT(QueryRoot, method(sockets))

}  // namespace

std::optional<HttpReply> SocketListService::serveSys(const HttpRequest& req)
{
   if (auto reply = serveGraphQL(req, QueryRoot{}))
   {
      return reply;
   }
   return {};
}

PSIBASE_DISPATCH(SocketListService)
