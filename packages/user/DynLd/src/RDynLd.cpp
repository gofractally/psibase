#include <services/user/RDynLd.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/user/DynLd.hpp>

using namespace psibase;
using namespace UserService;

namespace
{
   struct Query
   {
      auto uiDepsFor(AccountNumber service) const
      {
         auto table = DynLd{}.open<UiDepsTable>();
         return table.get(service);
      }
      PSIO_REFLECT(Query, method(uiDepsFor, service))
   };
}  // namespace

auto RDynLd::serveSys(psibase::HttpRequest req) -> std::optional<psibase::HttpReply>
{
   if (auto result = serveGraphQL(req, Query{}))
      return result;
   return {};
}

PSIBASE_DISPATCH(RDynLd)
