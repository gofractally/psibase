#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/dispatch.hpp>

// Identifies the service that handled the request
struct ServerId : psibase::Service
{
   std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest req);
};
PSIO_REFLECT(ServerId, method(serveSys, req))

using namespace psibase;

std::optional<HttpReply> ServerId::serveSys(HttpRequest req)
{
   HttpReply           reply{.contentType = "application/json"};
   psio::vector_stream stream{reply.body};
   to_json(getReceiver(), stream);
   return std::move(reply);
}

PSIBASE_DISPATCH(ServerId)
