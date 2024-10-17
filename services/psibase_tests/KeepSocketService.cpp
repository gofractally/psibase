#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/HttpServer.hpp>

using SystemService::HttpServer;
using namespace psibase;

struct KeepSocket : Service<KeepSocket>
{
   std::optional<HttpReply> serveSys(HttpRequest req, const std::optional<std::uint32_t> socket)
   {
      to<HttpServer>().deferReply(*socket);
      abortMessage("...");
      return {};
   }
};
PSIO_REFLECT(KeepSocket, method(serveSys, req, socket))

PSIBASE_DISPATCH(KeepSocket)
