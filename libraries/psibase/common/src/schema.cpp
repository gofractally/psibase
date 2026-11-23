#include <psibase/schema.hpp>

#include <psibase/check.hpp>

namespace st = psio::schema_types;

psio::pssz_ir::CustomHandlers psibase::psibase_types()
{
   psio::pssz_ir::CustomHandlers result;
   result.add<AccountNumber>();
   result.add<MethodNumber>();
   return result;
}

const st::AnyType* psibase::getFieldType(const st::Schema&              schema,
                                         const st::AnyType&             type,
                                         std::span<const std::uint32_t> path,
                                         const char*&                   msg)
{
   // Named types and custom wrappers are followed; a schema that passed
   // validate_schema has no alias cycle, and the hop count bounds one that
   // did not.
   auto peel = [&](const st::AnyType* t) -> const st::AnyType*
   {
      for (std::size_t hops = 0; t && hops <= 2 * schema.types.size() + 64; ++hops)
      {
         if (std::holds_alternative<st::Type>(t->value))
            t = t->resolve(schema);
         else if (auto* custom = std::get_if<st::Custom>(&t->value))
            t = custom->type.get();
         else
            return t;
      }
      return nullptr;
   };
   const st::AnyType* result = &type;
   for (auto idx : path)
   {
      result = peel(result);
      if (!result)
      {
         msg = "Failed to resolve type";
         return nullptr;
      }
      auto member = [&](const auto& members) -> const st::AnyType*
      {
         if (idx >= members.size())
         {
            msg = "Field index out of range";
            return nullptr;
         }
         return members[idx].type.get();
      };
      if (auto* object = std::get_if<st::Object>(&result->value))
         result = member(object->members);
      else if (auto* record = std::get_if<st::Struct>(&result->value))
         result = member(record->members);
      else if (auto* tuple = std::get_if<st::Tuple>(&result->value))
      {
         if (idx >= tuple->members.size())
         {
            msg = "Field index out of range";
            return nullptr;
         }
         result = tuple->members[idx].get();
      }
      else
      {
         msg = "Can only extract fields of Tuple, Struct, or Object";
         return nullptr;
      }
      if (!result)
      {
         msg = "Failed to resolve type";
         return nullptr;
      }
   }
   return result;
}

namespace
{
   // A node outside `types.types` (an action's parameters, a row type) is
   // well-formed when its metadata is: auto_width checks exactly that.
   void checkType(const st::Schema& types, const st::AnyType& type, std::string_view what)
   {
      std::size_t width = 0;
      if (auto status = psio::pssz_ir::auto_width(types, type, width); !status.ok())
         psibase::abortMessage("Invalid schema: " + std::string(what) + ": " +
                               std::string(status.error().what));
   }

   void checkEvents(const st::Schema& types, const psibase::ServiceSchema::EventMap& events)
   {
      for (const auto& [name, type] : events)
      {
         checkType(types, type.type, "event " + name);
         if (type.access != "public" && type.access != "private")
         {
            psibase::abortMessage("Invalid access: " + type.access);
         }
      }
   }
}  // namespace

auto psibase::ServiceSchema::findAction(MethodNumber method) const -> const ActionMap::value_type*
{
   // The exact name first: the usual case, and the map is ordered by name.
   if (auto pos = actions.find(method.str());
       pos != actions.end() && MethodNumber{pos->first} == method)
      return &*pos;
   for (const auto& entry : actions)
      if (MethodNumber{entry.first} == method)
         return &entry;
   return nullptr;
}

auto psibase::ServiceSchema::findEvent(psibase::EventDb db,
                                       MethodNumber     event) const -> const EventMap::value_type*
{
   const EventMap* events = nullptr;
   switch (db)
   {
      case psibase::EventDb::merkleEvent:
         events = &merkle;
         break;
      case psibase::EventDb::historyEvent:
         events = &history;
         break;
      default:
         return nullptr;
   }
   if (auto pos = events->find(event.str());
       pos != events->end() && MethodNumber{pos->first} == event)
      return &*pos;
   for (const auto& entry : *events)
      if (MethodNumber{entry.first} == event)
         return &entry;
   return nullptr;
}

const st::AnyType* psibase::ServiceSchema::getType(bool             canReadPrivate,
                                                   psibase::EventDb db,
                                                   MethodNumber     event) const
{
   if (const auto* found = findEvent(db, event);
       found && (canReadPrivate || found->second.access == "public"))
      return &found->second.type;
   return nullptr;
}

std::vector<const st::AnyType*> psibase::ServiceSchema::eventTypes() const
{
   std::vector<const st::AnyType*> result;
   for (const auto* m : {&history, &merkle})
   {
      for (const auto& [_, type] : *m)
      {
         result.push_back(&type.type);
      }
   }
   return result;
}

void psibase::ServiceSchema::checkValid() const
{
   if (auto status = psio::pssz_ir::validate_schema(types); !status.ok())
      abortMessage("Invalid schema: " + std::string(status.error().what));
   for (const auto& [name, type] : actions)
   {
      checkType(types, *type.params, "action " + name);
      if (type.result)
         checkType(types, **type.result, "result of action " + name);
   }
   checkEvents(types, history);
   checkEvents(types, merkle);
   if (database)
   {
      for (const auto& [name, db] : *database)
      {
         for (const TableInfo& table : db)
         {
            checkType(types, table.type, "table " + name + "::" + table.str());
            for (const IndexInfo& index : table.indexes)
            {
               for (const FieldId& field : index)
               {
                  const char* msg = nullptr;
                  if (!getFieldType(types, table.type, field.path, msg))
                     abortMessage("In table " + name + "::" + table.str() + ": " + msg);
                  if (field.type)
                     checkType(types, *field.type, "key of table " + name + "::" + table.str());
               }
            }
         }
      }
   }
}
