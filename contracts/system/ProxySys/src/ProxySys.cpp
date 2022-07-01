#include <contracts/system/ProxySys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/webServices.hpp>
#include <psio/fracpack.hpp>
#include "contracts/system/AccountSys.hpp"

static constexpr bool enable_print = false;

namespace psibase
{
   namespace
   {
      bool isSubdomain(const psibase::RpcRequestData& req)
      {
         return req.host.size() > req.rootHost.size() + 1  //
                && req.host.ends_with(req.rootHost)        //
                && req.host[req.host.size() - req.rootHost.size() - 1] == '.';
      }

      struct Injector
      {
         using TestFunc = std::function<bool(const psibase::RpcRequestData&)>;
         TestFunc    func;
         std::string injection;
         bool        shouldInject = 0;
      };

      // Todo - replace cdn with on-chain resources
      Injector iframeResizer{
          .func = [](const psibase::RpcRequestData& req) { return (req.target == "/"); },
          .injection =
              "<script src=\"https://unpkg.com/iframe-resizer@4.3.1/js/"
              "iframeResizer.contentWindow.js\" crossorigin></script>",
      };

      Injector subdomainLogin{
          .func = [](const psibase::RpcRequestData& req) { return isSubdomain(req); },
          .injection =
              "<link rel=\"stylesheet\" "
              "href=\"https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/2.4.1/semantic.min.css\" "
              "/>"
              "<script src=\"common/loginBar.js\" type=\"module\"></script>",
      };

      std::vector<Injector> injectors{iframeResizer, subdomainLogin};

      void injectHtml(std::optional<psibase::RpcReplyData>& reply, const std::string& html)
      {
         if (reply.has_value() && reply->contentType == "text/html")
         {
            reply->body.insert(reply->body.end(), html.begin(), html.end());
         }
      }

      void debugAlert(std::optional<psibase::RpcReplyData>& reply, const std::string& message)
      {
         injectHtml(reply, "<script>alert(\"" + message + "\");</script>");
      }

   }  // namespace

   // TODO: switch to Table wrapper
   using table_num = uint16_t;

   static constexpr table_num registered_contract_table = 1;

   inline auto registeredContractKey(AccountNumber this_contract, AccountNumber contract)
   {
      return std::tuple{this_contract, registered_contract_table, contract};
   }
   struct RegisteredContractRow
   {
      AccountNumber contract       = {};
      AccountNumber serverContract = {};

      auto key(AccountNumber this_contract)
      {
         return registeredContractKey(this_contract, contract);
      }
   };
   PSIO_REFLECT(RegisteredContractRow, contract, serverContract)

   void ProxySys::registerServer(AccountNumber serverContract)
   {
      RegisteredContractRow row{
          .contract       = getSender(),
          .serverContract = serverContract,
      };
      kvPut(row.key(getReceiver()), row);
   }

   extern "C" [[clang::export_name("serve")]] void serve()
   {
      auto act = getCurrentAction();
      // TODO: use a view
      auto req = psio::convert_from_frac<RpcRequestData>(act.rawData);

      std::string contractName;

      // Path reserved across all subdomains
      if (req.target.starts_with("/common"))
         contractName = "common-sys";

      // subdomain
      else if (isSubdomain(req))
         contractName.assign(req.host.begin(), req.host.end() - req.rootHost.size() - 1);

      // root domain
      else
         contractName = "common-sys";

      for (auto& i : injectors)
      {
         i.shouldInject = i.func(req);
      }

      auto contract = AccountNumber(contractName);
      auto reg      = kvGet<RegisteredContractRow>(registeredContractKey(act.contract, contract));
      if (!reg)
         abortMessage("contract not registered: " + contract.str());

      // TODO: avoid repacking (both directions)
      psibase::Actor<ServerInterface> iface(act.contract, reg->serverContract);
      auto                            reply = iface.serveSys(std::move(req)).unpack();

      for (auto& i : injectors)
      {
         if (i.shouldInject)
         {
            injectHtml(reply, i.injection);
         }
      }

      setRetval(reply);
   }  // serve()

}  // namespace psibase

PSIBASE_DISPATCH(psibase::ProxySys)
