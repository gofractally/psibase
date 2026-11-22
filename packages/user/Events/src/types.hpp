#pragma once

#include <psio1/schema.hpp>

namespace UserService
{
   extern const psio1::schema_types::CustomTypes  psibase_builtins;
   extern const psio1::schema_types::CompiledType u64;

   struct EventWrapper
   {
      EventWrapper(const EventWrapper&) = delete;
      explicit EventWrapper(psio1::schema_types::CompiledType* event = nullptr);
      void set(const psio1::schema_types::CompiledType* event) { wrapper.children[2].type = event; }
      const psio1::schema_types::CompiledType* get() const { return &wrapper; }
      psio1::schema_types::CompiledType        wrapper;
   };
}  // namespace UserService
