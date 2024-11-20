#pragma once

#include <psio/fracpack.hpp>

#include <chrono>
#include <sstream>

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

   template <typename Rep, typename Period, typename Stream>
   void to_key(const std::chrono::duration<Rep, Period>& obj, Stream& stream)
   {
      to_key(obj.count(), stream);
   }

   template <typename Clock, typename Duration>
   struct is_packable<std::chrono::time_point<Clock, Duration>> : std::bool_constant<true>
   {
      using Rep  = typename Duration::rep;
      using is_p = is_packable<Rep>;
      using T    = std::chrono::time_point<Clock, Duration>;

      static constexpr uint32_t fixed_size        = is_p::fixed_size;
      static constexpr bool     is_variable_size  = is_p::is_variable_size;
      static constexpr bool     is_optional       = is_p::is_optional;
      static constexpr bool     supports_0_offset = is_p::supports_0_offset;

      static bool has_value(const T& value)
      {
         return is_p::has_value(value.time_since_epoch().count());
      }
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
            *value      = T{Duration{tmp}};
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
         return is_p::pack(value.time_since_epoch().count(), stream);
      }

      static bool is_empty_container(const T& value)
      {
         return is_p::is_empty_container(value.time_since_epoch().count());
      }
      static bool is_empty_container(const char* src, uint32_t pos, uint32_t end_pos)
      {
         return is_p::is_empty_container(src, pos, end_pos);
      }

      template <typename S>
      static void embedded_fixed_pack(const T& value, S& stream)
      {
         return is_p::embedded_fixed_pack(value.time_since_epoch().count(), stream);
      }

      template <typename S>
      static void embedded_fixed_repack(const T& value,
                                        uint32_t fixed_pos,
                                        uint32_t heap_pos,
                                        S&       stream)
      {
         return is_p::embedded_fixed_repack(value.time_since_epoch().count(), fixed_pos, heap_pos,
                                            stream);
      }

      template <typename S>
      static void embedded_variable_pack(const T& value, S& stream)
      {
         return is_p::embedded_variable_pack(value.time_since_epoch().count(), stream);
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

   bool        parse_system_time(std::string_view s, std::int64_t& result, std::uint32_t& nsec);
   std::string format_system_time(std::int64_t sec, std::uint64_t subsec, int digits);

   namespace detail
   {
      constexpr int ratio_frac_digits(std::intmax_t /*N*/, std::intmax_t D)
      {
         for (std::intmax_t result = 0; result <= 18; ++result)
         {
            if (D == 1)
               return result;
            else if (D % 10 == 0)
               D /= 10;
            else if (D % 5 == 0)
               D /= 5;
            else if (D % 2 == 0)
               D /= 2;
            else
               break;
         }
         return 6;
      }
      constexpr std::intmax_t pow10(int n)
      {
         std::intmax_t result = 1;
         for (int i = 0; i < n; ++i)
            result *= 10;
         return result;
      }
   }  // namespace detail

   // ISO 8601 Extended
   template <typename Duration, typename Stream>
   void to_json(const std::chrono::time_point<std::chrono::system_clock, Duration>& obj,
                Stream&                                                             stream)
   {
      auto           sec    = std::chrono::floor<std::chrono::seconds>(obj);
      auto           subsec = obj - sec;
      constexpr auto digits =
          detail::ratio_frac_digits(Duration::period::num, Duration::period::den);
      using subsec_t = std::chrono::duration<std::int64_t, std::ratio<1, detail::pow10(digits)>>;
      to_json(format_system_time(sec.time_since_epoch().count(),
                                 std::chrono::duration_cast<subsec_t>(subsec).count(), digits),
              stream);
   }

   template <typename Duration, typename Stream>
   void from_json(std::chrono::time_point<std::chrono::system_clock, Duration>& obj, Stream& stream)
   {
      auto          s = stream.get_string();
      std::int64_t  sec;
      std::uint32_t nsec;

      if (!psio::parse_system_time(s, sec, nsec))
         abort_error("Expected UTC string");

      obj = std::chrono::time_point<std::chrono::system_clock, Duration>(
          std::chrono::duration_cast<Duration>(std::chrono::duration<std::int64_t>(sec)) +
          std::chrono::duration_cast<Duration>(
              std::chrono::duration<std::uint32_t, std::nano>(nsec)));
   }

   template <typename Clock, typename Duration, typename Stream>
   void to_key(const std::chrono::time_point<Clock, Duration>& obj, Stream& stream)
   {
      to_key(obj.time_since_epoch(), stream);
   }

}  // namespace psio
