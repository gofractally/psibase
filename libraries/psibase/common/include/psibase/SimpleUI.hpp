#pragma once

#include <psibase/actionJsonTemplate.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/fracpackActionFromJson.hpp>

namespace psibase
{
   constexpr const char simpleUIMainPage[] =
       R"(<html><div id="root"></div><script src="/common/SimpleUI.mjs" type="module"></script></html>)";

   template <typename T, bool IncludeRoot>
   std::optional<rpc_reply_data> serveSimpleUI(rpc_request_data& request)
   {
      if (request.method == "GET")
      {
         if (IncludeRoot && request.target == "/")
         {
            return rpc_reply_data{
                .contentType = "text/html",
                .reply       = {simpleUIMainPage, simpleUIMainPage + strlen(simpleUIMainPage)},
            };
         }
         if (request.target == "/action_templates")
         {
            return rpc_reply_data{
                .contentType = "application/json",
                .reply       = generateActionJsonTemplate<T>(),
            };
         }
      }
      if (request.method == "POST")
      {
         if (request.target.starts_with("/pack_action/"))
         {
            if (auto result = fracpackActionFromJson<T>(  //
                    std::string_view{request.target}.substr(13), request.body))
            {
               return rpc_reply_data{
                   .contentType = "application/octet-stream",
                   .reply       = std::move(*result),
               };
            }
         }
      }
      return std::nullopt;
   }  // serveSimpleUI

   template <typename Derived, bool IncludeRoot = true>
   struct SimpleUI
   {
      std::optional<rpc_reply_data> serveSys(rpc_request_data request) const
      {
         return serveSimpleUI<Derived, IncludeRoot>(request);
      }
   };
}  // namespace psibase
