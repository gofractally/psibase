#include <services/local/XPackages.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>

using namespace psibase;
using namespace LocalService;
using UserService::PackageKey;

namespace
{
   struct Query
   {
      auto installed() const { return XPackages{}.open<LocalPackagesTable>().getIndex<0>(); }
   };
   PSIO_REFLECT(Query, method(installed))

   HttpReply error(HttpStatus status, std::string_view msg)
   {
      return HttpReply{.status      = status,
                       .contentType = "application/html",
                       .body        = std::vector(msg.begin(), msg.end())};
   }
}  // namespace

std::optional<psibase::HttpReply> XPackages::serveSys(psibase::HttpRequest        req,
                                                      std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");

   if (auto reply = to<XAdmin>().checkAuth(req, socket))
      return reply;

   auto target = req.path();
   if (target == "/preinstall")
   {
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      if (req.contentType != "application/json")
      {
         return error(HttpStatus::unsupportedMediaType, "Content-Type must be application/json\n");
      }
      auto package =
          psio::convert_from_json<LocalPackage>(std::string(req.body.begin(), req.body.end()));
      auto pendingTable = open<PendingLocalPackagesTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         pendingTable.put({
             .name        = std::move(package.name),
             .version     = std::move(package.version),
             .description = std::move(package.description),
             .depends     = std::move(package.depends),
             .accounts    = std::move(package.accounts),
             .sha256      = std::move(package.sha256),
         });
      }
      return HttpReply{};
   }
   else if (target == "/postinstall")
   {
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      if (req.contentType != "application/json")
      {
         return error(HttpStatus::unsupportedMediaType, "Content-Type must be application/json\n");
      }
      auto package =
          psio::convert_from_json<LocalPackage>(std::string(req.body.begin(), req.body.end()));
      auto table        = open<LocalPackagesTable>();
      auto pendingTable = open<PendingLocalPackagesTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         auto pending = pendingTable.get(std::tie(package.name, package.version, package.sha256));
         if (pending)
            pendingTable.remove(*pending);
         table.put({
             .name        = std::move(package.name),
             .version     = std::move(package.version),
             .description = std::move(package.description),
             .depends     = std::move(package.depends),
             .accounts    = std::move(package.accounts),
             .sha256      = std::move(package.sha256),
         });
      }
      return HttpReply{};
   }
   else if (auto result = serveGraphQL(req, Query{}))
   {
      return result;
   }
   return {};
}

PSIBASE_DISPATCH(XPackages)
