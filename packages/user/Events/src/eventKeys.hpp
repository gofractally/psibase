#pragma once

#include <cstddef>
#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/db.hpp>
#include <psio/to_key.hpp>
#include <services/user/EventsTables.hpp>
#include <vector>

namespace UserService
{

   struct EventIndexTable
   {
      psibase::DbId          db;
      psibase::AccountNumber service;
      psibase::MethodNumber  event;
   };

   void to_key(const EventIndexTable& obj, auto& stream)
   {
      psio::to_key(psibase::AccountNumber{"event-index"}, stream);
      psio::to_key(eventIndexesNum, stream);
      psio::to_key(obj.db, stream);
      psio::to_key(obj.service, stream);
      psio::to_key(obj.event, stream);
   }

   std::uint64_t keyToEventId(const std::vector<char>& key, std::size_t prefixLen = 0);

}  // namespace UserService
