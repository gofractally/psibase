#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/nativeTables.hpp>
#include <vector>

namespace LocalService
{
   struct XDb : psibase::Service
   {
      static constexpr auto   service = psibase::AccountNumber{"x-db"};
      static constexpr auto   flags   = psibase::CodeRow::isPrivileged;
      psibase::UniqueKvHandle open(psibase::DbId                       db,
                                   psio::view<const std::vector<char>> prefix,
                                   psibase::KvMode                     mode);
   };
   PSIO_REFLECT(XDb, method(open, db, prefix, mode))
}  // namespace LocalService
