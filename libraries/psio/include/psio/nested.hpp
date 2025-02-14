#pragma once

#include <psio/fracpack.hpp>

namespace psio
{
   /**
    * This type is serialized as a vector<char> holding the packed value.
    */
   template <typename T>
   struct nested
   {
      using value_type = std::remove_cvref_t<T>;
      T           value;
      friend bool operator==(const nested&, const nested&) = default;
   };

   template <typename T, typename Stream>
   void to_json(const nested<T>& obj, Stream& stream)
   {
      to_json(to_frac(obj.value), stream);
   }

   template <typename T, typename Stream>
   void from_json(nested<T>& obj, Stream& stream)
   {
      std::vector<char> tmp;
      from_json(tmp, stream);
      from_frac(obj.value, tmp);
   }

   template <typename T>
   struct is_packable<nested<T>> : base_packable_impl<nested<T>, is_packable<nested<T>>>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = true;

      template <typename S>
      static void pack(const nested<T>& value, S& stream)
      {
         std::uint32_t size = 0;
         auto          pos  = stream.written();
         stream.write_raw(size);
         is_packable<std::remove_cvref_t<T>>::pack(value.value, stream);
         auto end = stream.written();
         size     = end - (pos + 4);
         stream.rewrite_raw(pos, size);
      }

      static bool is_empty_container(const nested<T>&)
      {
         using is_p = is_packable<std::remove_cvref_t<T>>;
         return !is_p::is_variable_size && is_p::fixed_size == 0;
      }
      static bool is_empty_container(const char* src, uint32_t pos, uint32_t end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<true>(&fixed_size, src, pos, end_pos))
            return false;
         return fixed_size == 0;
      }

      template <bool Verify>
      static bool clear_container(nested<T>* value)
      {
         // We don't need to proagate these up, because an empty object
         // definitely does not contain unknown data
         bool          has_unknown = false;
         bool          known_end;
         std::uint32_t pos = 0;
         if (!is_packable<std::remove_cvref_t<T>>::template unpack<true, Verify>(
                 &value->value, has_unknown, known_end, value->data(), pos, 0))
            return false;
         return true;
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(nested<T>*  value,
                                       bool&       has_unknown,
                                       bool&       known_end,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         uint32_t size = 0;
         if (!unpack_numeric<Verify>(&size, src, pos, end_pos))
            return false;
         if constexpr (Verify)
         {
            known_end = true;
            if (size > end_pos - pos)
               return false;
         }
         bool          inner_known_end;
         std::uint32_t inner_pos = pos;
         if (!is_packable<std::remove_cvref_t<T>>::template unpack<Unpack, Verify>(
                 Unpack ? &value->value : nullptr, has_unknown, inner_known_end, src, inner_pos,
                 pos + size))
            return false;
         if constexpr (Verify)
         {
            if (inner_known_end && inner_pos != pos + size)
               return false;
            known_end = true;
         }
         pos += size;
         return true;
      }
   };
}  // namespace psio
