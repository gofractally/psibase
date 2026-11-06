#pragma once

#include <functional>
#include <psibase/AccountNumber.hpp>

namespace psibase
{
   struct ServiceSchema;
   using GetSchemaFn = std::function<const ServiceSchema*(AccountNumber)>;
   struct NoSchema
   {
      const ServiceSchema* operator()(AccountNumber) const { return nullptr; }
   };
}  // namespace psibase
