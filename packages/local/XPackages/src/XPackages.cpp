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
      auto installed(const std::optional<std::string>& gt,
                     const std::optional<std::string>& ge,
                     const std::optional<std::string>& lt,
                     const std::optional<std::string>& le,
                     std::optional<uint32_t>           first,
                     std::optional<uint32_t>           last,
                     const std::optional<std::string>& before,
                     const std::optional<std::string>& after) const
      {
         using NodeType = LocalPackage;
         using EdgeType = Edge<NodeType, psio::reflect<NodeType>::name + "Edge">;
         using ConnType = Connection<NodeType, psio::reflect<NodeType>::name + "Connection",
                                     psio::reflect<NodeType>::name + "Edge">;
         ConnType result;
         PSIBASE_SUBJECTIVE_TX
         {
            result = makeConnection<ConnType>(XPackages{}.open<LocalPackagesTable>().getIndex<0>(),
                                              gt, ge, lt, le, first, last, before, after);
         }
         return result;
      }
   };
   PSIO_REFLECT(Query, method(installed, gt, ge, lt, le, first, last, before, after))

   HttpReply error(const HttpRequest& req, HttpStatus status, std::string_view msg)
   {
      return HttpReply{.status      = status,
                       .contentType = "application/html",
                       .body        = std::vector(msg.begin(), msg.end()),
                       .headers     = allowCors(req, XAdmin::service)};
   }
}  // namespace

std::optional<psibase::HttpReply> XPackages::serveSys(psibase::HttpRequest        req,
                                                      std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");

   if (auto reply = to<XAdmin>().checkAuth(req, socket))
      return reply;

   if (req.method == "OPTIONS")
   {
      return HttpReply{.headers = allowCors(req, XAdmin::service)};
   }
   auto target = req.path();
   if (target == "/preinstall" || target == "/prerm")
   {
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      if (req.contentType != "application/json")
      {
         return error(req, HttpStatus::unsupportedMediaType,
                      "Content-Type must be application/json\n");
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
             .removing    = target == "/prerm",
         });
      }
      return HttpReply{.headers = allowCors(req, XAdmin::service)};
   }
   else if (target == "/postinstall" || target == "/postrm")
   {
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      if (req.contentType != "application/json")
      {
         return error(req, HttpStatus::unsupportedMediaType,
                      "Content-Type must be application/json\n");
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
         if (target == "/postrm")
            table.erase(package.name);
         else
            table.put(package);
      }
      return HttpReply{.headers = allowCors(req, XAdmin::service)};
   }
   else if (auto result = serveGraphQL(req, Query{}))
   {
      return result;
   }
   return {};
}

PSIBASE_DISPATCH(XPackages)
