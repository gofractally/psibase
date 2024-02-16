#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/webServices.hpp>
#include <psio/fracpack.hpp>
#include <services/system/ProxySys.hpp>
#include "services/system/AccountSys.hpp"

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   namespace
   {
      bool isSubdomain(const psibase::HttpRequest& req)
      {
         return req.host.size() > req.rootHost.size() + 1  //
                && req.host.ends_with(req.rootHost)        //
                && req.host[req.host.size() - req.rootHost.size() - 1] == '.';
      }

   }  // namespace

   // TODO: switch to Table wrapper
   using table_num = uint16_t;

   static constexpr table_num registeredServiceTable = 1;

   inline auto registeredServiceKey(AccountNumber thisService, AccountNumber service)
   {
      return std::tuple{thisService, registeredServiceTable, service};
   }
   struct RegisteredServiceRow
   {
      AccountNumber service = {};
      AccountNumber server  = {};

      auto key(AccountNumber thisService) { return registeredServiceKey(thisService, service); }
   };
   PSIO_REFLECT(RegisteredServiceRow, service, server)

   void ProxySys::registerServer(AccountNumber server)
   {
      RegisteredServiceRow row{
          .service = getSender(),
          .server  = server,
      };
      kvPut(row.key(getReceiver()), row);
   }

   extern "C" [[clang::export_name("serve")]] void serve()
   {
      auto act = getCurrentAction();
      // TODO: use a view
      auto req = psio::from_frac<HttpRequest>(act.rawData);

      std::string serviceName;

      // Path reserved across all subdomains
      if (req.target.starts_with("/common"))
         serviceName = "common-sys";

      // subdomain
      else if (isSubdomain(req))
         serviceName.assign(req.host.begin(), req.host.end() - req.rootHost.size() - 1);

      // root domain
      else
         serviceName = "common-sys";

      auto service = AccountNumber(serviceName);
      auto reg     = kvGet<RegisteredServiceRow>(registeredServiceKey(act.service, service));
      if (reg)
         service = reg->server;
      else
         service = "psispace-sys"_a;

      // TODO: avoid repacking (both directions)
      psibase::Actor<ServerInterface> iface(act.service, service);

      auto reqTarget = req.target;
      auto result    = iface.serveSys(std::move(req));
      if (result && !result->headers.empty() && serviceName != "common-sys")
         abortMessage("service " + service.str() + " attempted to set an http header");

      if (reqTarget.size() == 0 || reqTarget.starts_with("/index.html"))
      {
         // Check if the target header is already in the vector; if the header was not found, add it
         HttpHeader frameAncestorHeader = {"Content-Security-Policy", "frame-ancestors 'none';"};
         auto pos = std::find(result->headers.begin(), result->headers.end(), frameAncestorHeader);
         if (pos == result->headers.end())
         {
            result->headers.push_back(frameAncestorHeader);
         }
      }

      setRetval(result);
   }  // serve()

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::ProxySys)
