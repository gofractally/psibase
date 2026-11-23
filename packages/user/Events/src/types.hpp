#pragma once

#include <psibase/schema.hpp>
#include <string>
#include <vector>

namespace UserService
{
   /// The handlers of the custom types of a psibase schema
   /// (`psibase::psibase_types()`)
   const psio::pssz_ir::CustomHandlers& psibase_builtins();

   /// How a column of an event is presented in SQL
   enum class ColumnKind
   {
      integer,  ///< an integer of at most 64 bits: INTEGER (REAL above 2^63 - 1)
      real,     ///< float or double: REAL
      boolean,  ///< INTEGER 0 or 1
      text,     ///< a string (raw or UTF-8): TEXT
      blob,     ///< bytes: BLOB
      account,  ///< AccountNumber: TEXT with the collation ACCOUNT
      json,     ///< anything else: its JSON text
   };

   /// One column of an event: one parameter of its argument list
   struct EventColumn
   {
      std::string                        name;
      const psio::schema_types::AnyType* type;      ///< as the event declares it
      bool                               optional;  ///< `type` is an Option
      const psio::schema_types::AnyType* value;     ///< the type under the Option
      ColumnKind                         kind;
      const psio::schema_types::AnyType* scalar;    ///< the Int / Float node of a number
   };

   /// The argument list of an event, by its service's schema
   struct EventSchema
   {
      const psio::schema_types::Schema*  types;
      const psio::schema_types::AnyType* type;
      std::vector<EventColumn>           columns;
   };

   EventSchema makeEventSchema(const psio::schema_types::Schema&  types,
                               const psio::schema_types::AnyType& type);

   /// Decodes the packed arguments of an event. False if the bytes are not
   /// an argument list of the event.
   bool decodeEvent(const EventSchema& type, std::span<const char> data, psio::pssz_ir::Value& out);
   /// One argument of a decoded event
   const psio::pssz_ir::Value& eventMember(const psio::pssz_ir::Value& event, std::size_t column);

   /// The column of the event number (the primary key of every event table)
   const EventColumn& eventNumberColumn();
}  // namespace UserService
