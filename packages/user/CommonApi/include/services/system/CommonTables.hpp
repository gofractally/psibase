#pragma once
#include <psibase/Table.hpp>

namespace UserService
{
   struct InitializedRecord
   {
   };
   PSIO_REFLECT(InitializedRecord);
   using InitTable = psibase::Table<InitializedRecord, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(InitTable)

}  // namespace UserService
