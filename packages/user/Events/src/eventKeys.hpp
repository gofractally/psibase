#pragma once

#include <cstddef>
#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/db.hpp>
#include <psio/key.hpp>
#include <services/user/EventsTables.hpp>
#include <vector>

namespace UserService
{

   // The key of an event's index table: its members, in order.
   struct EventIndexTable
   {
      EventDb                db;
      psibase::AccountNumber service;
      psibase::MethodNumber  event;
      PSIO_REFLECT(EventIndexTable, db, service, event)
   };

   std::uint64_t keyToEventId(const std::vector<char>& key, std::size_t prefixLen = 0);

   struct EventIndexHandle
   {
      explicit EventIndexHandle(psibase::KvMode mode);
                              operator psibase::KvHandle() const { return value; }
      psibase::UniqueKvHandle value;
   };

}  // namespace UserService
