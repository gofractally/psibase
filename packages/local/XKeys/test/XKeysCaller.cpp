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
      auto actions = psio::from_ijson<std::vector<Action>>(request.body);
      return HttpReply{.contentType = "application/octet-stream",
                       .body        = psio::to_pssz(to<XKeys>().signTx(actions))};
   }
   return {};
}

PSIBASE_DISPATCH(XKeysCaller)
