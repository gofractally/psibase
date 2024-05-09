#pragma once

#include <psio/schema.hpp>

namespace UserService
{
   extern const psio::schema_types::CustomTypes  psibase_builtins;
   extern const psio::schema_types::CompiledType u64;

   struct EventWrapper
   {
      EventWrapper(const EventWrapper&) = delete;
      explicit EventWrapper(psio::schema_types::CompiledType* event = nullptr);
      void set(const psio::schema_types::CompiledType* event) { wrapper.children[2].type = event; }
      const psio::schema_types::CompiledType* get() const { return &wrapper; }
      psio::schema_types::CompiledType        wrapper;
   };
}  // namespace UserService
