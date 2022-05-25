#pragma once

#include <psio/from_bin.hpp>
#include <psio/graphql.hpp>
#include <psio/to_bin.hpp>
#include <psio/to_hex.hpp>

namespace psio
{
   template <unsigned N>
   struct FixedString
   {
      char buf[N + 1]{};
      constexpr FixedString(char const* s)
      {
         for (unsigned i = 0; i < N; ++i)
            buf[i] = s[i];
      }
      const char* c_str() const { return buf; }
   };
   template <unsigned N>
   FixedString(char const (&)[N]) -> FixedString<N - 1>;

   struct PageInfo
   {
      bool        hasPreviousPage = false;
      bool        hasNextPage     = false;
      std::string startCursor;
      std::string endCursor;
   };
   PSIO_REFLECT(PageInfo, hasPreviousPage, hasNextPage, startCursor, endCursor)

   template <typename Node, FixedString EdgeName>
   struct Edge
   {
      Node        node;
      std::string cursor;
   };

   template <typename Node, FixedString EdgeName>
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

   template <typename Node, FixedString EdgeName>
   ReflectEdge get_reflect_impl(const Edge<Node, EdgeName>&);

   template <typename Node, FixedString ConnectionName, FixedString EdgeName>
   struct Connection
   {
      using NodeType = Node;
      using Edge     = psio::Edge<Node, EdgeName>;

      std::vector<Edge> edges;
      PageInfo          pageInfo;
   };

   template <typename Node, FixedString ConnectionName, FixedString EdgeName>
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

   template <typename Node, FixedString ConnectionName, FixedString EdgeName>
   ReflectConnection get_reflect_impl(const Connection<Node, ConnectionName, EdgeName>&);

   // To enable cursors to function correctly, container must not have duplicate keys
   template <typename Connection,
             typename Key,
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
            return convert_from_bin<Key>(bytes);
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
         auto bin    = convert_to_bin(iterToKey(it));
         auto cursor = to_hex(bin);
         result.edges.push_back(typename Connection::Edge{iterToNode(it), std::move(cursor)});
      };

      if (last && !first)
      {
         result.pageInfo.hasNextPage = end != rangeEnd;
         while (it != end && (*last)-- > 0)
         {
            decrIter(end);
            add_edge(end);
         }
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
