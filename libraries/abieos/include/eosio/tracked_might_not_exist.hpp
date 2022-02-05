#pragma once

namespace eosio
{
   template <typename T>
   struct tracked_might_not_exist
   {
      bool filled{};  // true if value was deserialized. Has no effect while serializing.
      T value{};
   };

   template <typename T, typename S>
   void from_bin(tracked_might_not_exist<T>& obj, S& stream)
   {
      if (stream.remaining())
      {
         obj.filled = true;
         return from_bin(obj.value, stream);
      }
   }

   template <typename T, typename S>
   void to_bin(const tracked_might_not_exist<T>& obj, S& stream)
   {
      return to_bin(obj.value, stream);
   }

   template <typename T, typename S>
   void from_json(tracked_might_not_exist<T>& obj, S& stream)
   {
      obj.filled = true;
      return from_json(obj.value, stream);
   }

   template <typename T, typename S>
   void to_json(const tracked_might_not_exist<T>& val, S& stream)
   {
      return to_json(val.value, stream);
   }
}  // namespace eosio
