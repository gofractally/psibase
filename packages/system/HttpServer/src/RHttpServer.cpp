#include "services/system/RHttpServer.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/HttpServer.hpp>

using namespace psibase;

namespace SystemService
{
   std::optional<HttpReply> RHttpServer::serveSys(HttpRequest request)
   {
      if (auto result = psibase::serveSimpleUI<HttpServer, true>(request))
         return result;
      return std::nullopt;
   }  // serveSys
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RHttpServer)
