#pragma once

#include <psibase/AccountNumber.hpp>

namespace psibase
{
   inline psio::schema_types::CustomTypes psibase_types()
   {
      auto result = psio::schema_types::standard_types();
      result.insert<AccountNumber>("AccountNumber");
      return result;
   }
}  // namespace psibase
