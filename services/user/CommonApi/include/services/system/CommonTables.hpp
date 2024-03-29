#pragma once
#include <psibase/Table.hpp>

namespace UserService
{
   struct InitializedRecord
   {
      psibase::SingletonKey key;
   };
   PSIO_REFLECT(InitializedRecord, key);
   using InitTable = psibase::Table<InitializedRecord, &InitializedRecord::key>;

}  // namespace UserService
