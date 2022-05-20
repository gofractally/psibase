#pragma once

#include <psibase/contractEntry.hpp>
#include <psibase/serveActionTemplates.hpp>
#include <psibase/servePackAction.hpp>

namespace psibase
{
   constexpr const char simpleUIMainPage[] =
       R"(<html><div id="root"></div><script src="/common/SimpleUI.mjs" type="module"></script></html>)";

   /// Serve a developer UI
   ///
   /// This function serves a simple developer UI to help get you started. The UI it
   /// generates is not suitable for end users.
   ///
   /// This serves the following:
   /// - `GET /action_templates`: provided by [serveActionTemplates]
   /// - `POST /pack_action/x`: provided by [servePackAction]
   /// - `GET /`, but only if `IncludeRoot` is set. This returns the following HTML body:
   ///
   /// ```html
   /// &lt;html&gt;
   /// &lt;div id="root"&gt;&lt;/div&gt;
   /// &lt;script src="/common/SimpleUI.mjs" type="module"&gt;&lt;/script&gt;
   /// &lt;/html&gt;
   /// ```
   template <typename Contract, bool IncludeRoot>
   std::optional<RpcReplyData> serveSimpleUI(const RpcRequestData& request)
   {
      if (auto result = serveActionTemplates<Contract>(request))
         return result;
      if (auto result = servePackAction<Contract>(request))
         return result;
      if (IncludeRoot && request.method == "GET" && request.target == "/")
      {
         return RpcReplyData{
             .contentType = "text/html",
             .body        = {simpleUIMainPage, simpleUIMainPage + strlen(simpleUIMainPage)},
         };
      }
      return std::nullopt;
   }
}  // namespace psibase
