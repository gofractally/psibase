#pragma once

#include <array>
#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <tuple>
#include <variant>
#include <vector>

#include <psio/compress_name.hpp>

namespace psio
{

#define PSIO_REFLECT_TYPENAME(T)                 \
   constexpr const char* get_type_name(const T*) \
   {                                             \
      return BOOST_PP_STRINGIZE(T);              \
   }

   template <typename T>
   struct is_reflected : std::false_type
   {
   };

   // defined in reflect.hpp
   template <typename T>
      requires(is_reflected<T>::value)
   constexpr const char* get_type_name(const T*);

   template <typename T>
   constexpr const char* get_type_name(const std::optional<T>*);
   template <typename T>
   constexpr const char* get_type_name(const std::vector<T>*);
   template <typename T, size_t S>
   constexpr const char* get_type_name(const std::array<T, S>*);
   template <typename T, size_t S>
   constexpr const char* get_type_name(const T (*)[S]);
   template <typename... T>
   constexpr const char* get_type_name(const std::tuple<T...>*);
   template <typename... T>
   constexpr const char* get_type_name(const std::variant<T...>*);
   template <typename Rep, typename Period>
   constexpr const char* get_type_name(const std::chrono::duration<Rep, Period>*);

   // clang-format off
   constexpr const char* get_type_name(const bool*) { return "bool"; }
   constexpr const char* get_type_name(const int8_t*) { return "int8"; }
   constexpr const char* get_type_name(const uint8_t*) { return "uint8"; }
   constexpr const char* get_type_name(const int16_t*) { return "int16"; }
   constexpr const char* get_type_name(const uint16_t*) { return "uint16"; }
   constexpr const char* get_type_name(const int32_t*) { return "int32"; }
   constexpr const char* get_type_name(const uint32_t*) { return "uint32"; }
   constexpr const char* get_type_name(const int64_t*) { return "int64"; }
   constexpr const char* get_type_name(const uint64_t*) { return "uint64"; }
   constexpr const char* get_type_name(const float*) { return "float32"; }
   constexpr const char* get_type_name(const double*) { return "double"; }
   constexpr const char* get_type_name(const char*) { return "char"; }
   constexpr const char* get_type_name(const std::string*) { return "string"; }
   constexpr const char* get_type_name(const std::string_view*) { return "string"; }
   constexpr const char* get_type_name(const __int128*) { return "int128"; }
   constexpr const char* get_type_name(const unsigned __int128*) { return "uint128"; }
   // clang-format on

   template <std::size_t N, std::size_t M>
   constexpr std::array<char, N + M> array_cat(std::array<char, N> lhs, std::array<char, M> rhs)
   {
      std::array<char, N + M> result{};
      for (std::size_t i = 0; i < N; ++i)
      {
         result[i] = lhs[i];
      }
      for (std::size_t i = 0; i < M; ++i)
      {
         result[i + N] = rhs[i];
      }
      return result;
   }

   template <std::size_t N>
   constexpr std::array<char, N> to_array(std::string_view s)
   {
      std::array<char, N> result{};
      for (std::size_t i = 0; i < N; ++i)
      {
         result[i] = s[i];
      }
      return result;
   }

   template <typename T, std::size_t N>
   constexpr auto append_type_name(const char (&suffix)[N])
   {
      constexpr std::string_view name = get_type_name((T*)nullptr);
      return array_cat(to_array<name.size()>(name), to_array<N>({suffix, N}));
   }

   template <typename T>
   constexpr auto vector_type_name = append_type_name<T>("[]");

   template <typename T>
   constexpr auto optional_type_name = append_type_name<T>("?");

   template <typename T>
   constexpr const char* get_type_name(const std::vector<T>*)
   {
      return vector_type_name<T>.data();
   }

   constexpr std::size_t const_log10(std::size_t n)
   {
      std::size_t result = 0;
      do
      {
         n /= 10;
         ++result;
      } while (n > 0);
      return result;
   }

   template <typename T, std::size_t S>
   constexpr auto get_array_type_name()
   {
      constexpr std::string_view               name   = get_type_name((T*)nullptr);
      std::array<char, 2 + const_log10(S) + 1> bounds = {};
      bounds[0]                                       = '[';
      bounds[bounds.size() - 2]                       = ']';
      for (std::size_t N = S, i = bounds.size() - 3; i > 0; --i, N /= 10)
      {
         bounds[i] = '0' + N % 10;
      }
      return array_cat(to_array<name.size()>(name), bounds);
   }

   template <typename T, size_t S>
   constexpr auto array_type_name = get_array_type_name<T, S>();

   template <typename T, size_t S>
   constexpr const char* get_type_name(const std::array<T, S>*)
   {
      return array_type_name<T, S>.data();
   }
   template <typename T, size_t S>
   constexpr const char* get_type_name(const T (*)[S])
   {
      return array_type_name<T, S>.data();
   }

   template <typename T>
   constexpr const char* get_type_name(const std::optional<T>*)
   {
      return optional_type_name<T>.data();
   }

   struct variant_type_appender
   {
      char*                           buf;
      constexpr variant_type_appender operator+(std::string_view s)
      {
         *buf++ = '_';
         for (auto ch : s)
            *buf++ = ch;
         return *this;
      }
   };

   template <typename... T>
   constexpr auto get_variant_type_name()
   {
      constexpr std::size_t size =
          sizeof("variant") + ((std::string_view(get_type_name((T*)nullptr)).size() + 1) + ...);
      std::array<char, size> buffer{'v', 'a', 'r', 'i', 'a', 'n', 't'};
      (variant_type_appender{buffer.data() + 7} + ... +
       std::string_view(get_type_name((T*)nullptr)));
      buffer[buffer.size() - 1] = '\0';
      return buffer;
   }

   template <typename... T>
   constexpr auto get_tuple_type_name()
   {
      constexpr std::size_t size =
          sizeof("tuple") + ((std::string_view(get_type_name((T*)nullptr)).size() + 1) + ... + 0);
      std::array<char, size> buffer{'t', 'u', 'p', 'l', 'e'};
      (variant_type_appender{buffer.data() + 5} + ... +
       std::string_view(get_type_name((T*)nullptr)));
      buffer[buffer.size() - 1] = '\0';
      return buffer;
   }

   template <typename... T>
   constexpr auto variant_type_name = get_variant_type_name<T...>();

   template <typename... T>
   constexpr const char* get_type_name(const std::variant<T...>*)
   {
      return variant_type_name<T...>.data();
   }

   template <typename... T>
   constexpr auto tuple_type_name = get_tuple_type_name<T...>();

   template <typename... T>
   constexpr const char* get_type_name(const std::tuple<T...>*)
   {
      return tuple_type_name<T...>.data();
   }

   template <typename Rep, typename Period>
   constexpr const char* get_type_name(const std::chrono::duration<Rep, Period>*)
   {
      return "duration";
   }

   template <typename Rep>
   constexpr const char* get_type_name(
       const std::chrono::time_point<std::chrono::system_clock, std::chrono::duration<Rep>>*)
   {
      return "TimePointSec";
   }

   template <typename Rep>
   constexpr const char* get_type_name(
       const std::chrono::time_point<std::chrono::system_clock,
                                     std::chrono::duration<Rep, std::micro>>*)
   {
      return "TimePointUSec";
   }

   template <typename T>
   constexpr const char* get_type_name()
   {
      return get_type_name((const T*)nullptr);
   }

   // TODO: rename. "hash_name" implies it's always a hash and
   //       doesn't indicate which name format
   inline constexpr uint64_t hash_name(std::string_view str)
   {
      return detail::method_to_number(str);
   }

   inline constexpr bool is_compressed_name(uint64_t c)
   {
      return not detail::is_hash_name(c);
   }

}  // namespace psio
