#pragma once

#include <psibase/ExecutionContext.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   struct system_context
   {
      shared_database               shared_db;
      psibase::wasm_cache           wasm_cache;
      std::vector<execution_memory> execution_memories;

      void set_num_memories(size_t n)
      {
         if (n < execution_memories.size())
            execution_memories.resize(n);
         execution_memories.reserve(n);
         while (n > execution_memories.size())
            execution_memories.push_back({});
      }
   };  // system_context

   struct shared_state_impl;
   struct shared_state
   {
      const std::unique_ptr<shared_state_impl> impl;

      shared_state(shared_database db, psibase::wasm_cache wasm_cache);
      ~shared_state();

      std::unique_ptr<system_context> get_system_context();
      void                            add_system_context(std::unique_ptr<system_context> context);
   };
}  // namespace psibase
