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
      auto depsFor(AccountNumber service) const
      {
         auto table = DynLd{}.open<DynDepsTable>();
         return table.get(service);
      }
      PSIO_REFLECT(Query, method(depsFor, service))
   };
}  // namespace

auto RDynLd::serveSys(psibase::HttpRequest req) -> std::optional<psibase::HttpReply>
{
   if (auto result = serveGraphQL(req, Query{}))
      return result;
   return {};
}

PSIBASE_DISPATCH(RDynLd)
