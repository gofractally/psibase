#pragma once
#include <psibase/Table.hpp>

namespace UserService
{
   struct InitializedRecord
   {
   };
   PSIO1_REFLECT(InitializedRecord);
   using InitTable = psibase::Table<InitializedRecord, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(InitTable)

}  // namespace UserService
