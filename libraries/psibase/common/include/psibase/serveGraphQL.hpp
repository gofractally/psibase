#pragma once

#include <psibase/contractEntry.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psio/graphql_connection.hpp>

namespace psibase
{
   struct GraphQLQuery
   {
      std::string query;
   };
   PSIO_REFLECT(GraphQLQuery, query);

   /// Handle `/graphql` request
   ///
   /// This handles graphql requests, including fetching the schema.
   ///
   /// * `GET /graphql`: Returns the schema.
   /// * `GET /graphql?query=...`: Run query in URL and return JSON result.
   /// * `POST /graphql?query=...`: Run query in URL and return JSON result.
   /// * `POST /graphql` with `Content-Type = application/graphql`: Run query that's in body and return JSON result.
   /// * `POST /graphql` with `Content-Type = application/json`: Body contains a JSON object of the form `{"query"="..."}`. Run query and return JSON result.
   ///
   /// `getRoot` should return a reflected object which becomes the query root.
   /// Reflection on that object exposes both fields and **const** methods to be queried.
   /// Fields may be any reflected struct. Const methods may return any reflected struct.
   /// They should return objects by value.
   template <typename F>
   std::optional<RpcReplyData> serveGraphQL(const RpcRequestData& request, F getRoot)
   {
      auto doit = [&](std::string_view query, std::string_view variables)
      {
         auto result = psio::gql_query(getRoot(), query, {});
         return psibase::RpcReplyData{
             .contentType = "application/json",
             .body        = {result.data(), result.data() + result.size()},  // TODO: avoid copy
         };
      };

      auto target = ((std::string_view)request.target).substr(0, request.target.find('?'));
      if (target != "/graphql")
         return std::nullopt;

      if (auto pos = request.target.find("?query="); pos < request.target.size())
         return doit(request.target.substr(pos + 7), {});
      else if (request.method == "GET")
      {
         auto result = psio::get_gql_schema<std::remove_cvref_t<decltype(getRoot())>>();
         return psibase::RpcReplyData{
             .contentType = "text",                                          // TODO
             .body        = {result.data(), result.data() + result.size()},  // TODO: avoid copy
         };
      }
      else if (request.method == "POST")
      {
         if (request.contentType == "application/graphql")
         {
            return doit({request.body.data(), request.body.size()}, {});
         }
         else if (request.contentType == "application/json")
         {
            auto q =
                psio::convert_from_json<GraphQLQuery>({request.body.data(), request.body.size()});
            return doit(q.query, {});
         }
      }

      return std::nullopt;
   }
}  // namespace psibase
