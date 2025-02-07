#pragma once

#include <psibase/Table.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/graphql.hpp>
#include <psio/to_hex.hpp>

namespace psibase
{
   struct GraphQLQuery
   {
      std::string query;
      PSIO_REFLECT(GraphQLQuery, query);
   };

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
   /// `queryRoot` should be a reflected object; this shows up in GraphQL as the root
   /// `Query` type. GraphQL exposes both fields and **const** methods. Fields may be
   /// any reflected struct. Const methods may return any reflected struct. They should
   /// return objects by value.
   ///
   /// See [makeConnection example](#makeconnection-example).
   template <typename QueryRoot>
   std::optional<HttpReply> serveGraphQL(const HttpRequest& request, const QueryRoot& queryRoot)
   {
      auto doit = [&](std::string_view query, std::string_view variables)
      {
         auto result = psio::gql_query(queryRoot, query, {});
         return HttpReply{
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
         auto result = psio::get_gql_schema<std::remove_cvref_t<QueryRoot>>();
         return HttpReply{
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

   /// GraphQL support for paging
   ///
   /// This lets the query clients know when more data is available and
   /// what cursor values can be used to fetch that data.
   struct PageInfo
   {
      bool        hasPreviousPage = false;
      bool        hasNextPage     = false;
      std::string startCursor;
      std::string endCursor;
      PSIO_REFLECT(PageInfo, hasPreviousPage, hasNextPage, startCursor, endCursor)
   };

   /// GraphQL support for paging
   ///
   /// `node` contains the row data. `cursor` identifies where in the
   /// table the node is located.
   template <typename Node, psio::FixedString EdgeName>
   struct Edge
   {
      Node        node;
      std::string cursor;
      PSIO_REFLECT(Edge, node, cursor)
   };

   template <typename Node, psio::FixedString EdgeName>
   constexpr const char* get_type_name(const Edge<Node, EdgeName>*)
   {
      return EdgeName.c_str();
   }

   /// GraphQL support for paging
   ///
   /// `edges` contain the matching rows. `pageInfo` gives clients information
   /// needed to resume paging.
   template <typename Node, psio::FixedString ConnectionName, psio::FixedString EdgeName>
   struct Connection
   {
      using NodeType = Node;
      using Edge     = psibase::Edge<Node, EdgeName>;

      std::vector<Edge> edges;
      PageInfo          pageInfo;
      PSIO_REFLECT(Connection, edges, pageInfo)
   };

   template <typename Node, psio::FixedString ConnectionName, psio::FixedString EdgeName>
   constexpr const char* get_type_name(const Connection<Node, ConnectionName, EdgeName>*)
   {
      return ConnectionName.c_str();
   }

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
   /// - `index`: [TableIndex] to paginate through
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
   /// `first`, `last`, `before`, `after`, [PageInfo], [Connection], and
   /// [Edge] match the GraphQL Cursor Connections Specification
   /// (aka GraphQL Pagination). `first` and `after` page through the
   /// range defined above in the forward direction. `last` and `before`
   /// page through the range defined above in the reverse direction.
   /// Combining `first` with `last` isn't recommended, but matches the
   /// behavior in the specification.
   ///
   /// #### makeConnection example
   ///
   /// This demonstrates exposing a table's contents via GraphQL. This example
   /// doesn't include a way to fill the table; that's left as an exercise to the
   /// reader. Hint: service-based RPC and GraphQL only support read-only
   /// operations; you must use actions to write to a table.
   ///
   /// ```c++
   /// #include <psibase/Service.hpp>
   /// #include <psibase/dispatch.hpp>
   /// #include <psibase/serveGraphQL.hpp>
   /// #include <psibase/serveSimpleUI.hpp>
   ///
   /// struct MyType
   /// {
   ///    uint32_t    primaryKey;
   ///    std::string secondaryKey;
   ///    std::string moreData;
   ///
   ///    std::string someFn(std::string arg1, std::string arg2) const
   ///    {
   ///       return arg1 + secondaryKey + arg2 + moreData;
   ///    }
   /// };
   /// PSIO_REFLECT(MyType,
   ///    primaryKey, secondaryKey, moreData,
   ///    method(someFn, arg1, arg2))
   ///
   /// using MyTable  = psibase::Table<
   ///    MyType, &MyType::primaryKey, &MyType::secondaryKey>;
   /// using MyTables = psibase::ServiceTables<MyTable>;
   ///
   /// struct Query
   /// {
   ///    psibase::AccountNumber service;
   ///
   ///    auto rowsByPrimary() const {
   ///       return MyTables{service}.open<MyTable>().getIndex<0>();
   ///    }
   ///    auto rowsBySecondary() const {
   ///       return MyTables{service}.open<MyTable>().getIndex<1>();
   ///    }
   /// };
   /// PSIO_REFLECT(Query, method(rowsByPrimary), method(rowsBySecondary))
   ///
   /// struct ExampleService : psibase::Service<ExampleService>
   /// {
   ///    std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request)
   ///    {
   ///       if (auto result = psibase::serveSimpleUI<ExampleService, true>(request))
   ///          return result;
   ///       if (auto result = psibase::serveGraphQL(request, Query{getReceiver()}))
   ///          return result;
   ///       return std::nullopt;
   ///    }
   /// };
   /// PSIO_REFLECT(ExampleService, method(serveSys, request))
   ///
   /// PSIBASE_DISPATCH(ExampleService)
   /// ```
   ///
   /// This example doesn't call `makeConnection` directly; it's automatic.
   /// If a member function on a query object:
   ///
   /// - is `const`, and
   /// - is reflected, and
   /// - has no arguments, and
   /// - returns a [TableIndex]
   ///
   /// then the system exposes that function to GraphQL as a function which
   /// takes `gt`, `ge`, `lt`, `le`, `first`, `last`, `before`, and `after`.
   /// The system calls `makeConnection` automatically.
   ///
   /// [serveGraphQL] generates this GraphQL schema and processes queries which
   /// conform to it:
   ///
   /// ```
   /// type MyType {
   ///     primaryKey: Float!
   ///     secondaryKey: String!
   ///     moreData: String!
   ///     someFn(arg1: String! arg2: String!): String!
   /// }
   /// type PageInfo {
   ///     hasPreviousPage: Boolean!
   ///     hasNextPage: Boolean!
   ///     startCursor: String!
   ///     endCursor: String!
   /// }
   /// type MyTypeEdge {
   ///     node: MyType!
   ///     cursor: String!
   /// }
   /// type MyTypeConnection {
   ///     edges: [MyTypeEdge!]!
   ///     pageInfo: PageInfo!
   /// }
   /// type Query {
   ///     rowsByPrimary(
   ///          gt: Float ge: Float lt: Float le: Float
   ///          first: Float last: Float
   ///          before: String after: String): MyTypeConnection!
   ///     rowsBySecondary(
   ///          gt: String ge: String lt: String le: String
   ///          first: Float last: Float
   ///          before: String after: String): MyTypeConnection!
   /// }
   /// ```
   ///
   /// Things of note:
   /// - `rowsByPrimary` and `rowsBySecondary` automatically have `makeConnection`'s arguments.
   /// - `MyTypeEdge` and `MyTypeConnection` are automatically generated from `MyType`.
   /// - Returned rows (`MyType`) include MyType's fields and the `someFn` method. Only `const` methods are exposed.
   /// - [serveGraphQL] automatically chooses GraphQL types which cover the range of numeric types. When no suitable match is found (e.g. no GraphQL type covers the range of `int64_t`), it falls back to `String`.
   template <typename Connection, typename T, typename Key, typename Proj = std::identity>
   Connection makeConnection(const TableIndex<T, Key>&         index,
                             const std::optional<Key>&         gt,
                             const std::optional<Key>&         ge,
                             const std::optional<Key>&         lt,
                             const std::optional<Key>&         le,
                             std::optional<uint32_t>           first,
                             std::optional<uint32_t>           last,
                             const std::optional<std::string>& before,
                             const std::optional<std::string>& after,
                             Proj&&                            proj = {})
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
         result.edges.push_back(typename Connection::Edge{proj(*it), std::move(cursor)});
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

   // Overload for makeConnection, with full Connection type deduction from the index.
   template <typename T, typename Key, typename Proj = std::identity>
   auto makeConnection(const TableIndex<T, Key>&         index,
                       const std::optional<Key>&         gt,
                       const std::optional<Key>&         ge,
                       const std::optional<Key>&         lt,
                       const std::optional<Key>&         le,
                       std::optional<uint32_t>           first,
                       std::optional<uint32_t>           last,
                       const std::optional<std::string>& before,
                       const std::optional<std::string>& after,
                       Proj&&                            proj = {})
   {
      constexpr auto connName = psio::reflect<T>::name + "Connection";
      constexpr auto edgeName = psio::reflect<T>::name + "Edge";
      using Connection        = psibase::Connection<T, connName, edgeName>;
      return makeConnection<Connection>(index, gt, ge, lt, le, first, last, before, after,
                                        std::forward<Proj>(proj));
   }

   /// Similar to makeConnection, except that it allows pagination through a virtual table index.
   ///
   /// A virtual table index is a dynamically constructed vector of objects.
   ///
   /// Allows for a user-provided projection function that transforms elements from type T to Key
   /// before isolating a range within the container.
   template <typename Connection, typename T, typename Key>
   Connection makeVirtualConnection(const std::vector<T>&             elements,
                                    const std::optional<Key>&         gt,
                                    const std::optional<Key>&         ge,
                                    const std::optional<Key>&         lt,
                                    const std::optional<Key>&         le,
                                    std::optional<uint32_t>           first,
                                    std::optional<uint32_t>           last,
                                    const std::optional<std::string>& before,
                                    const std::optional<std::string>& after,
                                    std::function<Key(T)>             projection = {})
   {
      auto indexFromString = [&](const std::string& str, size_t& index) -> bool
      {
         char*         end;
         unsigned long result = std::strtoul(str.c_str(), &end, 10);
         if (end == str.c_str() || *end != '\0' || result == std::numeric_limits<size_t>::max())
         {
            return false;
         }
         index = static_cast<size_t>(result);
         return true;
      };

      auto lower_bound = [&](const Key& key)
      { return std::ranges::lower_bound(elements, key, {}, projection); };

      auto upper_bound = [&](const Key& key)
      { return std::ranges::upper_bound(elements, key, {}, projection); };

      auto rangeBegin = elements.begin();
      auto rangeEnd   = elements.end();
      if (ge || gt || le || lt)
      {
         if (!projection)
         {
            psibase::check(false, "makeVirtualConnection: missing projection function");
         }
      }
      if (ge)
         rangeBegin = std::max(rangeBegin, lower_bound(*ge));
      if (gt)
         rangeBegin = std::max(rangeBegin, upper_bound(*gt));
      if (le)
         rangeEnd = std::min(rangeEnd, upper_bound(*le));
      if (lt)
         rangeEnd = std::min(rangeEnd, lower_bound(*lt));
      rangeEnd = std::max(rangeBegin, rangeEnd);

      auto it  = rangeBegin;
      auto end = rangeEnd;
      if (after)
      {
         size_t index = 0;
         if (indexFromString(*after, index))
            it = std::clamp(elements.begin() + index + 1, rangeBegin, rangeEnd);
      }
      if (before)
      {
         size_t index = 0;
         if (indexFromString(*before, index))
            end = std::clamp(elements.begin() + index, rangeBegin, rangeEnd);
      }

      end = std::max(it, end);

      Connection result;
      auto       add_edge = [&](const auto& it)
      {
         size_t index  = std::distance(elements.begin(), it);
         auto   cursor = std::to_string(index);
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

   template <typename Index, typename F>
   struct TransformedConnection
   {
      Index index;
      F     f;
   };

   namespace detail
   {
      template <typename Connection, typename T, typename Key>
      Connection makeConnectionFn(const TableIndex<T, Key>&         index,
                                  const std::optional<Key>&         gt,
                                  const std::optional<Key>&         ge,
                                  const std::optional<Key>&         lt,
                                  const std::optional<Key>&         le,
                                  std::optional<uint32_t>           first,
                                  std::optional<uint32_t>           last,
                                  const std::optional<std::string>& before,
                                  const std::optional<std::string>& after)
      {
         return makeConnection<Connection>(index, gt, ge, lt, le, first, last, before, after);
      }

      template <typename Connection, typename Index, typename F, typename Key>
      Connection makeTransformedConnection(const TransformedConnection<Index, F>& index,
                                           const std::optional<Key>&              gt,
                                           const std::optional<Key>&              ge,
                                           const std::optional<Key>&              lt,
                                           const std::optional<Key>&              le,
                                           std::optional<uint32_t>                first,
                                           std::optional<uint32_t>                last,
                                           const std::optional<std::string>&      before,
                                           const std::optional<std::string>&      after)
      {
         return makeConnection<Connection>(index.index, gt, ge, lt, le, first, last, before, after,
                                           index.f);
      }
   }  // namespace detail

   template <typename T, typename K>
   constexpr std::optional<std::array<const char*, 8>> gql_callable_args(TableIndex<T, K>*)
   {
      return std::array{"gt", "ge", "lt", "le", "first", "last", "before", "after"};
   }

   template <typename T, typename K>
   constexpr auto gql_callable_fn(const TableIndex<T, K>*)
   {
      using Connection = psibase::Connection<  //
          T, psio::reflect<T>::name + "Connection", psio::reflect<T>::name + "Edge">;
      return &detail::makeConnectionFn<Connection, T, K>;
   }  // gql_callable_fn

   template <typename Index, typename F>
   constexpr std::optional<std::array<const char*, 8>> gql_callable_args(
       TransformedConnection<Index, F>*)
   {
      return std::array{"gt", "ge", "lt", "le", "first", "last", "before", "after"};
   }

   template <typename T, typename Key, typename F>
   constexpr auto gql_callable_fn(const TransformedConnection<TableIndex<T, Key>, F>*)
   {
      using R          = decltype(std::declval<F>()(std::declval<T>()));
      using Connection = psibase::Connection<  //
          R, psio::reflect<R>::name + "Connection", psio::reflect<R>::name + "Edge">;
      return &detail::makeTransformedConnection<Connection, TableIndex<T, Key>, F, Key>;
   }  // gql_callable_fn

   // These fields are in snake_case and have the event_ prefix
   // to avoid conflict with event argument names, which
   // should be in mixedCase to match common GraphQL convention.
   struct EventDecoderStatus
   {
      uint32_t      event_db;
      uint64_t      event_id;
      bool          event_found;
      AccountNumber event_service;
      bool          event_supported_service;
      MethodNumber  event_type;
      bool          event_unpack_ok;
      PSIO_REFLECT(EventDecoderStatus,
                   event_db,
                   event_id,
                   event_found,
                   event_service,
                   event_supported_service,
                   event_type,
                   event_unpack_ok)
   };

   /// GraphQL support for decoding an event
   ///
   /// If a GraphQL query function returns this type, then the system
   /// fetches and decodes an event.
   ///
   /// The GraphQL result is an object with these fields, plus more:
   ///
   /// ```text
   /// type MyService_EventsUi {
   ///     event_db: Float!                   # Database ID (uint32_t)
   ///     event_id: String!                  # Event ID (uint64_t)
   ///     event_found: Boolean!              # Was the event found in db?
   ///     event_service: String!             # Service that created the event
   ///     event_supported_service: Boolean!  # Is this service the one
   ///                                        #    that created it?
   ///     event_type: String!                # Event type
   ///     event_unpack_ok: Boolean!          # Did it decode OK?
   /// }
   /// ```
   ///
   /// `EventDecoder` will only attempt to decode an event which meets all of the following:
   /// * It's found in the `EventDecoder::db` database (`event_found` will be true)
   /// * Was written by the service which matches the `EventDecoder::service` field (`event_supported_service` will be true)
   /// * Has a type which matches one of the definitions in the `Events` template argument
   ///
   /// If decoding is successful, `EventDecoder` will set the GraphQL `event_unpack_ok`
   /// field to true. It will include any event fields which were in the query request.
   /// It will include all event fields if the query request includes the special field
   /// `event_all_content`. `EventDecoder` silently ignores any requested fields which
   /// don't match the fields of the decoded event.
   ///
   /// #### EventDecoder example
   ///
   /// This example assumes you're already [serving GraphQL](#psibaseservegraphql) and
   /// have [defined events](services-events.md#defining-events) for your service.
   /// It's rare to define a query method like this one; use [EventQuery] instead,
   /// which handles history, ui, and merkle events.
   ///
   /// ```c++
   /// struct Query
   /// {
   ///    psibase::AccountNumber service;
   ///
   ///    auto getUiEvent(uint64_t eventId) const
   ///    {
   ///       return EventDecoder<MyService::Events::Ui>{
   ///          DbId::uiEvent, eventId, service};
   ///    }
   /// };
   /// PSIO_REFLECT(Query, method(getUiEvent, eventId))
   /// ```
   ///
   /// Example query:
   ///
   /// ```text
   /// {
   ///   getUiEvent(eventId: "13") {
   ///     event_id
   ///     event_type
   ///     event_all_content
   ///   }
   /// }
   /// ```
   ///
   /// Example reply:
   ///
   /// ```text
   /// {
   ///   "data": {
   ///     "getUiEvent": {
   ///       "event_id": "13",
   ///       "event_type": "credited",
   ///       "tokenId": 1,
   ///       "sender": "symbol",
   ///       "receiver": "alice",
   ///       "amount": {
   ///         "value": "100000000000"
   ///       },
   ///       "memo": {
   ///         "contents": "memo"
   ///       }
   ///     }
   ///   }
   /// }
   /// ```
   template <typename Events>
   struct EventDecoder
   {
      DbId          db;
      uint64_t      eventId;
      AccountNumber service;
   };

   template <typename Events>
   auto get_type_name(const EventDecoder<Events>*)
   {
      return psio::get_type_name<Events>();
   }

   template <typename Events>
   auto get_gql_name(EventDecoder<Events>*)
   {
      return psio::get_type_name<Events>();
   }

   template <typename Events, typename S>
   void fill_gql_schema(EventDecoder<Events>*,
                        S&                                          stream,
                        std::set<std::pair<std::type_index, bool>>& defined_types,
                        bool                                        is_input,
                        bool                                        is_query_root = false)
   {
      psio::fill_gql_schema_as((EventDecoder<Events>*)nullptr, (EventDecoderStatus*)nullptr, stream,
                               defined_types, is_input, is_query_root);
   }

   template <int i, typename T, typename F>
   void get_event_all_content(const T& value, std::span<const char* const> field_names, F&& f)
   {
      if constexpr (i < std::tuple_size_v<T>)
         if (i < field_names.size())
         {
            f(field_names[i], std::get<i>(value));
            get_event_all_content<i + 1>(value, field_names, std::move(f));
         }
   }

   template <int i, typename T, typename F>
   void get_event_field(const T&                     value,
                        std::string_view             name,
                        std::string_view             alias,
                        std::span<const char* const> field_names,
                        F&&                          f)
   {
      if constexpr (i < std::tuple_size_v<T>)
         if (i < field_names.size())
         {
            if (name == field_names[i])
               f(alias, std::get<i>(value));
            else
               get_event_field<i + 1>(value, name, alias, field_names, std::move(f));
         }
   }

   template <typename Events, typename T, typename F>
   void get_event_field(const EventDecoder<Events>&  decoder,
                        MethodNumber                 type,
                        const T&                     value,
                        std::string_view             name,
                        std::string_view             alias,
                        std::span<const char* const> field_names,
                        F&&                          f)
   {
      if (name == "event_db")
         f(alias, (uint32_t)decoder.db);
      else if (name == "event_id")
         f(alias, decoder.eventId);
      else if (name == "event_found")
         f(alias, true);
      else if (name == "event_service")
         f(alias, decoder.service);
      else if (name == "event_supported_service")
         f(alias, true);
      else if (name == "event_type")
         f(alias, type);
      else if (name == "event_unpack_ok")
         f(alias, true);
      else if (name == "event_all_content")
         get_event_all_content<0>(value, field_names, f);
      else
         get_event_field<0>(value, name, alias, field_names, f);
   }

   template <typename Events, typename T, typename OS, typename E>
   auto gql_query_decoder_value(const EventDecoder<Events>&  decoder,
                                MethodNumber                 type,
                                const T&                     value,
                                psio::gql_stream&            input_stream,
                                OS&                          output_stream,
                                const E&                     error,
                                std::span<const char* const> field_names)
   {
      if (input_stream.current_punctuator != '{')
         return error("expected {");
      input_stream.skip();
      bool first = true;
      output_stream.write('{');
      while (input_stream.current_type == psio::gql_stream::name)
      {
         bool found      = false;
         bool ok         = true;
         auto alias      = input_stream.current_value;
         auto field_name = alias;
         input_stream.skip();
         if (input_stream.current_punctuator == ':')
         {
            input_stream.skip();
            if (input_stream.current_type != psio::gql_stream::name)
               return error("expected name after :");
            field_name = input_stream.current_value;
            input_stream.skip();
         }

         get_event_field(decoder, type, value, field_name, alias, field_names,
                         [&](auto alias, const auto& field_value)
                         {
                            found = true;
                            if (first)
                            {
                               increase_indent(output_stream);
                               first = false;
                            }
                            else
                            {
                               output_stream.write(',');
                            }
                            write_newline(output_stream);
                            to_json(alias, output_stream);
                            write_colon(output_stream);

                            // Allow fields to be treated normally or as scalars
                            if (input_stream.current_punctuator == '(' ||
                                input_stream.current_punctuator == '{')
                               ok &= gql_query(field_value, input_stream, output_stream, error);
                            else
                               to_json(field_value, output_stream);
                         });

         if (!ok)
            return false;
         if (!found)
         {
            if (!gql_skip_args(input_stream, error))
               return false;
            if (!gql_skip_selection_set(input_stream, error))
               return false;
         }
      }
      if (input_stream.current_punctuator != '}')
         return error("expected }");
      input_stream.skip();
      if (!first)
      {
         decrease_indent(output_stream);
         write_newline(output_stream);
      }
      output_stream.write('}');
      return true;
   }  // gql_query_decoder_value

   template <typename Events, typename OS, typename E>
   auto gql_query(const EventDecoder<Events>& decoder,
                  psio::gql_stream&           input_stream,
                  OS&                         output_stream,
                  const E&                    error,
                  bool                        allow_unknown_members = false)
   {
      auto v = getSequentialRaw(decoder.db, decoder.eventId);

      if (!v)
         return gql_query(
             EventDecoderStatus{
                 .event_db                = (uint32_t)decoder.db,
                 .event_id                = decoder.eventId,
                 .event_found             = false,
                 .event_service           = {},
                 .event_supported_service = false,
                 .event_type              = {},
                 .event_unpack_ok         = false,
             },
             input_stream, output_stream, error, true);

      SequentialRecord<MethodNumber> header = {};
      if (!psio::from_frac(header, *v) || header.service != decoder.service)
         return gql_query(
             EventDecoderStatus{
                 .event_db                = (uint32_t)decoder.db,
                 .event_id                = decoder.eventId,
                 .event_found             = true,
                 .event_service           = header.service,
                 .event_supported_service = false,
                 .event_type              = *header.type,
                 .event_unpack_ok         = false,
             },
             input_stream, output_stream, error, true);

      bool ok    = true;
      bool found = false;
      psio::get_member_function_type<Events>(
          header.type->value,
          [&](auto member, std::span<const char* const> names)
          {
             using MT = psio::MemberPtrType<decltype(member)>;
             static_assert(MT::isFunction);
             using TT = typename psio::make_param_value_tuple<decltype(member)>::type;
             SequentialRecord<MethodNumber, TT> eventData = {};
             if (psio::from_frac(eventData, *v))
             {
                found = true;
                ok = gql_query_decoder_value(decoder, *header.type, *eventData.value, input_stream,
                                             output_stream, error, names.subspan(1));
             }
          });

      if (!found)
         return gql_query(
             EventDecoderStatus{
                 .event_db                = (uint32_t)decoder.db,
                 .event_id                = decoder.eventId,
                 .event_found             = true,
                 .event_service           = header.service,
                 .event_supported_service = true,
                 .event_type              = *header.type,
                 .event_unpack_ok         = false,
             },
             input_stream, output_stream, error, true);

      return ok;
   }  // gql_query(EventDecoder)

   template <typename T>
   concept EventType = requires(T events) {
      typename decltype(events)::History;
      // Don't require Ui and Merkle for now
      //typename decltype(events)::Ui;
      //typename decltype(events)::Merkle;
   };

   /// GraphQL support for decoding multiple events
   ///
   /// If a GraphQL query function returns this type, then the system
   /// returns a GraphQL object with the following query methods:
   ///
   /// ```text
   /// type MyService_Events {
   ///     history(ids: [String!]!): [MyService_EventsHistory!]!
   ///     ui(ids: [String!]!):      [MyService_EventsUi!]!
   ///     merkle(ids: [String!]!):  [MyService_EventsMerkle!]!
   /// }
   /// ```
   ///
   /// These methods take an array of event IDs. They return arrays
   /// of objects containing the decoded (if possible) events.
   /// See [EventDecoder] for how to interact with the return values;
   /// `MyService_EventsHistory`, `MyService_EventsUi`, and
   /// `MyService_EventsMerkle` all behave the same.
   ///
   ///
   /// #### EventQuery example
   ///
   /// This example assumes you're already [serving GraphQL](#psibaseservegraphql) and
   /// have [defined events](services-events.md#defining-events) for your service.
   ///
   /// ```c++
   /// struct Query
   /// {
   ///    psibase::AccountNumber service;
   ///
   ///    auto events() const
   ///    {
   ///       return psibase::EventQuery<MyService::Events>{service};
   ///    }
   /// };
   /// PSIO_REFLECT(Query, method(events))
   /// ```
   ///
   /// Example query:
   ///
   /// ```text
   /// {
   ///   events {
   ///     history(ids: ["3", "4"]) {
   ///       event_id
   ///       event_all_content
   ///     }
   ///   }
   /// }
   /// ```
   ///
   /// Example reply:
   ///
   /// ```text
   /// {
   ///   "data": {
   ///     "events": {
   ///       "history": [
   ///         {
   ///           "event_id": "3",
   ///           "tokenId": 1,
   ///           "creator": "tokens",
   ///           "precision": {
   ///             "value": 8
   ///           },
   ///           "maxSupply": {
   ///             "value": "100000000000000000"
   ///           }
   ///         },
   ///         {
   ///           "event_id": "4",
   ///           "prevEvent": 1,
   ///           "tokenId": "3",
   ///           "setter": "tokens",
   ///           "flag": "untradeable",
   ///           "enable": true
   ///         }
   ///       ]
   ///     }
   ///   }
   /// }
   /// ```
   template <EventType Events>
   struct EventQuery
   {
      AccountNumber service;

      /// Decode history events
      auto history(const std::vector<uint64_t>& ids) const
      {
         std::vector<EventDecoder<typename Events::History>> result;
         result.reserve(ids.size());
         for (auto id : ids)
            result.push_back({DbId::historyEvent, id, service});
         return result;
      }

      /// Decode user interface events
      auto ui(const std::vector<uint64_t>& ids) const
      {
         std::vector<EventDecoder<typename Events::Ui>> result;
         result.reserve(ids.size());
         for (auto id : ids)
            result.push_back({DbId::uiEvent, id, service});
         return result;
      }

      /// Decode merkle events
      auto merkle(const std::vector<uint64_t>& ids) const
      {
         std::vector<EventDecoder<typename Events::Merkle>> result;
         result.reserve(ids.size());
         for (auto id : ids)
            result.push_back({DbId::merkleEvent, id, service});
         return result;
      }

      PSIO_REFLECT(EventQuery, method(history, ids), method(ui, ids), method(merkle, ids))

      friend auto get_type_name(EventQuery*) { return psio::get_type_name<Events>(); }
   };  // EventQuery

}  // namespace psibase
