#pragma once

// TODO: This is duplicated from eos-vm

#include <eosio/vm/types.hpp>

namespace debug_eos_vm
{

   struct function_parameters
   {
      function_parameters() = default;
      function_parameters(const eosio::vm::func_type* ft)
      {
         uint32_t current_offset = 16;
         offsets.resize(ft->param_types.size());
         for (uint32_t i = 0; i < ft->param_types.size(); ++i)
         {
            if (current_offset > 0x7fffffffu)
            {
               // cannot represent the offset as a 32-bit immediate
               throw std::runtime_error("Not implemented");
            }
            offsets[offsets.size() - i - 1] = current_offset;
            if (ft->param_types[ft->param_types.size() - i - 1] == eosio::vm::types::v128)
            {
               current_offset += 16;
            }
            else
            {
               current_offset += 8;
            }
         }
      }
      int32_t               get_frame_offset(uint32_t localidx) const { return offsets[localidx]; }
      std::vector<uint32_t> offsets;
   };

   struct function_locals
   {
      function_locals() = default;
      function_locals(const std::vector<eosio::vm::local_entry>& params)
      {
         uint32_t offset       = 0;
         int32_t  frame_offset = 0;
         for (uint32_t i = 0; i < params.size(); ++i)
         {
            uint8_t size = params[i].type == eosio::vm::types::v128 ? 16 : 8;
            offset += params[i].count;
            if (-0x80000000ll + static_cast<int64_t>(size) * static_cast<int64_t>(params[i].count) >
                frame_offset)
            {
               throw std::runtime_error("Not implemented");
            }
            frame_offset -= size * params[i].count;
            groups.push_back({offset, frame_offset, size});
         }
      }
      struct entry
      {
         uint32_t end;
         int32_t  end_offset;
         uint8_t  elem_size;
      };
      int32_t get_frame_offset(uint32_t paramidx) const
      {
         auto pos = std::partition_point(groups.begin(), groups.end(),
                                         [=](const auto& e) { return paramidx >= e.end; });
         if (pos == groups.end())
         {
            throw std::runtime_error("Unknown local index");
         }
         return (pos->end_offset + (pos->end - paramidx - 1) * pos->elem_size);
      }
      std::vector<entry> groups;
   };

   struct wasm_frame
   {
      wasm_frame(const eosio::vm::module& mod, std::uint32_t idx)
          : _params(&mod.types[mod.functions[idx]]), _locals{mod.code[idx].locals}
      {
      }
      int32_t get_frame_offset(uint32_t local_idx) const
      {
         if (local_idx < _params.offsets.size())
         {
            return _params.get_frame_offset(local_idx);
         }
         else
         {
            return _locals.get_frame_offset(local_idx - _params.offsets.size());
         }
      }
      int32_t get_stack_offset(uint32_t stack_idx) const
      {
         // TODO: This doesn't work correctly if there are v128 items on the stack
         int32_t result = -8 * (stack_idx + 1);
         if (!_locals.groups.empty())
         {
            result += _locals.groups.back().end_offset;
         }
         return result;
      }
      function_parameters _params;
      function_locals     _locals;
   };
}  // namespace debug_eos_vm
