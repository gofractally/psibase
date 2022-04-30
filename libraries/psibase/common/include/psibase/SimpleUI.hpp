#pragma once

#include <psibase/actionJsonTemplate.hpp>
#include <psibase/contract_entry.hpp>
#include <psibase/fracpackActionFromJson.hpp>

namespace psibase
{
   constexpr const char simpleUIMainPage[] =
       R"(<html><div id="root"></div><script src="/common/SimpleUI.mjs" type="module"></script></html>)";

   template <typename Derived>
   struct SimpleUI
   {
      std::optional<rpc_reply_data> serveSys(rpc_request_data request) const
      {
         if (request.method == "GET")
         {
            if (request.target == "/")
            {
               return rpc_reply_data{
                   .contentType = "text/html",
                   .reply       = {std::begin(simpleUIMainPage), std::end(simpleUIMainPage)},
               };
            }
            if (request.target == "/action_templates")
            {
               return rpc_reply_data{
                   .contentType = "application/json",
                   .reply       = generateActionJsonTemplate<Derived>(),
               };
            }
         }
         if (request.method == "POST")
         {
            if (request.target.starts_with("/pack_action/"))
            {
               if (auto result = fracpackActionFromJson<Derived>(
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
      }
   };
}  // namespace psibase
