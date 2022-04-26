#pragma once

#include <psibase/contract_entry.hpp>

namespace psibase
{
   constexpr const char simpleUIMainPage[] = R"(<html>Hello</html>)";

   template <typename Derived>
   struct SimpleUI
   {
      rpc_reply_data serveSys(rpc_request_data request)
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
         }
         abort_message_str("not found");
      }
   };
}  // namespace psibase
