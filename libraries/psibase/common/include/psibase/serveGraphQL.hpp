#pragma once

#include <psibase/Table.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/graphql.hpp>
#include <psio/json.hpp>
#include <psio/json_value.hpp>
#include <psio/key.hpp>
#include <psio/reflect.hpp>

#include <charconv>
#include <format>
#include <limits>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace psibase
{
   /// The body of `POST /graphql` with `Content-Type: application/json`
   struct GraphQLQuery
   {
      std::string                     query;
      std::optional<psio::json_value> variables;
      std::optional<std::string>      operationName;
      PSIO_REFLECT(GraphQLQuery, query, variables, operationName);
   };

   namespace detail
   {
      // What a request to `/graphql` asks for
      struct GraphQLRequest
      {
         enum Kind
         {
            none,       // not a GraphQL request
            getSchema,  // the schema, in SDL
            runQuery,
         };
         Kind        kind = none;
         std::string query;
         std::string variables;      // the text of a JSON object, or empty
         std::string operationName;  // empty: the document's only operation
      };

      inline GraphQLRequest parseGraphQLRequest(const HttpRequest& request)
      {
         GraphQLRequest result;
         auto target = ((std::string_view)request.target).substr(0, request.target.find('?'));
         if (target != "/graphql")
            return result;

         if (auto pos = request.target.find("?query="); pos < request.target.size())
         {
            result.kind  = GraphQLRequest::runQuery;
            result.query = request.target.substr(pos + 7);
         }
         else if (request.method == "GET")
         {
            result.kind = GraphQLRequest::getSchema;
         }
         else if (request.method == "POST")
         {
            if (request.contentType == "application/graphql")
            {
               result.kind = GraphQLRequest::runQuery;
               result.query.assign(request.body.data(), request.body.size());
            }
            else if (request.contentType == "application/json")
            {
               auto q       = psio::from_ijson<GraphQLQuery>(request.body);
               result.kind  = GraphQLRequest::runQuery;
               result.query = std::move(q.query);
               // `"variables": null` is the same as no variables
               if (q.variables && !std::holds_alternative<std::monostate>(q.variables->value))
                  result.variables = psio::to_ijson(*q.variables);
               if (q.operationName)
                  result.operationName = std::move(*q.operationName);
            }
         }
         return result;
      }

      inline HttpReply graphQLReply(std::string_view contentType, const std::string& body)
      {
         return HttpReply{
             .contentType = std::string{contentType},
             .body        = {body.data(), body.data() + body.size()},
             .headers     = allowCors(),
         };
      }
   }  // namespace detail

   /// Handle `/graphql` request
   ///
   /// This handles graphql requests, including fetching the schema.
   ///
   /// * `GET /graphql`: Returns the schema.
   /// * `GET /graphql?query=...`: Run query in URL and return JSON result.
   /// * `POST /graphql?query=...`: Run query in URL and return JSON result.
   /// * `POST /graphql` with `Content-Type = application/graphql`: Run query that's in body and return JSON result.
   /// * `POST /graphql` with `Content-Type = application/json`: Body contains a JSON object of the form
   ///   `{"query": "...", "variables": {...}, "operationName": "..."}`; `variables` and `operationName`
   ///   are optional. Run query and return JSON result.
   ///
   /// The result is `{"data": ...}`, followed by
   /// `"errors": [{"message": ..., "locations": [...], "path": [...]}]`
   /// when the query or one of its fields failed.
   ///
   /// `queryRoot` should be a reflected object; it is the root type of the schema
   /// (`psio::graphql::schema<QueryRoot>`). Name it `Query`, or annotate it with
   /// `PSIO_TYPE_ATTRS(QueryRoot, psio::graphql::name_as{"Query"})`. GraphQL exposes
   /// both fields and **const** methods; a member that is state, not a field, is
   /// annotated `attr(member, psio::graphql::hidden)` or left unreflected. A method
   /// reports an error by returning `psio::graphql::result<T>`
   /// (`return psio::graphql::fail("message")`).
   ///
   /// `limits` bound the query and the response (PSIO's `docs/graphql.md`, "Limits");
   /// a service whose pages are bounded otherwise may raise them.
   ///
   /// See PSIO's `docs/graphql.md` and the [connection example](#connection-example).
   template <typename QueryRoot>
   std::optional<HttpReply> serveGraphQL(const HttpRequest&           request,
                                         const QueryRoot&             queryRoot,
                                         const psio::graphql::limits& limits = {})
   {
      using Schema = psio::graphql::schema<std::remove_cvref_t<QueryRoot>>;
      auto req     = detail::parseGraphQLRequest(request);
      if (req.kind == detail::GraphQLRequest::getSchema)
         return detail::graphQLReply("text/plain", Schema::sdl());
      if (req.kind != detail::GraphQLRequest::runQuery)
         return std::nullopt;

      psio::graphql::request gqlRequest;
      gqlRequest.operation_name = req.operationName;
      gqlRequest.variables      = req.variables;
      std::string out;
      Schema::run(queryRoot, req.query, out, gqlRequest, limits);
      return detail::graphQLReply("application/json", out);
   }  // serveGraphQL

   /// Block context for an event row.
   struct EventBlockInfo
   {
      std::optional<psibase::BlockNum>  blockNum;
      std::optional<psibase::BlockTime> blockTime;
      PSIO_REFLECT(EventBlockInfo, blockNum, blockTime)
   };

   namespace detail
   {
      template <typename T>
      consteval bool has_block_member()
      {
         return psio::reflect<T>::index_of("block").has_value();
      }
   }  // namespace detail

   /// Wraps a node type with block context for event queries.
   ///
   /// In GraphQL the type is named `<T>WithBlockContext` and has the field
   /// `block` followed by the fields of `T`.
   template <typename T>
   struct WithBlockContext
   {
      static_assert(!detail::has_block_member<T>(),
                    "WithBlockContext<T>: T already has a 'block' field");
      EventBlockInfo block;
      T              data;
      PSIO_REFLECT(WithBlockContext, block, attr(data, psio::graphql::flatten))
   };

   /// A [TableIndex] as PSIO's GraphQL engine pages through it
   /// (`psio::graphql::ordered_index`)
   ///
   /// The keys, and so the cursors, are the keys of the index without its prefix.
   /// The rows are the packed rows: a query reads the fields it selects in place.
   ///
   /// - `psio::graphql::paginate(IndexView{index}, range, page, allRows)`: a page of the index
   /// - `psio::graphql::transform(IndexView{index}, fn)`: the rows shown as another
   ///   record; `fn` takes a `psio::shared_pssz<T>`
   ///
   /// A const method of a query object that returns a [TableIndex] is a connection
   /// field: it takes `gt`, `ge`, `lt`, `le`, `first`, `last`, `before`, and `after`
   /// and yields `<T>Connection`.
   ///
   /// #### connection example
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
   ///    // The same, spelled out: a range and a page of an index
   ///    auto rowsBySecondary(psio::graphql::key_range<std::string> range,
   ///                         psio::graphql::page_args              page) const {
   ///       return psio::graphql::paginate(
   ///          psibase::IndexView{MyTables{service}.open<MyTable>().getIndex<1>()},
   ///          range, page, psibase::allRows);
   ///    }
   /// };
   /// PSIO_REFLECT(Query, attr(service, psio::graphql::hidden),
   ///              method(rowsByPrimary), method(rowsBySecondary, range, page))
   ///
   /// struct ExampleService : psibase::Service
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
   /// [serveGraphQL] generates this GraphQL schema and processes queries which
   /// conform to it:
   ///
   /// ```
   /// type Query {
   ///   rowsByPrimary(gt: Int, ge: Int, lt: Int, le: Int, first: Int, last: Int, before: String, after: String): MyTypeConnection
   ///   rowsBySecondary(gt: String, ge: String, lt: String, le: String, first: Int, last: Int, before: String, after: String): MyTypeConnection
   /// }
   /// type MyTypeConnection {
   ///   edges: [MyTypeEdge!]!
   ///   pageInfo: PageInfo!
   /// }
   /// type MyTypeEdge {
   ///   node: MyType!
   ///   cursor: String!
   /// }
   /// type PageInfo {
   ///   hasNextPage: Boolean!
   ///   hasPreviousPage: Boolean!
   ///   startCursor: String
   ///   endCursor: String
   /// }
   /// type MyType {
   ///   primaryKey: Int!
   ///   secondaryKey: String!
   ///   moreData: String!
   ///   someFn(arg1: String!, arg2: String!): String!
   /// }
   /// ```
   ///
   /// - `gt`, `ge`, `lt`, and `le` restrict the range. They can be used in any
   ///   combination (set intersection).
   /// - `first` and `after` page forward, `last` and `before` backward; `first`
   ///   together with `last` is an error. A cursor is the hex of a row's key.
   /// - `psio::graphql::transform(IndexView{index}, fn)` shows the rows as another
   ///   record, and `psio::graphql::page_budget{.max_bytes = n, .max_page_size = m}`
   ///   in place of `allRows` limits the stored size of a page.
   template <typename T, typename K>
   struct IndexView
   {
      using iterator = KvIterator<T>;
      TableIndex<T, K> index;

      iterator begin() const { return index.begin(); }
      iterator end() const { return index.end(); }
      /// The first row with a key >= `key`
      iterator lower_bound(std::span<const char> key) const
      {
         return index.lower_bound(KeyView{key});
      }
      /// The first row with a key > `key`
      iterator upper_bound(std::span<const char> key) const
      {
         // The smallest byte string above `key`
         std::vector<char> next(key.begin(), key.end());
         next.push_back(0);
         return index.lower_bound(KeyView{next});
      }
      std::span<const char> key(const iterator& it) const { return it.keyWithoutPrefix(); }
      psio::shared_pssz<T>  row(const iterator& it) const { return it.view(); }
      std::size_t           row_bytes(const iterator& it) const { return it.valueSize(); }
   };
   template <typename T, typename K>
   IndexView(TableIndex<T, K>) -> IndexView<T, K>;

   /// The page size limit of a connection that has none
   ///
   /// A query without `first` or `last` gets every row of the range, and `first`
   /// and `last` are not capped. (PSIO's own default is 100 rows.) The limits of
   /// the engine still apply: the complexity of the query, counted with `first`
   /// or `last` as the page size, and the size of the response.
   inline constexpr psio::graphql::page_limits allRows{std::numeric_limits<std::size_t>::max()};

   /// The arguments of a field that returns a [TableIndex]: `gt`, `ge`, `lt`, `le`
   /// (of the index's key type), `first`, `last`, `before`, `after`
   template <typename K>
   struct IndexArgs
   {
      psio::graphql::key_range<K> range;
      psio::graphql::page_args    page;
      PSIO_REFLECT(IndexArgs, range, page)
   };
}  // namespace psibase

template <typename K>
inline constexpr bool psio::graphql::argument_group<psibase::IndexArgs<K>> = true;

// A const method of a query object that returns a TableIndex is a connection
// field with the arguments of IndexArgs: see IndexView.
template <typename T, typename K>
struct psio::graphql::resolver<psibase::TableIndex<T, K>>
{
   using arguments = psibase::IndexArgs<K>;
   static auto resolve(psibase::TableIndex<T, K>&& index, const arguments& args)
   {
      return psio::graphql::paginate(psibase::IndexView<T, K>{std::move(index)}, args.range,
                                     args.page, psibase::allRows);
   }
};

// The names of the types of an event query: `<T>WithBlockContext`,
// `<T>Connection`, `<T>Edge`
template <typename T>
struct psio::graphql::type_name<psibase::WithBlockContext<T>>
{
   static constexpr std::string_view value =
       psio::graphql::affixed_name<"", T, "WithBlockContext">;
};
template <typename T>
struct psio::graphql::type_name<psio::graphql::connection<psibase::WithBlockContext<T>>>
{
   static constexpr std::string_view value = psio::graphql::affixed_name<"", T, "Connection">;
};
template <typename T>
struct psio::graphql::type_name<psio::graphql::edge<psibase::WithBlockContext<T>>>
{
   static constexpr std::string_view value = psio::graphql::affixed_name<"", T, "Edge">;
};

namespace psibase
{
   struct EventQueryInterface
   {
      std::string sqlQuery(const std::string& query, const std::vector<std::string>& params);
   };
   PSIO_REFLECT(EventQueryInterface, method(sqlQuery, query, params))

   template <typename T>
   struct SqlRow
   {
      uint64_t rowid;
      T        data;
      PSIO_REFLECT(SqlRow, rowid, data)
   };

   struct RowBlockStart
   {
      uint64_t  rowIndex;
      BlockNum  blockNum;
      BlockTime blockTime;
      PSIO_REFLECT(RowBlockStart, rowIndex, blockNum, blockTime)
   };

   namespace detail
   {
      inline std::string sql_query(const std::string&              query,
                                   const std::vector<std::string>& params,
                                   bool                            debug)
      {
         if (debug)
         {
            printf("SQL query str: %s\n", query.c_str());
            printf("SQL params: [");
            for (size_t i = 0; i < params.size(); ++i)
            {
               if (i > 0)
                  printf(", ");
               printf("\"%s\"", params[i].c_str());
            }
            printf("]\n");
         }

         auto json_str = to<EventQueryInterface>("events+1"_a).sqlQuery(query, params);

         if (debug)
         {
            printf("Raw JSON response: %s\n", json_str.c_str());
         }

         return json_str;
      }

      inline std::vector<RowBlockStart> fetchBlockStarts(const std::vector<uint64_t>& rowids,
                                                         bool                         debug)
      {
         if (rowids.empty())
            return {};

         std::string values;
         for (size_t i = 0; i < rowids.size(); ++i)
         {
            if (i)
               values += ", ";
            std::format_to(std::back_inserter(values), "({}, {})", i, rowids[i]);
         }

         auto sql = std::format(
             "WITH rows(rowIndex, rowId) AS (VALUES {})"
             " SELECT r.rowIndex, m.blockNum, m.blockTime"
             " FROM rows r"
             " JOIN \"history.transact.blockStart\" m ON m.ROWID = ("
             "   SELECT ROWID"
             "   FROM \"history.transact.blockStart\""
             "   WHERE ROWID <= r.rowId"
             "   ORDER BY ROWID DESC"
             "   LIMIT 1"
             " )",
             values);
         auto json = sql_query(sql, {}, debug);
         return psio::from_ijson<std::vector<RowBlockStart>>(json);
      }
   }  // namespace detail

   namespace detail
   {
      // Reads the result of an SQL query over an event table,
      // `[{"rowid":…, <the members of T, flattened>…}, …]`: each column is
      // read into the member of T of that name; other columns are skipped.
      // Aborts with the reader's message when `json` is not such a text.
      template <typename T>
      std::vector<SqlRow<T>> read_sql_rows(std::string_view json)
      {
         std::vector<SqlRow<T>> rows;
         psio::json_text_cursor cursor{std::span<const char>{json.data(), json.size()}, true};
         psio::json_reader      reader{psio::ijson{}, cursor};
         auto                   read = [&]
         {
            bool             has = false, known = false;
            std::string_view key;
            if (!cursor.begin_array())
               return false;
            for (;;)
            {
               if (!cursor.next_element(has))
                  return false;
               if (!has)
                  return cursor.finish();
               SqlRow<T> row{};
               if (!cursor.begin_object())
                  return false;
               for (;;)
               {
                  if (!cursor.next_field(has, key))
                     return false;
                  if (!has)
                     break;
                  if (key == "rowid")
                  {
                     if (!reader.read(row.rowid))
                        return false;
                  }
                  else if (!reader.read_member(key, row.data, known) || (!known && !reader.skip()))
                     return false;
               }
               rows.push_back(std::move(row));
            }
         };
         if (!read())
            abortMessage("SQL result: " + std::string(reader.status().error().what));
         return rows;
      }
   }  // namespace detail

   /// GraphQL Pagination through Event tables
   ///
   /// Event tables are stored in an SQLite database in a service.
   ///
   /// This interface allows you to query the event tables using the
   /// [GraphQL Pagination Spec](https://relay.dev/graphql/connections.htm).
   ///
   /// `condition` defines a SQL WHERE clause filter.
   /// `page` (`first`, `last`, `before`, and `after`) pages through the results.
   ///
   /// They conform to the Pagination Spec, except that simultaneous `first`
   /// and `last` arguments are forbidden, rather than simply discouraged.
   ///
   /// A cursor is the hex of the row id as a key (16 digits).
   template <typename T>
   class EventQuery
   {
     public:
      using Node       = WithBlockContext<T>;
      using Connection = psio::graphql::connection<Node>;

      /// Create a new query for the given table
      explicit EventQuery(std::string table_name) : _table_name(std::move(table_name)) {}

      /// Enable debug output printing
      EventQuery& with_debug_output()
      {
         _debug = true;
         return *this;
      }

      /// Add a SQL WHERE clause condition to filter results
      ///
      /// This replaces the current condition and parameters if they exist.
      ///
      /// Parameters are bound using `sqlite3_bind_text` and are safe from SQL injection.
      /// Use `?` placeholders in the condition string, and provide corresponding parameter
      /// values in the `params` vector. Parameters are bound in order.
      ///
      /// For LIKE patterns, include wildcards (e.g., `%`) in the parameter values, not in the SQL.
      EventQuery& condition(std::string cond, std::vector<std::string> params = {})
      {
         _condition = std::move(cond);
         _params    = std::move(params);
         return *this;
      }

      /// The page to return
      ///
      /// - `first`: limit the result to the first `n` matching records
      /// - `last`: limit the result to the last `n` matching records
      /// - `before`, `after`: resume paging; limit the result to records before
      ///   (after) a cursor of a previously-returned connection
      ///
      /// This replaces the current value.
      EventQuery& page(psio::graphql::page_args page)
      {
         _page = std::move(page);
         return *this;
      }

      /// Execute the query and return a connection containing the results.
      ///
      /// Each node is wrapped in WithBlockContext<T> carrying block metadata.
      /// The result is a field error if both first and last are specified, if
      /// one of them is out of range or if a cursor is malformed.
      psio::graphql::result<Connection> query() const
      {
         if (_page.first && _page.last)
            return psio::graphql::fail("Arguments \"first\" and \"last\" cannot both be given.");
         for (const auto& n : {_page.first, _page.last})
            if (n && (*n < 0 || *n == std::numeric_limits<int32_t>::max()))
               return psio::graphql::fail("Arguments \"first\" and \"last\" are out of range.");
         std::optional<uint64_t> before, after;
         if (_page.before && !(before = extract_cursor(*_page.before)))
            return psio::graphql::fail("Argument \"before\" is not a cursor.");
         if (_page.after && !(after = extract_cursor(*_page.after)))
            return psio::graphql::fail("Argument \"after\" is not a cursor.");

         auto [rows, has_next_page, has_prev_page] = all_edges(before, after);

         std::vector<uint64_t> rowids;
         rowids.reserve(rows.size());
         for (const auto& row : rows)
            rowids.push_back(row.rowid);

         auto                        blockStarts = detail::fetchBlockStarts(rowids, _debug);
         std::vector<EventBlockInfo> blockInfos(rows.size());
         for (const auto& bs : blockStarts)
         {
            check(bs.rowIndex < rows.size(), "rowIndex out of range");
            blockInfos[bs.rowIndex] = EventBlockInfo{bs.blockNum, bs.blockTime};
         }

         psio::graphql::connection_builder<Node> connection;
         connection.reserve(rows.size());
         for (size_t i = 0; i < rows.size(); ++i)
         {
            auto cursor = psio::to_key(rows[i].rowid);
            connection.add(Node{blockInfos[i], std::move(rows[i].data)},
                           std::span<const char>{cursor.data(), cursor.size()});
         }
         return std::move(connection).finish(has_prev_page, has_next_page);
      }

     private:
      std::tuple<std::vector<SqlRow<T>>, bool, bool> all_edges(std::optional<uint64_t> before,
                                                               std::optional<uint64_t> after) const
      {
         std::optional<int32_t> limit_plus_one;
         bool                   descending = false;

         if (_page.first.has_value())
         {
            limit_plus_one = _page.first.value() + 1;
         }
         else if (_page.last.has_value())
         {
            limit_plus_one = _page.last.value() + 1;
            descending     = true;
         }

         auto query_str = generate_sql_query(limit_plus_one, descending, before, after);
         auto json_str  = detail::sql_query(query_str, _params, _debug);
         auto rows      = detail::read_sql_rows<T>(json_str);

         if (_debug)
         {
            printf("EventQuery::query() Deserialized %zu rows\n", rows.size());
         }

         bool                   has_next_page = false;
         bool                   has_prev_page = false;
         std::optional<int32_t> user_limit;

         if (_page.first.has_value())
         {
            has_next_page = rows.size() > static_cast<size_t>(_page.first.value());
            user_limit    = _page.first;
         }
         else if (_page.last.has_value())
         {
            has_prev_page = rows.size() > static_cast<size_t>(_page.last.value());
            user_limit    = _page.last;
         }

         if (user_limit.has_value())
         {
            auto limit = static_cast<size_t>(user_limit.value());
            if (rows.size() > limit)
            {
               rows.resize(limit);
            }
         }

         if (_page.last.has_value())
         {
            std::reverse(rows.begin(), rows.end());
         }

         return {rows, has_next_page, has_prev_page};
      }

      // The row id of a cursor: 16 hex digits, the key of the row id
      static std::optional<uint64_t> extract_cursor(std::string_view c)
      {
         uint64_t b{};
         if (c.size() != 16)
            return std::nullopt;
         auto [ptr, ec] = std::from_chars(c.data(), c.data() + c.size(), b, 16);
         if (ec != std::errc{} || ptr != c.data() + c.size())
            return std::nullopt;
         return b;
      }

      std::string generate_sql_query(std::optional<int32_t>  limit,
                                     bool                    descending,
                                     std::optional<uint64_t> before,
                                     std::optional<uint64_t> after) const
      {
         std::vector<std::string> filters;

         if (_condition.has_value() && !_condition->empty())
         {
            filters.push_back(*_condition);
         }

         if (before.has_value())
         {
            filters.push_back(std::format("ROWID < {}", *before));
         }

         if (after.has_value())
         {
            filters.push_back(std::format("ROWID > {}", *after));
         }

         auto order = descending ? "DESC" : "ASC";
         auto query = std::format("SELECT ROWID, * FROM \"{}\"", _table_name);

         if (!filters.empty())
         {
            query += " WHERE ";
            bool first = true;
            for (const auto& filter : filters)
            {
               if (!first)
                  query += " AND ";
               query += filter;
               first = false;
            }
         }

         query += std::format(" ORDER BY ROWID {}", order);

         if (limit.has_value())
         {
            query += std::format(" LIMIT {}", limit.value());
         }

         return query;
      }

      std::string                _table_name;
      std::optional<std::string> _condition;
      std::vector<std::string>   _params;
      psio::graphql::page_args   _page;
      bool                       _debug = false;

   };  // EventQuery

}  // namespace psibase
