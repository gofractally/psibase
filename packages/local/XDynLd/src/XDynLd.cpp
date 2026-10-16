#include <services/local/XDynLd.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>

using namespace psibase;
using namespace LocalService;
using namespace UserService;

namespace
{
   struct Query
   {
      auto depsFor(AccountNumber service) const
      {
         std::optional<DynDeps> result;
         PSIBASE_SUBJECTIVE_TX { result = XDynLd{}.open<DynDepsTable>().get(service); }
         return result;
      }
      PSIO_REFLECT(Query, method(depsFor, service))
   };

   HttpReply error(const HttpRequest& req, HttpStatus status, std::string_view msg)
   {
      return HttpReply{.status      = status,
                       .contentType = "application/html",
                       .body        = {msg.begin(), msg.end()},
                       .headers     = allowCors(req, XAdmin::service)};
   }

   std::optional<HttpReply> requireAdminJsonPost(const HttpRequest&          req,
                                                 std::optional<std::int32_t> socket)
   {
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return reply;
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      if (req.contentType != "application/json")
      {
         return error(req, HttpStatus::unsupportedMediaType,
                      "Content-Type must be application/json\n");
      }
      return std::nullopt;
   }
}  // namespace

void XDynLd::link(AccountNumber service, std::string group, std::vector<DynDep> deps)
{
   PSIBASE_SUBJECTIVE_TX
   {
      auto groupsTable = open<DynDepGroupsTable>();
      auto depsTable   = open<DynDepsTable>();
      linkDynDepGroup(groupsTable, depsTable, service, std::move(group), std::move(deps));
   }
}

void XDynLd::unlink(AccountNumber service, std::string group)
{
   PSIBASE_SUBJECTIVE_TX
   {
      auto groupsTable = open<DynDepGroupsTable>();
      auto depsTable   = open<DynDepsTable>();
      unlinkDynDepGroup(groupsTable, depsTable, service, std::move(group));
   }
}

std::optional<HttpReply> XDynLd::serveSys(HttpRequest req, std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");

   if (req.method == "OPTIONS")
      return HttpReply{.headers = allowCors(req, XAdmin::service)};

   auto target = req.path();
   if (target == "/link")
   {
      if (auto reply = requireAdminJsonPost(req, socket))
         return reply;
      auto body = psio::convert_from_json<XDynLdLinkRequest>(
          std::string{req.body.data(), req.body.size()});
      XDynLd{}.link(body.service, std::move(body.group), std::move(body.deps));
      return HttpReply{.headers = allowCors(req, XAdmin::service)};
   }
   if (target == "/unlink")
   {
      if (auto reply = requireAdminJsonPost(req, socket))
         return reply;
      auto body = psio::convert_from_json<XDynLdUnlinkRequest>(
          std::string{req.body.data(), req.body.size()});
      XDynLd{}.unlink(body.service, std::move(body.group));
      return HttpReply{.headers = allowCors(req, XAdmin::service)};
   }

   if (auto result = serveGraphQL(req, Query{}))
      return result;
   return {};
}

PSIBASE_DISPATCH(XDynLd)
