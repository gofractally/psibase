#pragma once

#include <map>
#include <optional>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodArgs.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Table.hpp>
#include <psibase/db.hpp>
#include <psio/reflect.hpp>
#include <psio1/schema.hpp>
#include <string>
#include <type_traits>
#include <vector>

namespace psibase
{

   struct CompareMethodNumber
   {
      using is_transparent = void;
      bool operator()(const auto& lhs, const auto& rhs) const
      {
         return MethodNumber(lhs) < MethodNumber(rhs);
      }
   };

   struct FieldId
   {
      std::vector<std::uint32_t>                 path;
      std::optional<std::string>                 transform;
      std::optional<psio1::schema_types::AnyType> type;
   };
   PSIO_REFLECT(FieldId, path, transform, type)

   using IndexInfo = std::vector<FieldId>;

   struct TableInfo
   {
      std::optional<std::string>  name;
      std::uint16_t               table;
      psio1::schema_types::AnyType type;
      std::vector<IndexInfo>      indexes;

      std::string str() const
      {
         if (name)
            return *name;
         else
            return std::to_string(table);
      }
   };
   PSIO_REFLECT(TableInfo, name, table, type, indexes)

   using ServiceDatabaseSchema = std::vector<TableInfo>;

   template <auto X, auto Y>
   constexpr bool is_equal_member = false;
   template <auto X>
   constexpr bool is_equal_member<X, X> = true;

   template <auto V>
   const char* psibase_get_key_transform_name(nt_wrap<V>*, auto)
   {
      return "unknown";
   }

   struct EventType
   {
      psio1::schema_types::AnyType type;
      std::string                 access = "public";
      PSIO_REFLECT(EventType, type, access)
   };

   template <auto T>
   constexpr std::string_view eventAccess(void*, nt_wrap<T>*)
   {
      return "private";
   }

   /// Represents the schema for a service
   struct ServiceSchema
   {
      psibase::AccountNumber service;
      psio1::Schema           types;
      using ActionMap =
          std::map<std::string, psio1::schema_types::FunctionType, CompareMethodNumber>;
      ActionMap actions;
      using EventMap = std::map<std::string, EventType, CompareMethodNumber>;
      EventMap history;
      EventMap merkle;

      std::optional<std::map<std::string, ServiceDatabaseSchema>> database;

     private:
      // An object with one member per element of the argument tuple. A
      // parameter that the reflection does not name is called c<position>.
      template <typename... P>
      static auto makeParams(psio1::SchemaBuilder&             builder,
                             std::span<const std::string_view> names,
                             std::tuple<P...>*) -> psio1::schema_types::Object
      {
         psio1::schema_types::Object type;
         std::size_t                 i   = 0;
         auto                        add = [&](psio1::schema_types::AnyType&& param)
         {
            type.members.push_back(
                {i < names.size() ? std::string(names[i]) : "c" + std::to_string(i),
                 std::move(param)});
            ++i;
         };
         (add(builder.insert<P>()), ...);
         return type;
      }
      template <typename T>
      static auto makeResult(psio1::SchemaBuilder& builder)
          -> std::optional<psio1::schema_types::AnyType>
      {
         if constexpr (std::is_void_v<T>)
         {
            return {};
         }
         else
         {
            return builder.insert<T>();
         }
      }
      template <typename T>
      static void makeActions(psio1::SchemaBuilder&                       builder,
                              ActionMap&                                 out,
                              std::vector<psio1::schema_types::AnyType*>& eventTypes)
      {
         using reflect = psio::reflect<T>;
         reflect::for_each_method(
             [&](auto index, std::string_view name)
             {
                constexpr std::size_t I = decltype(index)::value;
                using Method            = typename reflect::template method_type<I>;
                auto [pos, inserted]    = out.try_emplace(
                    std::string(name),
                    psio1::schema_types::FunctionType{
                        makeParams(builder, reflect::template method_param_names<I>,
                                   (MethodArgs<Method>*)nullptr),
                        makeResult<MethodResult<Method>>(builder)});
                if (inserted)
                {
                   eventTypes.push_back(&pos->second.params);
                   if (pos->second.result)
                      eventTypes.push_back(&*pos->second.result);
                }
             });
      }

      template <typename T>
      static void makeEvents(psio1::SchemaBuilder&                       builder,
                             EventMap&                                  out,
                             std::vector<psio1::schema_types::AnyType*>& eventTypes)
      {
         using reflect = psio::reflect<T>;
         reflect::for_each_method(
             [&](auto index, std::string_view name)
             {
                constexpr std::size_t I = decltype(index)::value;
                using Method            = typename reflect::template method_type<I>;
                using Event             = nt_wrap<reflect::template method_pointer<I>>;
                auto [pos, inserted]    = out.try_emplace(
                    std::string(name),
                    EventType{.type = makeParams(builder, reflect::template method_param_names<I>,
                                                 (MethodArgs<Method>*)nullptr),
                              .access = std::string(eventAccess((T*)nullptr, (Event*)nullptr))});
                if (inserted)
                {
                   eventTypes.push_back(&pos->second.type);
                }
             });
      }

      // The index of the data member K among the reflected members of T.
      template <typename T, auto K, std::size_t... I>
      static constexpr std::uint32_t get_member_index(std::index_sequence<I...>)
      {
         const bool    found[] = {is_equal_member<psio::reflect<T>::template member_pointer<I>, K>...,
                                  false};
         std::uint32_t i       = 0;
         for (; i < sizeof...(I); ++i)
         {
            if (found[i])
               return i;
         }
         abortMessage("Member is not reflected");
      }

      template <bool Last, auto K, typename T, typename M>
      static void makeKeyImpl(M                    T::*,
                              FieldId&&            prefix,
                              psio1::SchemaBuilder& builder,
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
            constexpr auto idx = get_member_index<T, K>(
                std::make_index_sequence<psio::reflect<T>::member_count>{});
            prefix.path.push_back(idx);
            if constexpr (Last)
            {
               out.push_back(std::move(prefix));
            }
         }
      }

      template <bool Last, auto K>
      static void makeNestedKeyImpl(NestedKey<>,
                                    FieldId&&            prefix,
                                    psio1::SchemaBuilder& builder,
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
                              psio1::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         makeKeyImpl<Last, K0>(K0, std::move(prefix), builder, out);
      }

      template <bool Last, auto K, auto... KN>
      static void makeKeyImpl(CompositeKey<KN...>,
                              FieldId&&            prefix,
                              psio1::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         static_assert(Last, "CompositeKey can only appear at the end of a NestedKey");

         std::size_t prefixLen = prefix.path.size();

         (makeKeyImpl<true, KN>(KN, FieldId(prefix), builder, out), ...);
      }

      template <bool Last, auto K, auto K0>
      static void makeKeyImpl(NestedKey<K0>,
                              FieldId&&            prefix,
                              psio1::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         makeKeyImpl<Last, K0>(K0, std::move(prefix), builder, out);
      }

      template <bool Last, auto K, auto K0, auto... KN>
      static void makeKeyImpl(NestedKey<K0, KN...>,
                              FieldId&&            prefix,
                              psio1::SchemaBuilder& builder,
                              IndexInfo&           out)
      {
         makeKeyImpl<false, K0>(K0, std::move(prefix), builder, out);
         makeKeyImpl<Last, NestedKey<KN...>{}>(NestedKey<KN...>{}, std::move(prefix), builder, out);
      }

      template <typename T, auto K>
      static IndexInfo makeKey(psio1::SchemaBuilder& builder)
      {
         IndexInfo result;
         makeKeyImpl<true, K>(K, {}, builder, result);
         return result;
      }

      template <typename T, auto... K>
      static std::vector<IndexInfo> makeIndexes(psio1::SchemaBuilder& builder, Table<T, K...>*)
      {
         return std::vector<IndexInfo>{makeKey<T, K>(builder)...};
      }

      template <typename T>
      static void makeTable(psio1::SchemaBuilder&    builder,
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
      static void makeDatabase(psio1::SchemaBuilder&                       builder,
                               ServiceSchema&                             out,
                               std::vector<psio1::schema_types::AnyType*>& rowTypes,
                               DbTables<db, T...>*)
      {
         if (!out.database)
            out.database.emplace();
         constexpr auto name   = dbName(db);
         auto&          tables = (*out.database)[name];
         std::uint16_t  i      = 0;
         (makeTable<T>(builder, i++, tables), ...);
         for (auto& t : tables)
         {
            rowTypes.push_back(&t.type);
            for (auto& idx : t.indexes)
            {
               for (auto& field : idx)
               {
                  if (field.type)
                  {
                     rowTypes.push_back(&*field.type);
                  }
               }
            }
         }
      }

      template <typename... T>
      static void makeDatabases(psio1::SchemaBuilder&                       builder,
                                ServiceSchema&                             out,
                                std::vector<psio1::schema_types::AnyType*>& rowTypes,
                                boost::mp11::mp_list<T...>*)
      {
         (makeDatabase(builder, out, rowTypes, (T*)nullptr), ...);
      }

     public:
      template <typename T>
      static ServiceSchema make()
      {
         return make<T>(T::service);
      }
      /// Constructs a schema for a service.
      template <typename T>
      static ServiceSchema make(AccountNumber service)
      {
         ServiceSchema                             result{service};
         std::vector<psio1::schema_types::AnyType*> typeRefs;
         psio1::SchemaBuilder                       builder;
         makeActions<T>(builder, result.actions, typeRefs);
         if constexpr (requires { typename T::Events::History; })
         {
            makeEvents<typename T::Events::History>(builder, result.history, typeRefs);
         }
         if constexpr (requires { typename T::Events::Merkle; })
         {
            makeEvents<typename T::Events::Merkle>(builder, result.merkle, typeRefs);
         }
         if constexpr (requires { psibase_get_tables((T*)nullptr); })
         {
            makeDatabases(builder, result, typeRefs,
                          (decltype(psibase_get_tables((T*)nullptr))*)nullptr);
         }
         result.types = std::move(builder).build(typeRefs);
         return result;
      }

     private:
      const EventMap* getDb(psibase::EventDb db) const
      {
         switch (db)
         {
            case psibase::EventDb::merkleEvent:
               return &merkle;
            case psibase::EventDb::historyEvent:
               return &history;
            default:
               return nullptr;
         }
      }

     public:
      const psio1::schema_types::AnyType* getType(bool             canReadPrivate,
                                                 psibase::EventDb db,
                                                 MethodNumber     event)
      {
         if (const auto* dbTypes = getDb(db))
            if (auto pos = dbTypes->find(event);
                pos != dbTypes->end() && (canReadPrivate || pos->second.access == "public"))
               return pos->second.type.resolve(types);
         return nullptr;
      }
      std::vector<const psio1::schema_types::AnyType*> eventTypes() const
      {
         std::vector<const psio1::schema_types::AnyType*> result;
         for (const auto* m : {&history, &merkle})
         {
            for (const auto& [_, type] : *m)
            {
               result.push_back(&type.type);
            }
         }
         return result;
      }
      // checks that all names and indexes are valid
      void checkValid() const;
      PSIO_REFLECT(ServiceSchema, service, types, actions, history, merkle, database)
   };

   psio1::schema_types::CustomTypes psibase_types();
}  // namespace psibase
