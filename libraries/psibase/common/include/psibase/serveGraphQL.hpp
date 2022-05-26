#pragma once

#include <psibase/Table.hpp>
#include <psibase/contractEntry.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psio/graphql.hpp>
#include <psio/to_hex.hpp>

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
         return RpcReplyData{
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
         return RpcReplyData{
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
   }  // serveGraphQL

   struct PageInfo
   {
      bool        hasPreviousPage = false;
      bool        hasNextPage     = false;
      std::string startCursor;
      std::string endCursor;
   };
   PSIO_REFLECT(PageInfo, hasPreviousPage, hasNextPage, startCursor, endCursor)

   template <typename Node, psio::FixedString EdgeName>
   struct Edge
   {
      Node        node;
      std::string cursor;
   };

   template <typename Node, psio::FixedString EdgeName>
   constexpr const char* get_type_name(const Edge<Node, EdgeName>*)
   {
      return EdgeName.c_str();
   }

   struct ReflectEdge
   {
      static constexpr bool is_defined = true;
      static constexpr bool is_struct  = true;
      template <typename L>
      constexpr inline static void for_each(L&& lambda)
      {
         {
            auto off = ~uint64_t(0);
            (void)lambda(psio::meta{.name = "node", .offset = off, .number = 0 + 1},
                         [](auto p) -> decltype(&psio::remove_cvref_t<decltype(*p)>::node)
                         { return &psio::remove_cvref_t<decltype(*p)>::node; });
         }
         {
            auto off = ~uint64_t(0);
            (void)lambda(psio::meta{.name = "cursor", .offset = off, .number = 1 + 1},
                         [](auto p) -> decltype(&psio::remove_cvref_t<decltype(*p)>::cursor)
                         { return &psio::remove_cvref_t<decltype(*p)>::cursor; });
         }
      }
      template <typename L>
      inline static bool get_by_name(uint64_t n, L&& lambda)
      {
         switch (n)
         {
            case psio::hash_name("node"):
               (void)lambda(psio::meta{.name = "node", .number = 0 + 1},
                            [](auto p) -> decltype(&psio::remove_cvref_t<decltype(*p)>::node)
                            { return &psio::remove_cvref_t<decltype(*p)>::node; });
               return true;
            case psio::hash_name("cursor"):
               (void)lambda(psio::meta{.name = "cursor", .number = 1 + 1},
                            [](auto p) -> decltype(&psio::remove_cvref_t<decltype(*p)>::cursor)
                            { return &psio::remove_cvref_t<decltype(*p)>::cursor; });
               return true;
         }
         return false;
      }
   };  // ReflectEdge

   template <typename Node, psio::FixedString EdgeName>
   ReflectEdge get_reflect_impl(const Edge<Node, EdgeName>&);

   template <typename Node, psio::FixedString ConnectionName, psio::FixedString EdgeName>
   struct Connection
   {
      using NodeType = Node;
      using Edge     = Edge<Node, EdgeName>;

      std::vector<Edge> edges;
      PageInfo          pageInfo;
   };

   template <typename Node, psio::FixedString ConnectionName, psio::FixedString EdgeName>
   constexpr const char* get_type_name(const Connection<Node, ConnectionName, EdgeName>*)
   {
      return ConnectionName.c_str();
   }

   struct ReflectConnection
   {
      static constexpr bool is_defined = true;
      static constexpr bool is_struct  = true;
      template <typename L>
      constexpr inline static void for_each(L&& lambda)
      {
         {
            auto off = ~uint64_t(0);
            (void)lambda(psio::meta{.name = "edges", .offset = off, .number = 0 + 1},
                         [](auto p) -> decltype(&psio::remove_cvref_t<decltype(*p)>::edges)
                         { return &psio::remove_cvref_t<decltype(*p)>::edges; });
         }
         {
            auto off = ~uint64_t(0);
            (void)lambda(psio::meta{.name = "pageInfo", .offset = off, .number = 1 + 1},
                         [](auto p) -> decltype(&psio::remove_cvref_t<decltype(*p)>::pageInfo)
                         { return &psio::remove_cvref_t<decltype(*p)>::pageInfo; });
         }
      }
      template <typename L>
      inline static bool get_by_name(uint64_t n, L&& lambda)
      {
         switch (n)
         {
            case psio::hash_name("edges"):
               (void)lambda(psio::meta{.name = "edges", .number = 0 + 1},
                            [](auto p) -> decltype(&psio::remove_cvref_t<decltype(*p)>::edges)
                            { return &psio::remove_cvref_t<decltype(*p)>::edges; });
               return true;
            case psio::hash_name("pageInfo"):
               (void)lambda(psio::meta{.name = "pageInfo", .number = 1 + 1},
                            [](auto p) -> decltype(&psio::remove_cvref_t<decltype(*p)>::pageInfo)
                            { return &psio::remove_cvref_t<decltype(*p)>::pageInfo; });
               return true;
         }
         return false;
      }
   };  // ReflectConnection

   template <typename Node, psio::FixedString ConnectionName, psio::FixedString EdgeName>
   ReflectConnection get_reflect_impl(const Connection<Node, ConnectionName, EdgeName>&);

   /// GraphQL Pagination through TableIndex
   ///
   /// You rarely need to call this directly; see [the example](#makeconnection-example).
   ///
   /// Template arguments:
   /// - `Connection`: [Connection]
   /// - `T`: Type stored in index
   /// - `Key`: Key in index
   ///
   /// Arguments:
   /// - `index`: `TableIndex` to paginate through
   /// - `gt`: Restrict range to keys greater than this
   /// - `ge`: Restrict range to keys greater than or equal to this
   /// - `lt`: Restrict range to keys less than to this
   /// - `le`: Restrict range to keys less than or equal to this
   /// - `first`: Stop after including this many items at the beginning of the range
   /// - `last`: Stop after including this many items at the end of the range
   /// - `before`: Opaque cursor value. Resume paging; include keys before this point
   /// - `after`: Opaque cursor value. Resume paging; include keys after this point
   ///
   /// By default, `makeConnection` pages through the entire index's range.
   /// `gt`, `ge`, `lt`, and `le` restrict the range. They can be used in any
   /// combination (set intersection).
   ///
   /// `first`, `last`, `before`, `after`, [Connection], and
   /// [Edge] match the GraphQL Cursor Connections Specification
   /// (aka GraphQL Pagination). `first` and `after` page through the
   /// range defined above in the forward direction. `last` and `before`
   /// page through the range defined above in the reverse direction.
   /// Combining `first` with `last` isn't recommended, but matches the
   /// behavior in the specification.
   ///
   /// #### makeConnection example
   ///
   ///
   template <typename Connection, typename T, typename Key>
   Connection makeConnection(const TableIndex<T, Key>&         index,
                             const std::optional<Key>&         gt,
                             const std::optional<Key>&         ge,
                             const std::optional<Key>&         lt,
                             const std::optional<Key>&         le,
                             std::optional<uint32_t>           first,
                             std::optional<uint32_t>           last,
                             const std::optional<std::string>& before,
                             const std::optional<std::string>& after)
   {
      auto keyFromHex = [&](const std::optional<std::string>& s) -> std::vector<char>
      {
         std::vector<char> bytes;
         if (!s || s->empty())
            return bytes;
         bytes.reserve(s->size() / 2);
         if (!psio::from_hex(*s, bytes))
            bytes.clear();
         return bytes;
      };

      auto rangeBegin = index.begin();
      auto rangeEnd   = index.end();
      if (ge)
         rangeBegin = std::max(rangeBegin, index.lower_bound(*ge));
      if (gt)
         rangeBegin = std::max(rangeBegin, index.upper_bound(*gt));
      if (le)
         rangeEnd = std::min(rangeEnd, index.upper_bound(*le));
      if (lt)
         rangeEnd = std::min(rangeEnd, index.lower_bound(*lt));
      rangeEnd = std::max(rangeBegin, rangeEnd);

      auto it  = rangeBegin;
      auto end = rangeEnd;
      if (auto key = keyFromHex(after); !key.empty())
         it = std::clamp(index.upper_bound(KeyView{key}), rangeBegin, rangeEnd);
      if (auto key = keyFromHex(before); !key.empty())
         end = std::clamp(index.lower_bound(KeyView{key}), rangeBegin, rangeEnd);
      end = std::max(it, end);

      Connection result;
      auto       add_edge = [&](const auto& it)
      {
         auto cursor = psio::to_hex(it.keyWithoutPrefix());
         result.edges.push_back(typename Connection::Edge{*it, std::move(cursor)});
      };

      if (last && !first)
      {
         result.pageInfo.hasNextPage = end != rangeEnd;
         while (it != end && (*last)-- > 0)
            add_edge(--end);
         result.pageInfo.hasPreviousPage = end != rangeBegin;
         std::reverse(result.edges.begin(), result.edges.end());
      }
      else
      {
         result.pageInfo.hasPreviousPage = it != rangeBegin;
         for (; it != end && (!first || (*first)-- > 0); ++it)
            add_edge(it);
         result.pageInfo.hasNextPage = it != rangeEnd;
         if (last && *last < result.edges.size())
         {
            result.pageInfo.hasPreviousPage = true;
            result.edges.erase(result.edges.begin(),
                               result.edges.begin() + (result.edges.size() - *last));
         }
      }

      if (!result.edges.empty())
      {
         result.pageInfo.startCursor = result.edges.front().cursor;
         result.pageInfo.endCursor   = result.edges.back().cursor;
      }
      return result;
   }  // makeConnection

   template <typename T, typename K>
   constexpr std::optional<std::array<const char*, 8>> gql_callable_args(TableIndex<T, K>*)
   {
      return std::array{"gt", "ge", "lt", "le", "first", "last", "before", "after"};
   }

   template <typename T, typename K>
   constexpr auto gql_callable_fn(const TableIndex<T, K>*)
   {
      using Connection = Connection<  //
          T, psio::reflect<T>::name + "Connection", psio::reflect<T>::name + "Edge">;
      return makeConnection<Connection, T, K>;
   }  // gql_callable_fn

}  // namespace psibase
