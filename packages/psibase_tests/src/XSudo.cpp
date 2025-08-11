#include <services/test/XSudo.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

std::optional<HttpReply> XSudo::serveSys(HttpRequest req)
{
   call(psio::from_frac<Action>(req.body));
   return HttpReply{};
}

PSIBASE_DISPATCH(XSudo)
