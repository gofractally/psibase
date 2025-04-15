#pragma once

#include <psibase/serveActionTemplates.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/serviceEntry.hpp>

namespace psibase
{
   constexpr const char simpleUIMainPage[] =
       R"(<html><div id="root" class="ui container"></div><script src="/common/SimpleUI.mjs" type="module"></script></html>)";

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
   /// &lt;div id="root" class="ui container"&gt;&lt;/div&gt;
   /// &lt;script src="/common/SimpleUI.mjs" type="module"&gt;&lt;/script&gt;
   /// &lt;/html&gt;
   /// ```
   template <typename Service, bool IncludeRoot>
   std::optional<HttpReply> serveSimpleUI(const HttpRequest& request)
   {
      if (auto result = serveActionTemplates<Service>(request))
         return result;
      if (auto result = servePackAction<Service>(request))
         return result;
      if (IncludeRoot && request.method == "GET" && request.target == "/")
      {
         return HttpReply{
             .contentType = "text/html",
             .body        = {simpleUIMainPage, simpleUIMainPage + strlen(simpleUIMainPage)},
         };
      }
      return std::nullopt;
   }
}  // namespace psibase
