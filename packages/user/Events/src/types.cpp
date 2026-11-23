#include "types.hpp"

#include <psibase/check.hpp>

namespace st = psio::schema_types;

namespace UserService
{
   const psio::pssz_ir::CustomHandlers& psibase_builtins()
   {
      static const psio::pssz_ir::CustomHandlers result = psibase::psibase_types();
      return result;
   }

   namespace
   {
      const st::AnyType* follow(const st::Schema& types, const st::AnyType* type)
      {
         if (std::holds_alternative<st::Type>(type->value))
            type = type->resolve(types);
         psibase::check(type != nullptr, "Failed to resolve type");
         return type;
      }

      // An id that means something to this service; any other custom id
      // names a type it has no presentation for and is its wire type.
      bool knownId(std::string_view id)
      {
         return psio::pssz_ir::detail::wire_custom_id(id) || psio::reserved_custom_id(id) ||
                psibase_builtins().find(id) != nullptr;
      }

      EventColumn makeColumn(const st::Schema& types, std::string name, const st::AnyType& member)
      {
         EventColumn result{.name     = std::move(name),
                            .type     = &member,
                            .optional = false,
                            .value    = &member,
                            .kind     = ColumnKind::json,
                            .scalar   = nullptr};
         const st::AnyType* type = follow(types, &member);
         if (auto* option = std::get_if<st::Option>(&type->value))
         {
            result.optional = true;
            result.value    = option->type.get();
            type            = follow(types, result.value);
         }
         // A schema that passed checkValid has no alias cycle
         while (auto* custom = std::get_if<st::Custom>(&type->value))
         {
            if (knownId(custom->id))
            {
               if (custom->id == "bool")
                  result.kind = ColumnKind::boolean;
               else if (custom->id == "string" || custom->id == "utf8")
                  result.kind = ColumnKind::text;
               else if (custom->id == "hex")
                  result.kind = ColumnKind::blob;
               else if (custom->id == "AccountNumber")
                  result.kind = ColumnKind::account;
               return result;
            }
            type = follow(types, custom->type.get());
         }
         if (auto* integer = std::get_if<st::Int>(&type->value); integer && integer->bits <= 64)
         {
            result.kind   = ColumnKind::integer;
            result.scalar = type;
         }
         else if (std::holds_alternative<st::Float>(type->value))
         {
            result.kind   = ColumnKind::real;
            result.scalar = type;
         }
         return result;
      }

      // The SQL name of a column: the parameter's name; a parameter the
      // event does not name (the members of a positional argument list are
      // "0", "1", ...) is c0, c1, ...
      std::string columnName(const std::string& name, std::size_t index)
      {
         if (name.empty() || (name[0] >= '0' && name[0] <= '9'))
            return "c" + std::to_string(index);
         return name;
      }
   }  // namespace

   EventSchema makeEventSchema(const st::Schema& types, const st::AnyType& type)
   {
      EventSchema        result{.types = &types, .type = &type};
      const st::AnyType* resolved = follow(types, &type);
      auto               members  = [&](const auto& list)
      {
         std::size_t i = 0;
         for (const auto& member : list)
         {
            result.columns.push_back(makeColumn(types, columnName(member.name, i), *member.type));
            ++i;
         }
      };
      if (auto* object = std::get_if<st::Object>(&resolved->value))
         members(object->members);
      else if (auto* record = std::get_if<st::Struct>(&resolved->value))
         members(record->members);
      else if (auto* tuple = std::get_if<st::Tuple>(&resolved->value))
      {
         std::size_t i = 0;
         for (const auto& member : tuple->members)
         {
            result.columns.push_back(makeColumn(types, "c" + std::to_string(i), *member));
            ++i;
         }
      }
      else
         psibase::abortMessage("Unsupported row type: " + psio::to_ijson(*resolved));
      return result;
   }

   namespace
   {
      std::size_t memberCount(const psio::pssz_ir::Value& event)
      {
         if (auto* record = std::get_if<psio::pssz_ir::Record>(&event.value))
            return record->size();
         if (auto* sequence = std::get_if<psio::pssz_ir::Sequence>(&event.value))
            return sequence->size();
         return ~std::size_t{0};
      }
   }  // namespace

   bool decodeEvent(const EventSchema& type, std::span<const char> data, psio::pssz_ir::Value& out)
   {
      bool unknown = false;
      return psio::pssz_ir::decode_auto(*type.types, *type.type, data, out, unknown).ok() &&
             memberCount(out) == type.columns.size();
   }

   const psio::pssz_ir::Value& eventMember(const psio::pssz_ir::Value& event, std::size_t column)
   {
      if (auto* record = std::get_if<psio::pssz_ir::Record>(&event.value))
         return (*record)[column].second;
      return std::get<psio::pssz_ir::Sequence>(event.value)[column];
   }

   const EventColumn& eventNumberColumn()
   {
      static const st::AnyType type   = st::Int{.bits = 64, .isSigned = false};
      static const EventColumn result = {.name     = "rowid",
                                         .type     = &type,
                                         .optional = false,
                                         .value    = &type,
                                         .kind     = ColumnKind::integer,
                                         .scalar   = &type};
      return result;
   }
}  // namespace UserService
