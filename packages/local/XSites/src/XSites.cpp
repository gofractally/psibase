#include <services/local/XSites.hpp>

#include <psibase/dispatch.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>

using namespace psibase;
using namespace LocalService;

namespace
{
   std::vector<HttpHeader> staticReadCors(const HttpRequest& req)
   {
      return allowCors(req, {XAdmin::service, AccountNumber{"supervisor"}});
   }
}  // namespace

std::optional<HttpReply> XSites::serveSys(HttpRequest req, std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");

   auto service = XHttp::getService(req);
   if (service == AccountNumber{})
      return {};

   auto target = req.path();

   auto table = open<ContentTable>();
   if (req.method == "OPTIONS")
      return HttpReply{.headers = staticReadCors(req)};
   else if (req.method == "PUT")
   {
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return reply;
      ContentRow row{
          .account     = service,
          .path        = target,
          .contentType = req.contentType,
          .contentHash = sha256(req.body.data(), req.body.size()),
          .content     = std::move(req.body),
      };
      if (auto contentEncoding = req.getHeader("content-encoding"))
         row.contentEncoding = *contentEncoding;
      if (auto csp = req.getHeader("content-security-policy"))
         row.csp = *csp;
      PSIBASE_SUBJECTIVE_TX
      {
         table.put(row);
      }
      return HttpReply{.headers = allowCors(req, XAdmin::service)};
   }
   else if (req.method == "DELETE")
   {
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return reply;
      PSIBASE_SUBJECTIVE_TX
      {
         table.erase(std::tuple(service, target));
      }
      return HttpReply{.headers = allowCors(req, XAdmin::service)};
   }
   else
   {
      std::optional<ContentRow> row;
      if (target.starts_with(XHttp::commonPrefix))
      {
         service = XHttp::commonService;
      }
      PSIBASE_SUBJECTIVE_TX
      {
         row = table.get(std::tuple(service, target));
         if (!row)
         {
            row = table.get(std::tuple(
                service, target + (target.ends_with('/') ? "index.html" : "/index.html")));
         }
      }
      if (row)
      {
         if (req.method != "GET")
         {
            return HttpReply::methodNotAllowed(req);
         }
         auto reply = HttpReply{
             .contentType = std::move(row->contentType),
             .body        = std::move(row->content),
             .headers     = staticReadCors(req),
         };
         if (row->contentEncoding)
         {
            reply.headers.push_back({"Content-Encoding", std::move(*row->contentEncoding)});
         }
         if (row->csp)
         {
            reply.headers.push_back({"Content-Security-Policy", std::move(*row->csp)});
         }
         return reply;
      }
   }
   return {};
}

PSIBASE_DISPATCH(XSites)
