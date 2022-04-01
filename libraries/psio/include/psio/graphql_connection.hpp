#pragma once

#include <psio/from_bin.hpp>
#include <psio/graphql.hpp>
#include <psio/to_bin.hpp>
#include <psio/to_hex.hpp>

namespace psio
{
   struct PageInfo
   {
      bool        hasPreviousPage = false;
      bool        hasNextPage     = false;
      std::string startCursor;
      std::string endCursor;
   };
   PSIO_REFLECT(PageInfo, hasPreviousPage, hasNextPage, startCursor, endCursor)

   template <typename Node>
   struct Edge
   {
      Node        node;
      std::string cursor;
   };
#define PSIO_REFLECT_GQL_EDGE(TYPE) PSIO_REFLECT(TYPE, node, cursor)

   template <typename Node>
   struct Connection
   {
      using node_type = Node;
      std::vector<Edge<Node>> edges;
      PageInfo                pageInfo;
   };

#define PSIO_REFLECT_GQL_CONNECTION(TYPE) PSIO_REFLECT(TYPE, edges, pageInfo)

   // To enable cursors to function correctly, container must not have duplicate keys
   template <typename Connection,
             typename Key,
             typename T,
             typename To_key,
             typename To_node,
             typename Lower_bound,
             typename Upper_bound>
   Connection make_connection(const std::optional<Key>&         gt,
                              const std::optional<Key>&         ge,
                              const std::optional<Key>&         lt,
                              const std::optional<Key>&         le,
                              std::optional<uint32_t>           first,
                              std::optional<uint32_t>           last,
                              const std::optional<std::string>& before,
                              const std::optional<std::string>& after,
                              const T&                          container,
                              To_key&&                          to_key,
                              To_node&&                         to_node,
                              Lower_bound&&                     lower_bound,
                              Upper_bound&&                     upper_bound)
   {
      auto compare_it = [&](const auto& a, const auto& b)
      {
         if (a == container.end())
            return false;
         if (b == container.end())
            return true;
         return to_key(*a) < to_key(*b);
      };
      auto key_from_hex = [&](const std::optional<std::string>& s) -> std::optional<Key>
      {
         if (!s || s->empty())
            return {};
         // TODO: prevent from_bin aborting
         std::vector<char> bytes;
         bytes.reserve(s->size() / 2);
         if (from_hex(*s, bytes))
            return from_bin<Key>(bytes);
         return {};
      };

      auto rangeBegin = container.begin();
      auto rangeEnd   = container.end();
      if (ge)
         rangeBegin = std::max(rangeBegin, lower_bound(container, *ge), compare_it);
      if (gt)
         rangeBegin = std::max(rangeBegin, upper_bound(container, *gt), compare_it);
      if (le)
         rangeEnd = std::min(rangeEnd, upper_bound(container, *le), compare_it);
      if (lt)
         rangeEnd = std::min(rangeEnd, lower_bound(container, *lt), compare_it);
      rangeEnd = std::max(rangeBegin, rangeEnd, compare_it);

      auto it  = rangeBegin;
      auto end = rangeEnd;
      if (auto key = key_from_hex(after))
         it = std::clamp(upper_bound(container, *key), rangeBegin, rangeEnd, compare_it);
      if (auto key = key_from_hex(before))
         end = std::clamp(lower_bound(container, *key), rangeBegin, rangeEnd, compare_it);
      end = std::max(it, end, compare_it);

      Connection result;
      auto       add_edge = [&](const auto& it)
      {
         auto bin    = to_bin(to_key(*it));
         auto cursor = to_hex(bin);
         result.edges.push_back(
             Edge<typename Connection::node_type>{to_node(*it), std::move(cursor)});
      };

      if (last && !first)
      {
         result.pageInfo.hasNextPage = end != rangeEnd;
         for (; it != end && (*last)-- > 0; --end)
            add_edge(std::prev(end));
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
   }
}  // namespace psio
