#include <psibase/schema.hpp>

#include <psibase/time.hpp>

psio::schema_types::CustomTypes psibase::psibase_types()
{
   auto result = psio::schema_types::standard_types();
   result.insert<AccountNumber>("AccountNumber");
   return result;
}
