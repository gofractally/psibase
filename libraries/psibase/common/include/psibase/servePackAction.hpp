#pragma once

#include <psibase/check.hpp>
#include <psio/json.hpp>
#include <psio/pssz.hpp>
#include <psio/reflect.hpp>

namespace psibase
{
   /// Packs (PSSZ) the arguments of the action `name` of `T` from their
   /// I-JSON text: an object keyed by parameter name, or the positional
   /// array. An argument that is not optional must be present; a member
   /// that names no parameter is skipped. Aborts with the action's name
   /// and the reader's message when `json` is not such a text. Returns
   /// nothing when `T` has no action `name`.
   template <typename T>
   std::optional<std::vector<char>> packActionFromJson(std::string_view name, std::string_view json)
   {
      using reflect = psio::reflect<T>;
      std::optional<std::vector<char>> result;
      reflect::for_each_method(
          [&](auto index, std::string_view methodName)
          {
             if (methodName == name)
             {
                constexpr std::size_t                          I = decltype(index)::value;
                typename reflect::template method_arg_tuple<I> params{};
                if (auto status = psio::decode_json_checked(
                        psio::ijson{}, std::span<const char>{json.data(), json.size()}, params);
                    !status.ok())
                   abortMessage("action '" + std::string(name) +
                                "': " + std::string(status.error().what));
                result = psio::to_pssz(params);
             }
          });
      return result;
   }

   /// Handle `/pack_action/` request
   ///
   /// If `request` is a POST to `/pack_action/x`, where `x` is an action
   /// on `Service`, then this parses a JSON object containing the arguments
   /// to `x`, packs them (PSSZ), and returns the result as an
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
            if (auto result = packActionFromJson<Service>(  //
                    std::string_view{request.target}.substr(13),
                    std::string_view{request.body.data(), request.body.size()}))
            {
               return HttpReply{
                   .contentType = "application/octet-stream",
                   .body        = std::move(*result),
                   .headers     = allowCors(),
               };
            }
         }
      }
      return std::nullopt;
   }

}  // namespace psibase
