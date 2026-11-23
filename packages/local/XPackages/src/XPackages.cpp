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
      auto installed(psio::graphql::key_range<std::string> range,
                     psio::graphql::page_args              page) const
      {
         using Page = psio::graphql::result<
             psio::graphql::connection<psio::shared_pssz<LocalPackage>>>;
         std::optional<Page> result;
         PSIBASE_SUBJECTIVE_TX
         {
            result.emplace(psio::graphql::paginate(
                IndexView{XPackages{}.open<LocalPackagesTable>().getIndex<0>()}, range, page,
                allRows));
         }
         return std::move(*result);
      }
   };
   PSIO_REFLECT(Query, method(installed, range, page))

   HttpReply error(const HttpRequest& req, HttpStatus status, std::string_view msg)
   {
      return HttpReply{.status      = status,
                       .contentType = "application/html",
                       .body        = std::vector(msg.begin(), msg.end()),
                       .headers     = allowCors(req, XAdmin::service)};
   }
}  // namespace

std::optional<psibase::HttpReply> XPackages::serveSys(psibase::HttpRequest        request,
                                                      std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");

   if (auto reply = to<XAdmin>().checkAuth(request, socket))
      return reply;

   if (request.method == "OPTIONS")
   {
      return HttpReply{.headers = allowCors(request, XAdmin::service)};
   }
   auto target = request.path();
   if (target == "/preinstall" || target == "/prerm")
   {
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);
      if (request.contentType != "application/json")
      {
         return error(request, HttpStatus::unsupportedMediaType,
                      "Content-Type must be application/json\n");
      }
      auto package      = psio::from_ijson<LocalPackage>(request.body);
      auto pendingTable = open<PendingLocalPackagesTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         pendingTable.put({
             .name        = std::move(package.name),
             .version     = std::move(package.version),
             .description = std::move(package.description),
             .depends     = std::move(package.depends),
             .accounts    = std::move(package.accounts),
             .services    = std::move(package.services),
             .exports     = std::move(package.exports),
             .sha256      = std::move(package.sha256),
             .removing    = target == "/prerm",
         });
      }
      return HttpReply{.headers = allowCors(request, XAdmin::service)};
   }
   else if (target == "/postinstall" || target == "/postrm")
   {
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);
      if (request.contentType != "application/json")
      {
         return error(request, HttpStatus::unsupportedMediaType,
                      "Content-Type must be application/json\n");
      }
      auto package      = psio::from_ijson<LocalPackage>(request.body);
      auto table        = open<LocalPackagesTable>();
      auto pendingTable = open<PendingLocalPackagesTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         auto pending = pendingTable.get(std::tie(package.name, package.version, package.sha256));
         if (pending)
            pendingTable.remove(*pending);
         if (target == "/postrm")
            table.erase(package.name);
         else
            table.put(package);
      }
      return HttpReply{.headers = allowCors(request, XAdmin::service)};
   }
   else if (auto result = serveGraphQL(request, Query{}))
   {
      return result;
   }
   return {};
}

PSIBASE_DISPATCH(XPackages)
