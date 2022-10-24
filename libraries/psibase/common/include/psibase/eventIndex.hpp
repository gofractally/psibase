#pragma once

namespace psibase
{
   // This does nothing, but causes an error when called from a `consteval` function.
   inline void expectedNullTerminatedArray() {}

   // StringLiteral idea taken from:
   // https://stackoverflow.com/questions/68024563/passing-a-string-literal-to-a-template-char-array-parameter
   template <size_t N>
   struct StringLiteral
   {
      char str[N]{};

      static constexpr size_t size = N - 1;

      consteval StringLiteral() {}
      consteval StringLiteral(const char (&new_str)[N])
      {
         if (new_str[N - 1] != '\0')
            expectedNullTerminatedArray();
         std::copy_n(new_str, size, str);
      }
   };

   template <auto eventHead, StringLiteral eventPtrField>
   struct EventIndex
   {
      using EventIndexFailed = std::false_type;
      // type-dependent expression silences failure unless instantiated
      static_assert(decltype(eventPtrField)::size != decltype(eventPtrField)::size,
                    "Failed to extract eventHead and eventPtrField from EventIndex definition");
   };

   // EventIndex creates a mapping used to serve a custom index of historical events
   //   over an RPC interface.
   template <typename RecordType,
             typename KeyType,
             KeyType RecordType::*eventHead,
             StringLiteral        eventPtrField>
   struct EventIndex<eventHead, eventPtrField>
   {
      using Record                             = RecordType;
      static constexpr auto             evHead = eventHead;
      static constexpr std::string_view prevField{eventPtrField.str};

      static void updateEventHead(RecordType& record, KeyType eventHeadId)
      {
         record.*evHead = eventHeadId;
      }

      static KeyType getEventHead(const RecordType& record) { return record.*evHead; }
   };
}  // namespace psibase