// This negative fixture must fail compilation with the duplicate-name diagnostic.
#include <psio/reflect.hpp>
struct DuplicateActionName
{
   void example() {}
   void Example() {}
};
PSIO_REFLECT(DuplicateActionName, method(example), method(Example))
using Reflection = psio::reflect<DuplicateActionName>;
static_assert(Reflection::is_defined);
