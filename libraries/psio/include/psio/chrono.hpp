#pragma once

#include <psio/fracpack.hpp>

#include <chrono>

namespace psio
{

   template <typename Rep, typename Period>
   struct is_packable<std::chrono::duration<Rep, Period>> : std::bool_constant<true>
   {
      using is_p = is_packable<Rep>;
      using T    = std::chrono::duration<Rep, Period>;

      static constexpr uint32_t fixed_size        = is_p::fixed_size;
      static constexpr bool     is_variable_size  = is_p::is_variable_size;
      static constexpr bool     is_optional       = is_p::is_optional;
      static constexpr bool     supports_0_offset = is_p::supports_0_offset;

      static bool has_value(const T& value) { return is_p::has_value(value.count()); }
      template <bool Verify>
      static bool has_value(const char* src, uint32_t pos, uint32_t end_pos)
      {
         return is_p::template has_value<Verify>(src, pos, end_pos);
      }

      template <bool Unpack, typename F>
      static bool unpack_impl(F&& f, T* value)
      {
         if constexpr (Unpack)
         {
            Rep  tmp;
            bool result = f(&tmp);
            *value      = T{tmp};
            return result;
         }
         else
         {
            return f((Rep*)nullptr);
         }
      }

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         return is_p::pack(value.count(), stream);
      }

      static bool is_empty_container(const T& value)
      {
         return is_p::is_empty_container(value.count());
      }
      static bool is_empty_container(const char* src, uint32_t pos, uint32_t end_pos)
      {
         return is_p::is_empty_container(src, pos, end_pos);
      }

      template <typename S>
      static void embedded_fixed_pack(const T& value, S& stream)
      {
         return is_p::embedded_fixed_pack(value.count(), stream);
      }

      template <typename S>
      static void embedded_fixed_repack(const T& value,
                                        uint32_t fixed_pos,
                                        uint32_t heap_pos,
                                        S&       stream)
      {
         return is_p::embedded_fixed_repack(value.count(), fixed_pos, heap_pos, stream);
      }

      template <typename S>
      static void embedded_variable_pack(const T& value, S& stream)
      {
         return is_p::embedded_variable_pack(value.count(), stream);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       bool&       known_end,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         auto orig_pos = pos;
         bool result   = unpack_impl<Unpack>(
             [&](Rep* value) {
                return is_p::template unpack<Unpack, Verify>(value, has_unknown, known_end, src,
                                                             pos, end_pos);
             },
             value);
         if constexpr (Verify && (PackableValidatedObject<T> || PackableValidatedView<T>))
         {
            return result && user_validate<Unpack, false>(value, src, orig_pos);
         }
         return result;
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_variable_unpack(T*          value,
                                                         bool&       has_unknown,
                                                         bool&       known_end,
                                                         const char* src,
                                                         uint32_t&   fixed_pos,
                                                         uint32_t    end_fixed_pos,
                                                         uint32_t&   heap_pos,
                                                         uint32_t    end_heap_pos)
      {
         auto orig_pos = fixed_pos;
         bool result   = unpack_impl<Unpack>(
             [&](Rep* value)
             {
                return is_p::template embedded_variable_unpack<Unpack, Verify>(
                    value, has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
                    end_heap_pos);
             },
             value);
         if constexpr (Verify && (PackableValidatedObject<T> || PackableValidatedView<T>))
         {
            return result && user_validate<Unpack, true>(value, src, orig_pos);
         }
         return result;
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_unpack(T*          value,
                                                bool&       has_unknown,
                                                bool&       known_end,
                                                const char* src,
                                                uint32_t&   fixed_pos,
                                                uint32_t    end_fixed_pos,
                                                uint32_t&   heap_pos,
                                                uint32_t    end_heap_pos)
      {
         auto orig_pos = fixed_pos;
         bool result   = unpack_impl<Unpack>(
             [&](Rep* value)
             {
                return is_p::template embedded_unpack<Unpack, Verify>(value, has_unknown, known_end,
                                                                      src, fixed_pos, end_fixed_pos,
                                                                      heap_pos, end_heap_pos);
             },
             value);
         if constexpr (Verify && (PackableValidatedObject<T> || PackableValidatedView<T>))
         {
            return result && user_validate < Unpack,
                   !is_optional && is_variable_size > (value, src, orig_pos);
         }
         return result;
      }
   };

   template <typename Rep, typename Period, typename Stream>
   void to_json(const std::chrono::duration<Rep, Period>& obj, Stream& stream)
   {
      to_json(obj.count(), stream);
   }

   template <typename Rep, typename Period, typename Stream>
   void from_json(std::chrono::duration<Rep, Period>& obj, Stream& stream)
   {
      Rep tmp;
      from_json(tmp, stream);
      obj = std::chrono::duration<Rep, Period>(tmp);
   }

}  // namespace psio
