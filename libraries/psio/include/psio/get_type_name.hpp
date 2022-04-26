#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <tuple>
#include <variant>
#include <vector>

#include <consthash/cityhash64.hxx>
#include <psio/compress_name.hpp>

namespace psio
{

#define PSIO_REFLECT_TYPENAME(T)                 \
   constexpr const char* get_type_name(const T*) \
   {                                             \
      return BOOST_PP_STRINGIZE(T);              \
   }

#define PSIO_REFLECT_TYPENAME_CUSTOM(T, CUSTOM)  \
   constexpr const char* get_type_name(const T*) \
   {                                             \
      return BOOST_PP_STRINGIZE(CUSTOM);         \
   }

   template <typename T>
   constexpr const char* get_type_name(const std::optional<T>*);
   template <typename T>
   constexpr const char* get_type_name(const std::vector<T>*);
   template <typename T, size_t S>
   constexpr const char* get_type_name(const std::array<T, S>*);
   template <typename... T>
   constexpr const char* get_type_name(const std::tuple<T...>*);
   template <typename... T>
   constexpr const char* get_type_name(const std::variant<T...>*);

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
   constexpr const char* get_type_name(const __int128*) { return "int128"; }
   constexpr const char* get_type_name(const unsigned __int128*) { return "uint128"; }
   // clang-format on

   template <std::size_t N, std::size_t M>
   constexpr std::array<char, N + M> array_cat(std::array<char, N> lhs, std::array<char, M> rhs)
   {
      std::array<char, N + M> result{};
      for (int i = 0; i < N; ++i)
      {
         result[i] = lhs[i];
      }
      for (int i = 0; i < M; ++i)
      {
         result[i + N] = rhs[i];
      }
      return result;
   }

   template <std::size_t N>
   constexpr std::array<char, N> to_array(std::string_view s)
   {
      std::array<char, N> result{};
      for (int i = 0; i < N; ++i)
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

   template <typename T, size_t S>
   constexpr auto array_type_name = append_type_name<T>("[#]");

   template <typename T>
   constexpr auto optional_type_name = append_type_name<T>("?");

   template <typename T>
   constexpr const char* get_type_name(const std::vector<T>*)
   {
      return vector_type_name<T>.data();
   }
   template <typename T, size_t S>
   constexpr const char* get_type_name(const std::array<T, S>*)
   {
      return "array";  //array_type_name<T,S>.data();
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
          sizeof("tuple") + ((std::string_view(get_type_name((T*)nullptr)).size() + 1) + ...);
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
   constexpr const char* get_type_name(const std::tuple<T...>*)
   {
      return get_tuple_type_name<T...>().data();
   }

   template <typename T>
   constexpr const char* get_type_name()
   {
      return get_type_name((const T*)nullptr);
   }

   inline constexpr uint64_t city_hash_name(std::string_view str)
   {
      return consthash::city64(str.data(), str.size()) | (uint64_t(0x01) << (64 - 8));
   }

   // TODO: rename. "hash_name" implies it's always a hash and
   //       doesn't indicate which name format
   inline constexpr uint64_t hash_name(std::string_view str)
   {
      uint64_t n = detail::method_to_number(str);
      if (n)
      {
         return n;
      }
      else
      {
         return city_hash_name(str);
      }
   }

   // TODO: rename; doesn't indicate which name format
   inline constexpr bool is_compressed_name(uint64_t c)
   {
      return not detail::is_hash_name(c);
   }

   // TODO: rename; doesn't indicate which name format
   template <typename T>
   constexpr uint64_t get_type_hashname()
   {
      return hash_name(get_type_name<T>());
   }
}  // namespace psio
