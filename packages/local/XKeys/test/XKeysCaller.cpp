#include "XKeysCaller.hpp"

#include <psibase/dispatch.hpp>
#include <services/local/XKeys.hpp>

using namespace psibase;
using namespace TestService;
using namespace LocalService;

std::optional<psibase::HttpReply> XKeysCaller::serveSys(psibase::HttpRequest request)
{
   auto path = request.path();
   if (path == "/new")
   {
      auto key = to_string(to<XKeys>().newKey());
      return HttpReply{.contentType = "text/plain", .body = {key.begin(), key.end()}};
   }
   else if (path == "/sign")
   {
      auto actions = psio::convert_from_json<std::vector<Action>>(
          std::string(request.body.begin(), request.body.end()));
      return HttpReply{.contentType = "application/octet-stream",
                       .body        = psio::to_frac(to<XKeys>().signTx(actions))};
   }
   return {};
}

PSIBASE_DISPATCH(XKeysCaller)
