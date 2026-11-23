#pragma once

#include <psibase/Rpc.hpp>
#include <psio/json.hpp>
#include <psio/pssz.hpp>
#include <psio/reflect.hpp>

namespace psibase
{
   /// `{"<action>": <sample arguments>, ...}` for every action of `T`: the
   /// I-JSON of a value-initialized argument list (an object keyed by
   /// parameter name; the positional array when the reflection does not
   /// name the parameters; `null` when such a value has no text).
   template <typename T>
   std::vector<char> generateActionJsonTemplate()
   {
      using reflect = psio::reflect<T>;
      std::vector<char> json;
      json.push_back('{');
      bool needComma = false;
      reflect::for_each_method(
          [&](auto index, std::string_view name)
          {
             constexpr std::size_t I = decltype(index)::value;
             if (needComma)
                json.push_back(',');
             needComma = true;
             psio::to_ijson(name, json);
             json.push_back(':');
             typename reflect::template method_arg_tuple<I> sample{};
             if (!psio::encode_json_checked(psio::ijson{}, sample, json).ok())
             {
                constexpr std::string_view null = "null";
                json.insert(json.end(), null.begin(), null.end());
             }
          });
      json.push_back('}');
      return json;
   }

   /// Handle `/action_templates` request
   ///
   /// If `request` is a GET to `/action_templates`, then this returns a
   /// JSON object containing a field for each action in `Service`. The
   /// field names match the action names. The field values are objects
   /// with the action arguments, each containing sample data.
   ///
   /// If `request` doesn't match the above, then this returns `std::nullopt`.
   template <typename Service>
   std::optional<HttpReply> serveActionTemplates(const HttpRequest& request)
   {
      if (request.method == "GET" && request.target == "/action_templates")
      {
         return HttpReply{
             .contentType = "application/json",
             .body        = generateActionJsonTemplate<Service>(),
             .headers     = allowCors(),
         };
      }
      return std::nullopt;
   }

}  // namespace psibase
