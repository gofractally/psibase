#pragma once

#include <psio/reflect.hpp>

namespace psibase
{
   template <auto eventHead, psio::FixedString eventPtrField>
   struct EventIndex
   {
      using EventIndexFailed = std::false_type;
      static_assert(sizeof(decltype(eventPtrField)) != sizeof(decltype(eventPtrField)),
                    "Failed to extract eventHead and eventPtrField from EventIndex definition");
   };

   // EventIndex creates a mapping used to serve a custom index of historical events
   //   over an RPC interface.
   template <typename RecordType,
             typename KeyType,
             KeyType RecordType::*eventHead,
             psio::FixedString    eventPtrField>
   struct EventIndex<eventHead, eventPtrField>
   {
      using Record                             = RecordType;
      static constexpr auto             evHead = eventHead;
      static constexpr std::string_view prevField{(std::string_view)eventPtrField};

      static void updateEventHead(RecordType& record, KeyType eventHeadId)
      {
         record.*evHead = eventHeadId;
      }

      static KeyType getEventHead(const RecordType& record) { return record.*evHead; }
   };
}  // namespace psibase
