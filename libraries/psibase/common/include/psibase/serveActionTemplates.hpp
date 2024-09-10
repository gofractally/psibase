#pragma once

#include <psibase/Rpc.hpp>
#include <psio/fracpack.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   template <typename S>
   void generateActionJsonTemplate(std::tuple<>*,
                                   bool               needComma,
                                   const char* const* begin,
                                   const char* const* end,
                                   S&                 stream)
   {
   }

   template <typename T, typename... Ts, typename S>
   void generateActionJsonTemplate(std::tuple<T, Ts...>*,
                                   bool               needComma,
                                   const char* const* begin,
                                   const char* const* end,
                                   S&                 stream)
   {
      if (needComma)
         stream.write(',');
      if (begin != end)
         to_json(*begin, stream);
      else
         to_json("error_missing_arg_name", stream);
      stream.write(':');
      T empty = {};
      to_json(empty, stream);
      generateActionJsonTemplate((std::tuple<Ts...>*)nullptr, true,
                                 begin != end ? begin + 1 : begin, end, stream);
   }

   template <typename T>
   std::vector<char> generateActionJsonTemplate()
   {
      std::vector<char>   json;
      psio::vector_stream s{json};
      s.write('{');
      bool        needComma = false;
      std::size_t i         = 0;
      psio::for_each_member_type(
          (typename psio::reflect<T>::member_functions*)nullptr,
          [&](auto member)
          {
             using MemPtr = decltype(member);
             auto names   = psio::reflect<T>::member_function_names[i];
             if (needComma)
                s.write(',');
             needComma = true;
             to_json(*names.begin(), s);
             s.write(':');
             s.write('{');
             generateActionJsonTemplate(
                 (typename psio::make_param_value_tuple<MemPtr>::type*)nullptr, false,
                 names.begin() + 1, names.end(), s);
             s.write('}');
             ++i;
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
         };
      }
      return std::nullopt;
   }

}  // namespace psibase
