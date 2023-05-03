#pragma once
#include <debug_eos_vm/dwarf.hpp>
#include <eosio/vm/backend.hpp>

namespace debug_eos_vm
{
   struct debug_instr_map
   {
      using builder = debug_instr_map;

      const void* code_begin = nullptr;
      const void* wasm_begin = nullptr;
      size_t      wasm_size  = 0;
      size_t      code_size  = 0;

      dwarf::jit_info             locs;
      const dwarf::jit_instr_loc* offset_to_addr     = nullptr;
      std::size_t                 offset_to_addr_len = 0;

      uint32_t code_offset(const void* p)
      {
         return reinterpret_cast<const char*>(p) - reinterpret_cast<const char*>(code_begin);
      }

      uint32_t wasm_offset(const void* p)
      {
         return reinterpret_cast<const char*>(p) - reinterpret_cast<const char*>(wasm_begin);
      }

      void on_code_start(const void* code_addr, const void* wasm_addr)
      {
         code_begin = code_addr;
         wasm_begin = wasm_addr;
      }

      void on_function_start(const void* code_addr, const void* wasm_addr)
      {
         locs.fn_locs.emplace_back();
         locs.fn_locs.back().code_prologue = code_offset(code_addr);
         locs.fn_locs.back().wasm_begin    = wasm_offset(wasm_addr);
         on_instr_start(code_addr, wasm_addr);
      }

      void on_function_end(const void* code_addr, const void* wasm_addr)
      {
         locs.fn_locs.back().code_end = code_offset(code_addr);
         locs.fn_locs.back().wasm_end = wasm_offset(wasm_addr);
      }

      void on_instr_start(const void* code_addr, const void* wasm_addr)
      {
         locs.instr_locs.push_back({code_offset(code_addr), wasm_offset(wasm_addr)});
      }

      void on_code_end(const void* code_addr, const void* wasm_addr)
      {
         code_size = (const char*)code_addr - (const char*)code_begin;
         wasm_size = (const char*)wasm_addr - (const char*)wasm_begin;
         on_instr_start(code_addr, wasm_addr);
      }

      void set(builder&& b)
      {
         *this = std::move(b);

         {
            uint32_t code = 0;
            uint32_t wasm = 0;
            for (auto& fn : locs.fn_locs)
            {
               EOS_VM_ASSERT(code <= fn.code_prologue &&  //
                                 fn.code_prologue <= fn.code_end,
                             eosio::vm::profile_exception, "function parts are out of order");
               EOS_VM_ASSERT(wasm <= fn.wasm_begin && fn.wasm_begin <= fn.wasm_end,
                             eosio::vm::profile_exception, "function wasm is out of order");
               code = fn.code_end;
               wasm = fn.wasm_end;
            }
         }

         {
            uint32_t code = 0;
            uint32_t wasm = 0;
            for (auto& instr : locs.instr_locs)
            {
               EOS_VM_ASSERT(code <= instr.code_offset, eosio::vm::profile_exception,
                             "jit instructions are out of order");
               EOS_VM_ASSERT(wasm <= instr.wasm_addr, eosio::vm::profile_exception,
                             "jit instructions are out of order");
               code = instr.code_offset;
               wasm = instr.wasm_addr;
            }
         }

         offset_to_addr     = locs.instr_locs.data();
         offset_to_addr_len = locs.instr_locs.size();
      }

      void relocate(const void* new_base) { code_begin = new_base; }

      std::uint32_t translate(const void* pc) const
      {
         std::size_t diff = (reinterpret_cast<const char*>(pc) -
                             reinterpret_cast<const char*>(code_begin));  // negative values wrap
         if (diff >= code_size || diff < offset_to_addr[0].code_offset)
            return 0xFFFFFFFFu;
         std::uint32_t code_offset = diff;

         // Loop invariant: offset_to_addr[lower].code_offset <= code_offset < offset_to_addr[upper].code_offset
         std::size_t lower = 0, upper = offset_to_addr_len;
         while (upper - lower > 1)
         {
            std::size_t mid = lower + (upper - lower) / 2;
            if (offset_to_addr[mid].code_offset <= code_offset)
               lower = mid;
            else
               upper = mid;
         }

         return offset_to_addr[lower].wasm_addr;
      }
   };  // debug_instr_map

   template <typename Backend>
   std::shared_ptr<dwarf::debugger_registration> enable_debug(std::vector<uint8_t>& code,
                                                              Backend&              backend,
                                                              dwarf::info&          dwarf_info,
                                                              psio::input_stream    wasm_source)
   {
      auto& module = backend.get_module();
      auto& alloc  = module.allocator;
      auto& dbg    = backend.get_debug();
      return dwarf::register_with_debugger(dwarf_info, dbg.locs, module, wasm_source);
   }
}  // namespace debug_eos_vm
