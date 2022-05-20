#pragma once

#include <psibase/actionJsonTemplate.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/fracpackActionFromJson.hpp>

namespace psibase
{
   constexpr const char simpleUIMainPage[] =
       R"(<html><div id="root"></div><script src="/common/SimpleUI.mjs" type="module"></script></html>)";

   template <typename T, bool IncludeRoot>
   std::optional<RpcReplyData> simpleUI(RpcRequestData& request)
   {
      if (request.method == "GET")
      {
         if (IncludeRoot && request.target == "/")
         {
            return RpcReplyData{
                .contentType = "text/html",
                .body        = {simpleUIMainPage, simpleUIMainPage + strlen(simpleUIMainPage)},
            };
         }
         if (request.target == "/action_templates")
         {
            return RpcReplyData{
                .contentType = "application/json",
                .body        = generateActionJsonTemplate<T>(),
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
               return RpcReplyData{
                   .contentType = "application/octet-stream",
                   .body        = std::move(*result),
               };
            }
         }
      }
      return std::nullopt;
   }  // simpleUI
}  // namespace psibase
