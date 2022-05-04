#pragma once

#include <psibase/ExecutionContext.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   struct system_context
   {
      SharedDatabase               sharedDatabase;
      psibase::WasmCache           wasmCache;
      std::vector<ExecutionMemory> executionMemories;

      void set_num_memories(size_t n)
      {
         if (n < executionMemories.size())
            executionMemories.resize(n);
         executionMemories.reserve(n);
         while (n > executionMemories.size())
            executionMemories.push_back({});
      }
   };  // system_context

   struct shared_state_impl;
   struct shared_state
   {
      const std::unique_ptr<shared_state_impl> impl;

      shared_state(SharedDatabase db, psibase::WasmCache wasmCache);
      ~shared_state();

      std::unique_ptr<system_context> get_system_context();
      void                            add_system_context(std::unique_ptr<system_context> context);
   };
}  // namespace psibase
