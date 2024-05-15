#include "types.hpp"

#include <psibase/schema.hpp>

using namespace psio::schema_types;

namespace UserService
{

   const CustomTypes psibase_builtins = psibase::psibase_types();

   const AnyType u64Type = Int{.bits = 64, .isSigned = false};

   const CompiledType u64{
       .kind             = CompiledType::scalar,
       .is_variable_size = false,
       .fixed_size       = 8,
       .original_type    = &u64Type,
   };

   EventWrapper::EventWrapper(CompiledType* event)
       : wrapper{.kind       = CompiledType::object,
                 .fixed_size = 16,
                 .children   = {{.fixed_offset = 0, .is_optional = false, .type = &u64},
                                {.fixed_offset = 8, .is_optional = true, .type = &u64},
                                {.fixed_offset = 12, .is_optional = true, .type = event}}}
   {
   }
}  // namespace UserService
