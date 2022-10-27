#pragma once

#include <psibase/check.hpp>
#include <psio/fracpack.hpp>
#include <psio/from_json.hpp>
#include <psio/to_bin.hpp>

namespace psibase
{
   template <int i, typename... Ts>
   bool fracpackActionFromJsonImpl(psio::json_token_stream& stream,
                                   std::string_view         name,
                                   const psio::meta&        meta,
                                   std::tuple<Ts...>&       params)
   {
      if constexpr (i < std::tuple_size<std::tuple<Ts...>>())
      {
         if (i < meta.param_names.size() && name == meta.param_names.begin()[i])
         {
            from_json(std::get<i>(params), stream);
            return true;
         }
         else
         {
            return fracpackActionFromJsonImpl<i + 1>(stream, name, meta, params);
         }
      }
      return false;
   }

   // TODO: detect missing non-optional args
   template <typename T>
   std::optional<std::vector<char>> fracpackActionFromJson(std::string_view name,
                                                           std::string_view json)
   {
      std::optional<std::vector<char>> result;
      psio::reflect<T>::for_each(
          [&](const psio::meta& meta, auto member)
          {
             using MemPtr = decltype(member(std::declval<T*>()));
             if constexpr (std::is_member_function_pointer_v<MemPtr>)
             {
                if (meta.name == name)
                {
                   using param_tuple = decltype(psio::tuple_remove_view(
                       psio::args_as_tuple(std::declval<MemPtr>())));
                   param_tuple       params{};
                   std::vector<char> j{json.begin(), json.end()};
                   j.push_back(0);
                   psio::json_token_stream stream{j.data()};
                   from_json_object(  //
                       stream,
                       [&](std::string_view k)
                       {
                          if (!fracpackActionFromJsonImpl<0>(stream, k, meta, params))
                             abortMessage("action '" + std::string(name) +
                                          "' does not have argument '" + std::string(k) + "'");
                       });
                   result = psio::convert_to_frac(params);
                }
             }
          });
      return result;
   }

   /// Handle `/pack_action/` request
   ///
   /// If `request` is a POST to `/pack_action/x`, where `x` is an action
   /// on `Service`, then this parses a JSON object containing the arguments
   /// to `x`, packs them using fracpack, and returns the result as an
   /// `application/octet-stream`.
   ///
   /// If `request` doesn't match the above, or the action name is not found,
   /// then this returns `std::nullopt`.
   template <typename Service>
   std::optional<HttpReply> servePackAction(const HttpRequest& request)
   {
      if (request.method == "POST")
      {
         if (request.target.starts_with("/pack_action/"))
         {
            if (auto result = fracpackActionFromJson<Service>(  //
                    std::string_view{request.target}.substr(13),
                    std::string_view{request.body.data(), request.body.size()}))
            {
               return HttpReply{
                   .contentType = "application/octet-stream",
                   .body        = std::move(*result),
               };
            }
         }
      }
      return std::nullopt;
   }

}  // namespace psibase
