#include <cstdint>
#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/dispatch.hpp>
#include <psio/to_json.hpp>
#include <services/system/HttpServer.hpp>

using namespace psibase;
using namespace SystemService;

struct GetUser : psibase::Service
{
   std::optional<HttpReply> serveSys(HttpRequest req,
                                     std::optional<std::int32_t>,
                                     std::optional<AccountNumber> user)
   {
      check(getSender() == HttpServer::service, "Wrong sender");
      HttpReply           result{.contentType = "application/json"};
      psio::vector_stream stream{result.body};
      psio::to_json(user, stream);
      return result;
   }
};
PSIO_REFLECT(GetUser, method(serveSys, req, socket, user))
PSIBASE_REFLECT_TABLES(GetUser)

PSIBASE_DISPATCH(GetUser)
