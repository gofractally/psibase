#include <psibase/schema.hpp>

#include <psibase/time.hpp>

psio::schema_types::CustomTypes psibase::psibase_types()
{
   auto result = psio::schema_types::standard_types();
   result.insert<AccountNumber>("AccountNumber");
   result.insert<MethodNumber>("MethodNumber");
   return result;
}

namespace
{
   const psio::schema_types::AnyType* getFieldType(const psio::schema_types::Object& ty,
                                                   std::uint32_t                     index,
                                                   const char*&                      msg)
   {
      if (index >= ty.members.size())
      {
         msg = "Field index out of range";
         return nullptr;
      }
      return &ty.members[index].type;
   }
   const psio::schema_types::AnyType* getFieldType(const psio::schema_types::Struct& ty,
                                                   std::uint32_t                     index,
                                                   const char*&                      msg)
   {
      if (index >= ty.members.size())
      {
         msg = "Field index out of range";
         return nullptr;
      }
      return &ty.members[index].type;
   }
   const psio::schema_types::AnyType* getFieldType(const psio::schema_types::Tuple& ty,
                                                   std::uint32_t                    index,
                                                   const char*&                     msg)
   {
      if (index >= ty.members.size())
      {
         msg = "Field index out of range";
         return nullptr;
      }
      return &ty.members[index];
   }
   const psio::schema_types::AnyType* getFieldType(const auto&   ty,
                                                   std::uint32_t index,
                                                   const char*&  msg)
   {
      msg = "Can only extract fields of Tuple, Struct, or Object";
      return nullptr;
   }

   const psio::schema_types::AnyType* getFieldType(const psio::Schema&                schema,
                                                   const psio::schema_types::AnyType& ty,
                                                   const psibase::FieldId&            field,
                                                   const char*&                       msg)
   {
      const psio::schema_types::AnyType* result = &ty;
      for (auto idx : field.path)
      {
         result = result->resolve(schema);
         if (!result)
            psibase::abortMessage("Failed to resolve type");
         result =
             std::visit([&](const auto& t) { return getFieldType(t, idx, msg); }, result->value);
         if (!result)
            return nullptr;
      }
      return result;
   }

   void checkEvents(const psio::Schema& types, const psibase::ServiceSchema::EventMap& events)
   {
      for (const auto& [name, type] : events)
      {
         types.checkType(type.type);
         if (type.access != "public" && type.access != "private")
         {
            psibase::abortMessage("Invalid access: " + type.access);
         }
      }
   }
}  // namespace

void psibase::ServiceSchema::checkValid() const
{
   for (const auto& [name, type] : types.types)
   {
      types.checkType(type);
   }
   for (const auto& [name, type] : actions)
   {
      types.checkType(type.params);
      if (type.result)
         types.checkType(*type.result);
   }
   checkEvents(types, ui);
   checkEvents(types, history);
   checkEvents(types, merkle);
   if (database)
   {
      for (const auto& [name, db] : *database)
      {
         for (const TableInfo& table : db)
         {
            types.checkType(table.type);
            for (const IndexInfo& index : table.indexes)
            {
               for (const FieldId& field : index)
               {
                  const char* msg = nullptr;
                  if (!getFieldType(types, table.type, field, msg))
                     abortMessage("In table " + name + "::" + table.str() + ": " + msg);
               }
            }
         }
      }
   }
}
