#pragma once

#include <psibase/MethodArgs.hpp>
#include <psibase/Rpc.hpp>
#include <psio/reflect.hpp>
#include <psio1/fracpack.hpp>
#include <psio1/reflect.hpp>
#include <psio1/to_json.hpp>

namespace psibase
{
   template <typename S>
   void generateActionJsonTemplate(std::tuple<>*,
                                   bool                              needComma,
                                   std::span<const std::string_view> names,
                                   S&                                stream)
   {
   }

   template <typename T, typename... Ts, typename S>
   void generateActionJsonTemplate(std::tuple<T, Ts...>*,
                                   bool                              needComma,
                                   std::span<const std::string_view> names,
                                   S&                                stream)
   {
      if (needComma)
         stream.write(',');
      if (!names.empty())
         to_json(names.front(), stream);
      else
         to_json("error_missing_arg_name", stream);
      stream.write(':');
      T empty = {};
      to_json(empty, stream);
      generateActionJsonTemplate((std::tuple<Ts...>*)nullptr, true,
                                 names.empty() ? names : names.subspan(1), stream);
   }

   template <typename T>
   std::vector<char> generateActionJsonTemplate()
   {
      using reflect = psio::reflect<T>;
      std::vector<char>    json;
      psio1::vector_stream s{json};
      s.write('{');
      bool needComma = false;
      reflect::for_each_method(
          [&](auto index, std::string_view name)
          {
             constexpr std::size_t I = decltype(index)::value;
             if (needComma)
                s.write(',');
             needComma = true;
             to_json(name, s);
             s.write(':');
             s.write('{');
             generateActionJsonTemplate(
                 (MethodArgs<typename reflect::template method_type<I>>*)nullptr, false,
                 reflect::template method_param_names<I>, s);
             s.write('}');
          });
      s.write('}');
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
