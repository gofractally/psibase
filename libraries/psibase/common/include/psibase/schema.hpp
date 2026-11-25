#pragma once

// The schema of a service: its actions, events and tables over one PSIO
// Schema IR document (psio/schema_ir.hpp). The record and its two encodings
// (I-JSON in files and over HTTP, PSSZ as an action argument and a table
// row) are specified in doc/flip-interop.md section 2.

#include <map>
#include <optional>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Table.hpp>
#include <psibase/db.hpp>
#include <psibase/export.hpp>
#include <psibase/trace.hpp>
#include <psio/json_value.hpp>
#include <functional>
#include <psio/json.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_ir.hpp>
#include <psio/pssz_ir_compare.hpp>
#include <psio/pssz_ir_custom.hpp>
#include <psio/pssz_ir_json.hpp>
#include <psio/reflect.hpp>
#include <psio/schema_builder.hpp>
#include <psio/schema_ir.hpp>
#include <span>
#include <string>
#include <type_traits>
#include <vector>

namespace psibase
{
   /// One component of an index key
   struct FieldId
   {
      std::vector<std::uint32_t>                 path;       ///< member indexes from the row type down
      std::optional<std::string>                 transform;  ///< name of a key transform, if any
      std::optional<psio::schema_types::AnyType> type;       ///< the transform's result type, if any
   };
   PSIO_REFLECT(FieldId, path, attr(transform, utf8), type)

   using IndexInfo = std::vector<FieldId>;

   struct TableInfo
   {
      std::optional<std::string>  name;     ///< table type name
      std::uint16_t               table;    ///< table number
      psio::schema_types::AnyType type;     ///< row type
      std::vector<IndexInfo>      indexes;  ///< [0] is the primary key

      std::string str() const
      {
         if (name)
            return *name;
         else
            return std::to_string(table);
      }
   };
   PSIO_REFLECT(TableInfo, attr(name, utf8), table, type, indexes)

   using ServiceDatabaseSchema = std::vector<TableInfo>;

   template <auto V>
   const char* psibase_get_key_transform_name(nt_wrap<V>*, auto)
   {
      return "unknown";
   }

   struct EventType
   {
      psio::schema_types::AnyType type;    ///< the event's argument list
      std::string                 access;  ///< "public" | "private"
   };
   PSIO_REFLECT(EventType, type, attr(access, utf8))

   template <auto T>
   constexpr std::string_view eventAccess(void*, nt_wrap<T>*)
   {
      return "private";
   }

   /// Represents the schema for a service
   struct ServiceSchema
   {
      psibase::AccountNumber     service;
      psio::schema_types::Schema types;
      using ActionMap = std::map<std::string, psio::schema_types::FunctionType>;
      ActionMap actions;
      using EventMap = std::map<std::string, EventType>;
      EventMap history;
      EventMap merkle;

      std::optional<std::map<std::string, ServiceDatabaseSchema>> database;

      using Collision = psio::SchemaBuilder::Collision;

     private:
      template <typename T>
      static void makeActions(psio::SchemaBuilder& builder, ActionMap& out)
      {
         using reflect = psio::reflect<T>;
         reflect::for_each_method(
             [&](auto index, std::string_view name)
             {
                constexpr std::size_t I = decltype(index)::value;
                using Result            = psio::method_result_t<T, I>;
                if (out.contains(std::string(name)))
                   return;
                // A result that carries table handles is on the wire what
                // it exports (psibaseExport): the handles travel beside it.
                // Any other result is the type its returns(...) describes.
                if constexpr (hasExport<Result>)
                {
                   out.emplace(std::string(name),
                               psio::schema_types::FunctionType{
                                   psio::schema_types::Box<psio::schema_types::AnyType>{
                                       builder.insert_method_args<T, I>()},
                                   psio::schema_types::Box<psio::schema_types::AnyType>{
                                       builder.insert<exportType<Result>>()}});
                }
                else
                {
                   out.emplace(std::string(name), builder.insert_method<T, I>());
                }
             });
      }

      template <typename T>
      static void makeEvents(psio::SchemaBuilder& builder, EventMap& out)
      {
         using reflect = psio::reflect<T>;
         reflect::for_each_method(
             [&](auto index, std::string_view name)
             {
                constexpr std::size_t I = decltype(index)::value;
                using Args              = typename reflect::template method_arg_tuple<I>;
                using Event             = nt_wrap<reflect::template method_pointer<I>>;
                if (out.contains(std::string(name)))
                   return;
                out.emplace(std::string(name),
                            EventType{.type   = builder.insert<Args>(),
                                      .access = std::string(
                                          eventAccess((T*)nullptr, (Event*)nullptr))});
             });
      }

      template <bool Last, auto K, typename T, typename M>
      static void makeKeyImpl(M                    T::*,
                              FieldId&&            prefix,
                              psio::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         if constexpr (std::is_function_v<M>)
         {
            static_assert(Last, "NestedKey only allows member functions as the final element");
            prefix.transform = psibase_get_key_transform_name((nt_wrap<K>*)nullptr, K);
            prefix.type =
                builder
                    .insert<std::remove_cv_t<typename psio::method_traits<M T::*>::result>>();
            out.push_back(std::move(prefix));
         }
         else
         {
            static_assert(!std::is_function_v<M>,
                          "Member function keys not supported. Use CompositeKey instead.");
            constexpr auto idx = psio::reflect<T>::index_of_member(K);
            static_assert(idx.has_value(), "Member is not reflected");
            prefix.path.push_back(static_cast<std::uint32_t>(*idx));
            if constexpr (Last)
            {
               out.push_back(std::move(prefix));
            }
         }
      }

      template <bool Last, auto K>
      static void makeNestedKeyImpl(NestedKey<>,
                                    FieldId&&            prefix,
                                    psio::SchemaBuilder& builder,
                                    IndexInfo&           out)
      {
         if constexpr (Last)
         {
            out.push_back(std::move(prefix));
         }
      }

      template <bool Last, auto K, auto K0>
      static void makeKeyImpl(CompositeKey<K0>,
                              FieldId&&            prefix,
                              psio::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         makeKeyImpl<Last, K0>(K0, std::move(prefix), builder, out);
      }

      template <bool Last, auto K, auto... KN>
      static void makeKeyImpl(CompositeKey<KN...>,
                              FieldId&&            prefix,
                              psio::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         static_assert(Last, "CompositeKey can only appear at the end of a NestedKey");

         (makeKeyImpl<true, KN>(KN, FieldId(prefix), builder, out), ...);
      }

      template <bool Last, auto K, auto K0>
      static void makeKeyImpl(NestedKey<K0>,
                              FieldId&&            prefix,
                              psio::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         makeKeyImpl<Last, K0>(K0, std::move(prefix), builder, out);
      }

      template <bool Last, auto K, auto K0, auto... KN>
      static void makeKeyImpl(NestedKey<K0, KN...>,
                              FieldId&&            prefix,
                              psio::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         makeKeyImpl<false, K0>(K0, std::move(prefix), builder, out);
         makeKeyImpl<Last, NestedKey<KN...>{}>(NestedKey<KN...>{}, std::move(prefix), builder, out);
      }

      template <typename T, auto K>
      static IndexInfo makeKey(psio::SchemaBuilder& builder)
      {
         IndexInfo result;
         makeKeyImpl<true, K>(K, {}, builder, result);
         return result;
      }

      template <typename T, auto... K>
      static std::vector<IndexInfo> makeIndexes(psio::SchemaBuilder& builder, Table<T, K...>*)
      {
         return std::vector<IndexInfo>{makeKey<T, K>(builder)...};
      }

      template <typename T>
      static void makeTable(psio::SchemaBuilder&    builder,
                            std::uint16_t           table,
                            std::vector<TableInfo>& out)
      {
         if constexpr (!std::is_void_v<T>)
         {
            out.push_back({.name    = psio::get_type_name<T>(),
                           .table   = table,
                           .type    = builder.insert<typename T::value_type>(),
                           .indexes = makeIndexes(builder, (T*)nullptr)});
         }
      }

      static constexpr const char* dbName(DbId db)
      {
         if (db == DbId::service)
            return "service";
         else if (db == DbId::writeOnly)
            return "writeOnly";
         else if (db == DbId::subjective)
            return "subjective";
         else if (db == DbId::session)
            return "session";
         else
            abortMessage("db cannot be used in schema");
      }

      template <DbId db, typename... T>
      static void makeDatabase(psio::SchemaBuilder& builder,
                               ServiceSchema&       out,
                               DbTables<db, T...>*)
      {
         if (!out.database)
            out.database.emplace();
         constexpr auto name   = dbName(db);
         auto&          tables = (*out.database)[name];
         std::uint16_t  i      = 0;
         (makeTable<T>(builder, i++, tables), ...);
      }

      template <typename... T>
      static void makeDatabases(psio::SchemaBuilder& builder,
                                ServiceSchema&       out,
                                boost::mp11::mp_list<T...>*)
      {
         (makeDatabase(builder, out, (T*)nullptr), ...);
      }

     public:
      template <typename T>
      static ServiceSchema make()
      {
         return make<T>(T::service);
      }
      /// Constructs a schema for a service: every type is interned by one
      /// builder. Two different reflected types with one unqualified name
      /// are each named by their qualified name; those names are reported
      /// through `collisions` when it is given.
      template <typename T>
      static ServiceSchema make(AccountNumber service, std::vector<Collision>* collisions = nullptr)
      {
         ServiceSchema       result{service};
         psio::SchemaBuilder builder;
         makeActions<T>(builder, result.actions);
         if constexpr (requires { typename T::Events::History; })
         {
            makeEvents<typename T::Events::History>(builder, result.history);
         }
         if constexpr (requires { typename T::Events::Merkle; })
         {
            makeEvents<typename T::Events::Merkle>(builder, result.merkle);
         }
         if constexpr (requires { psibase_get_tables((T*)nullptr); })
         {
            makeDatabases(builder, result, (decltype(psibase_get_tables((T*)nullptr))*)nullptr);
         }
         if (auto status = builder.status(); !status.ok())
            abortMessage("schema: " + std::string(status.error().what));
         if (collisions)
            *collisions = builder.collisions();
         result.types = std::move(builder).build();
         return result;
      }

      /// The action whose name has the method number `method`, or null
      const ActionMap::value_type* findAction(MethodNumber method) const;
      /// The event of `db` whose name has the method number `event`, or null
      const EventMap::value_type* findEvent(psibase::EventDb db, MethodNumber event) const;

      /// The argument list type of an event, if the reader may see it
      const psio::schema_types::AnyType* getType(bool             canReadPrivate,
                                                 psibase::EventDb db,
                                                 MethodNumber     event) const;
      std::vector<const psio::schema_types::AnyType*> eventTypes() const;
      // Checks that the Schema IR is well-formed, that every type the other
      // members name is a type of it, and that event access values and
      // index paths are valid. Aborts with a message otherwise.
      void checkValid() const;
   };
   PSIO_REFLECT(ServiceSchema,
                service,
                types,
                attr(actions, keys(utf8)),
                attr(history, keys(utf8)),
                attr(merkle, keys(utf8)),
                attr(database, keys(utf8)))

   /// The type of the member that `path` leads to from the row type `type`
   /// (through named types and custom wrappers). Returns null and sets `msg`
   /// if the path does not resolve.
   const psio::schema_types::AnyType* getFieldType(const psio::schema_types::Schema&  schema,
                                                   const psio::schema_types::AnyType& type,
                                                   std::span<const std::uint32_t>     path,
                                                   const char*&                       msg);

   /// The handlers of the custom types every psibase schema may name:
   /// `AccountNumber` and `MethodNumber` (their text form and invariant).
   psio::pssz_ir::CustomHandlers psibase_types();

   /// An action as JSON: what the "Action" handler of `action_types` reads
   /// and writes, and one entry of a package's `postinstall.json`.
   /// `data` holds the arguments, an object keyed by parameter name or the
   /// positional array, packed with the schema of `service`; `rawData`
   /// holds them packed already (hex). One of the two is given.
   struct PrettyAction
   {
      std::string                      sender;  ///< "" is the null account
      std::string                      service;
      std::string                      method;  ///< exactly as the service declares it
      std::optional<std::vector<char>> rawData;
      std::optional<psio::json_value>  data;
   };
   PSIO_REFLECT(PrettyAction, sender, service, method, rawData, data)

   /// `psibase_types()` and the two custom types that are presented as JSON
   /// objects: `Action` as `{sender, service, method, data: {…}}` with the
   /// arguments decoded by the schema of the called service (`rawData`, hex,
   /// when `schemas` has no schema for it or the bytes are not its
   /// arguments), and `ServiceMethod` as `{service, method}`. Both
   /// directions. `onAction` is called for every action that is read.
   psio::pssz_ir::CustomHandlers action_types(
       GetSchemaFn                                                     schemas,
       std::function<void(AccountNumber sender, AccountNumber service)> onAction = {});

   /// Packs the arguments in `action.data` with the schema of the called
   /// service (an action without `data` and `rawData` has the arguments
   /// `{}`). Aborts with a message if the service has no schema, the action
   /// is not in it or the arguments do not fit.
   Action toAction(PrettyAction&&                       action,
                   const GetSchemaFn&                   schemas,
                   const psio::pssz_ir::CustomHandlers& handlers);
}  // namespace psibase
