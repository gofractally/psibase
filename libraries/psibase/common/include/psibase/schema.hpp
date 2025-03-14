#pragma once

#include <map>
#include <optional>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Table.hpp>
#include <psibase/db.hpp>
#include <psio/reflect.hpp>
#include <psio/schema.hpp>
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
      std::vector<std::uint32_t> path;
   };
   PSIO_REFLECT(FieldId, path)

   using IndexInfo = std::vector<FieldId>;

   struct TableInfo
   {
      std::optional<std::string>  name;
      std::uint16_t               table;
      psio::schema_types::AnyType type;
      std::vector<IndexInfo>      indexes;
   };
   PSIO_REFLECT(TableInfo, name, table, type, indexes)

   using ServiceDatabaseSchema = std::vector<TableInfo>;

   template <auto X, auto Y>
   constexpr bool is_equal_member = false;
   template <auto X>
   constexpr bool is_equal_member<X, X> = true;

   /// Represents the schema for a service
   struct ServiceSchema
   {
      psibase::AccountNumber service;
      psio::Schema           types;
      using ActionMap =
          std::map<std::string, psio::schema_types::FunctionType, CompareMethodNumber>;
      ActionMap actions;
      using EventMap = std::map<std::string, psio::schema_types::AnyType, CompareMethodNumber>;
      EventMap ui;
      EventMap history;
      EventMap merkle;

      std::optional<std::map<std::string, ServiceDatabaseSchema>> database;

     private:
      template <typename M>
      static auto makeParams(psio::SchemaBuilder&         builder,
                             std::span<const char* const> ref) -> psio::schema_types::Object
      {
         psio::schema_types::Object type;
         auto                       nameIter = ref.begin();
         auto                       nameEnd  = ref.end();
         auto                       i        = ref.size();
         forEachType(typename M::SimplifiedArgTypes{},
                     [&](auto* t)
                     {
                        std::string name =
                            nameIter == nameEnd ? "c" + std::to_string(i++) : *nameIter++;
                        type.members.push_back(
                            {std::move(name),
                             builder.insert<std::remove_cv_t<
                                 psio::remove_view_t<std::remove_pointer_t<decltype(t)>>>>()});
                     });
         return type;
      }
      template <typename T>
      static auto makeResult(psio::SchemaBuilder& builder)
          -> std::optional<psio::schema_types::AnyType>
      {
         if constexpr (std::is_void_v<T>)
         {
            return {};
         }
         else
         {
            return builder.insert<std::remove_cv_t<psio::remove_view_t<T>>>();
         }
      }
      template <typename T>
      static void makeActions(psio::SchemaBuilder&                       builder,
                              ActionMap&                                 out,
                              std::vector<psio::schema_types::AnyType*>& eventTypes)
      {
         std::size_t i = 0;
         psio::for_each_member_type(
             (typename psio::reflect<T>::member_functions*)nullptr,
             [&](auto member)
             {
                std::span<const char* const> names = psio::reflect<T>::member_function_names[i];
                using m                            = psio::MemberPtrType<decltype(member)>;
                auto [pos, inserted]               = out.try_emplace(
                    names[0],
                    psio::schema_types::FunctionType{makeParams<m>(builder, names.subspan(1)),
                                                     makeResult<typename m::ReturnType>(builder)});
                if (inserted)
                {
                   eventTypes.push_back(&pos->second.params);
                   if (pos->second.result)
                      eventTypes.push_back(&*pos->second.result);
                }
                ++i;
             });
      }
      template <typename T>
      static void makeEvents(psio::SchemaBuilder&                       builder,
                             EventMap&                                  out,
                             std::vector<psio::schema_types::AnyType*>& eventTypes)
      {
         std::size_t i = 0;
         psio::for_each_member_type((typename psio::reflect<T>::member_functions*)nullptr,
                                    [&](auto member)
                                    {
                                       std::span<const char* const> names =
                                           psio::reflect<T>::member_function_names[i];
                                       using m = psio::MemberPtrType<decltype(member)>;
                                       if constexpr (m::isFunction)
                                       {
                                          auto [pos, inserted] = out.try_emplace(
                                              names[0], makeParams<m>(builder, names.subspan(1)));
                                          if (inserted)
                                          {
                                             eventTypes.push_back(&pos->second);
                                          }
                                       }
                                       ++i;
                                    });
      }

      template <auto K, auto... M>
      static constexpr std::uint32_t get_member_index(psio::MemberList<M...>*)
      {
         std::uint32_t i = 0;
         for (bool found : {is_equal_member<M, K>...})
         {
            if (found)
               return i;
            ++i;
         }
         return i;
      }

      template <bool Last, auto K, typename T, typename M>
      static void makeKeyImpl(M T::*, FieldId&& prefix, IndexInfo& out)
      {
         static_assert(!std::is_function_v<M>,
                       "Member function keys not supported. Use CompositeKey instead.");
         prefix.path.push_back(
             get_member_index<K>((typename psio::reflect<T>::data_members*)nullptr));
         if constexpr (Last)
         {
            out.push_back(std::move(prefix));
         }
      }

      template <bool Last, auto K>
      static void makeNestedKeyImpl(NestedKey<>, FieldId&& prefix, IndexInfo& out)
      {
         if constexpr (Last)
         {
            out.push_back(std::move(prefix));
         }
      }

      template <bool Last, auto K, auto K0>
      static void makeKeyImpl(CompositeKey<K0>, FieldId&& prefix, IndexInfo& out)
      {
         makeKeyImpl<Last, K0>(K0, std::move(prefix), out);
      }

      template <bool Last, auto K, auto... KN>
      static void makeKeyImpl(CompositeKey<KN...>, FieldId&& prefix, IndexInfo& out)
      {
         static_assert(Last, "CompositeKey can only appear at the end of a NestedKey");

         std::size_t prefixLen = prefix.path.size();

         (makeKeyImpl<true, KN>(KN, FieldId(prefix), out), ...);
      }

      template <bool Last, auto K, auto K0>
      static void makeKeyImpl(NestedKey<K0>, FieldId&& prefix, IndexInfo& out)
      {
         makeKeyImpl<Last, K0>(K0, std::move(prefix), out);
      }

      template <bool Last, auto K, auto K0, auto... KN>
      static void makeKeyImpl(NestedKey<K0, KN...>, FieldId&& prefix, IndexInfo& out)
      {
         makeKeyImpl<false, K0>(K0, std::move(prefix), out);
         makeKeyImpl<Last, NestedKey<KN...>{}>(NestedKey<KN...>{}, std::move(prefix), out);
      }

      template <typename T, auto K>
      static IndexInfo makeKey()
      {
         IndexInfo result;
         makeKeyImpl<true, K>(K, {}, result);
         return result;
      }

      template <typename T, auto... K>
      static std::vector<IndexInfo> makeIndexes(Table<T, K...>*)
      {
         return std::vector<IndexInfo>{makeKey<T, K>()...};
      }

      template <typename T>
      static TableInfo makeTable(psio::SchemaBuilder& builder, std::uint16_t table)
      {
         return TableInfo{.name    = psio::get_type_name<T>(),
                          .table   = table,
                          .type    = builder.insert<typename T::value_type>(),
                          .indexes = makeIndexes((T*)nullptr)};
      }

      static constexpr const char* dbName(DbId db)
      {
         if (db == DbId::service)
            return "service";
         else if (db == DbId::writeOnly)
            return "writeOnly";
         else if (db == DbId::subjective)
            return "subjective";
         else
            abortMessage("db cannot be used in schema");
      }

      template <DbId db, typename... T>
      static void makeDatabase(psio::SchemaBuilder&                       builder,
                               ServiceSchema&                             out,
                               std::vector<psio::schema_types::AnyType*>& rowTypes,
                               DbTables<db, T...>*)
      {
         if (!out.database)
            out.database.emplace();
         constexpr auto name   = dbName(db);
         auto&          tables = (*out.database)[name];
         std::uint16_t  i      = 0;
         (tables.push_back(makeTable<T>(builder, i++)), ...);
         for (auto& t : tables)
         {
            rowTypes.push_back(&t.type);
         }
      }

      template <typename... T>
      static void makeDatabases(psio::SchemaBuilder&                       builder,
                                ServiceSchema&                             out,
                                std::vector<psio::schema_types::AnyType*>& rowTypes,
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
         std::vector<psio::schema_types::AnyType*> typeRefs;
         psio::SchemaBuilder                       builder;
         makeActions<T>(builder, result.actions, typeRefs);
         if constexpr (requires { typename T::Events::Ui; })
         {
            makeEvents<typename T::Events::Ui>(builder, result.ui, typeRefs);
         }
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
      const EventMap* getDb(psibase::DbId db) const
      {
         switch (db)
         {
            case psibase::DbId::uiEvent:
               return &ui;
            case psibase::DbId::merkleEvent:
               return &merkle;
            case psibase::DbId::historyEvent:
               return &history;
            default:
               return nullptr;
         }
      }

     public:
      const psio::schema_types::AnyType* getType(psibase::DbId db, MethodNumber event)
      {
         if (const auto* dbTypes = getDb(db))
            if (auto pos = dbTypes->find(event); pos != dbTypes->end())
               return pos->second.resolve(types);
         return nullptr;
      }
      std::vector<const psio::schema_types::AnyType*> eventTypes() const
      {
         std::vector<const psio::schema_types::AnyType*> result;
         for (const auto* m : {&ui, &history, &merkle})
         {
            for (const auto& [_, type] : *m)
            {
               result.push_back(&type);
            }
         }
         return result;
      }
      PSIO_REFLECT(ServiceSchema, service, types, actions, ui, history, merkle, database)
   };

   psio::schema_types::CustomTypes psibase_types();
}  // namespace psibase
