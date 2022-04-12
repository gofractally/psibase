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
      using NodeType = Node;
      std::vector<Edge<Node>> edges;
      PageInfo                pageInfo;
   };

#define PSIO_REFLECT_GQL_CONNECTION(TYPE) PSIO_REFLECT(TYPE, edges, pageInfo)

   // To enable cursors to function correctly, container must not have duplicate keys
   template <typename Connection,
             typename Key,
             typename T,
             typename Iter,
             typename Incr_Iter,
             typename Decr_Iter,
             typename Iter_to_key,
             typename Iter_to_node,
             typename Lower_bound,
             typename Upper_bound>
   Connection makeConnection(const std::optional<Key>&         gt,
                             const std::optional<Key>&         ge,
                             const std::optional<Key>&         lt,
                             const std::optional<Key>&         le,
                             std::optional<uint32_t>           first,
                             std::optional<uint32_t>           last,
                             const std::optional<std::string>& before,
                             const std::optional<std::string>& after,
                             const Iter&                       containerBegin,
                             const Iter&                       containerEnd,
                             Incr_Iter                         incrIter,
                             Decr_Iter                         decrIter,
                             Iter_to_key                       iterToKey,
                             Iter_to_node                      iterToNode,
                             Lower_bound                       lowerBound,
                             Upper_bound                       upperBound)
   {
      auto compare_it = [&](const auto& a, const auto& b)
      {
         if (a == containerEnd)
            return false;
         if (b == containerEnd)
            return true;
         return iterToKey(a) < iterToKey(b);
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

      auto rangeBegin = containerBegin;
      auto rangeEnd   = containerEnd;
      if (ge)
         rangeBegin = std::max(rangeBegin, lowerBound(*ge), compare_it);
      if (gt)
         rangeBegin = std::max(rangeBegin, upperBound(*gt), compare_it);
      if (le)
         rangeEnd = std::min(rangeEnd, upperBound(*le), compare_it);
      if (lt)
         rangeEnd = std::min(rangeEnd, lowerBound(*lt), compare_it);
      rangeEnd = std::max(rangeBegin, rangeEnd, compare_it);

      auto it  = rangeBegin;
      auto end = rangeEnd;
      if (auto key = key_from_hex(after))
         it = std::clamp(upperBound(*key), rangeBegin, rangeEnd, compare_it);
      if (auto key = key_from_hex(before))
         end = std::clamp(lowerBound(*key), rangeBegin, rangeEnd, compare_it);
      end = std::max(it, end, compare_it);

      Connection result;
      auto       add_edge = [&](const auto& it)
      {
         auto bin    = to_bin(iterToKey(it));
         auto cursor = to_hex(bin);
         result.edges.push_back(
             Edge<typename Connection::NodeType>{iterToNode(it), std::move(cursor)});
      };

      if (last && !first)
      {
         result.pageInfo.hasNextPage = end != rangeEnd;
         for (; it != end && (*last)-- > 0; decrIter(end))
            add_edge(std::prev(end));
         result.pageInfo.hasPreviousPage = end != rangeBegin;
         std::reverse(result.edges.begin(), result.edges.end());
      }
      else
      {
         result.pageInfo.hasPreviousPage = it != rangeBegin;
         for (; it != end && (!first || (*first)-- > 0); incrIter(it))
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
