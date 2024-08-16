#pragma once

#include <map>
#include <optional>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/db.hpp>
#include <psio/reflect.hpp>
#include <psio/schema.hpp>
#include <string>
#include <type_traits>
#include <vector>

namespace psibase
{
   /// Represents the schema for a service
   struct ServiceSchema
   {
      psibase::AccountNumber service;
      psio::Schema           types;
      using ActionMap = std::map<psibase::MethodNumber, psio::schema_types::FunctionType>;
      ActionMap actions;
      using EventMap = std::map<psibase::MethodNumber, psio::schema_types::AnyType>;
      EventMap ui;
      EventMap history;
      EventMap merkle;

     private:
      template <typename M>
      static auto makeParams(psio::SchemaBuilder& builder, const psio::meta& ref)
          -> psio::schema_types::Object
      {
         psio::schema_types::Object type;
         auto                       nameIter = ref.param_names.begin();
         auto                       nameEnd  = ref.param_names.end();
         auto                       i        = ref.param_names.size();
         forEachType(
             typename M::SimplifiedArgTypes{},
             [&](auto* t)
             {
                std::string name = nameIter == nameEnd ? "c" + std::to_string(i++) : *nameIter++;
                type.members.push_back(
                    {std::move(name), builder.insert<std::remove_pointer_t<decltype(t)>>()});
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
            return builder.insert<T>();
         }
      }
      template <typename T>
      static void makeActions(psio::SchemaBuilder&                       builder,
                              ActionMap&                                 out,
                              std::vector<psio::schema_types::AnyType*>& eventTypes)
      {
         psio::reflect<T>::for_each(
             [&](const psio::meta& ref, auto member)
             {
                using m = psio::MemberPtrType<decltype(member(std::declval<T*>()))>;
                if constexpr (m::isFunction)
                {
                   auto [pos, inserted] =
                       out.try_emplace(psibase::MethodNumber{ref.name},
                                       psio::schema_types::FunctionType{
                                           makeParams<m>(builder, ref),
                                           makeResult<typename m::ReturnType>(builder)});
                   if (inserted)
                   {
                      eventTypes.push_back(&pos->second.params);
                      if (pos->second.result)
                         eventTypes.push_back(&*pos->second.result);
                   }
                }
             });
      }
      template <typename T>
      static void makeEvents(psio::SchemaBuilder&                       builder,
                             EventMap&                                  out,
                             std::vector<psio::schema_types::AnyType*>& eventTypes)
      {
         psio::reflect<T>::for_each(
             [&](const psio::meta& ref, auto member)
             {
                using m = psio::MemberPtrType<decltype(member(std::declval<T*>()))>;
                if constexpr (m::isFunction)
                {
                   auto [pos, inserted] = out.try_emplace(psibase::MethodNumber{ref.name},
                                                          makeParams<m>(builder, ref));
                   if (inserted)
                   {
                      eventTypes.push_back(&pos->second);
                   }
                }
             });
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
      const psio::schema_types::AnyType* getType(psibase::DbId db, psibase::MethodNumber event)
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
   };
   PSIO_REFLECT(ServiceSchema, service, types, actions, ui, history, merkle)

   inline psio::schema_types::CustomTypes psibase_types()
   {
      auto result = psio::schema_types::standard_types();
      result.insert<AccountNumber>("AccountNumber");
      return result;
   }
}  // namespace psibase
