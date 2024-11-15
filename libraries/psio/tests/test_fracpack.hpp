#pragma once

#include <psio/fracpack.hpp>
#include <psio/schema.hpp>
#include <psio/shared_view_ptr.hpp>
#include <psio/stream.hpp>
// Prevent clang-format from munging the header order
#include <psio/to_json.hpp>  // FIXME: needed by to_hex
//
#include <psio/to_hex.hpp>

#include <boost/core/demangle.hpp>
#include <type_traits>

#include <catch2/catch.hpp>

template <typename T>
struct Catch::StringMaker<std::optional<T>>
{
   static std::string convert(const std::optional<T>& value)
   {
      if (value)
      {
         return Catch::StringMaker<T>::convert(*value);
      }
      else
      {
         return "nullopt";
      }
   }
};

template <typename... T>
struct Catch::StringMaker<std::variant<T...>>
{
   static std::string convert(const std::variant<T...>& value)
   {
      return std::visit(
          [](const auto& v)
          { return Catch::StringMaker<std::remove_cvref_t<decltype(v)>>::convert(v); },
          value);
   }
};

template <typename T>
struct Catch::StringMaker<psio::shared_view_ptr<T>>
{
   static std::string convert(const psio::shared_view_ptr<T>& value)
   {
      return psio::hex(value.data(), value.data() + value.size());
   }
};

template <typename T>
bool bitwise_equal(const std::vector<T>& lhs, const std::vector<T>& rhs);
template <typename T>
bool bitwise_equal(const std::optional<T>& lhs, const std::optional<T>& rhs);
template <typename... T>
bool bitwise_equal(const std::tuple<T...>& lhs, const std::tuple<T...>& rhs);
template <typename... T>
bool bitwise_equal(const std::variant<T...>& lhs, const std::variant<T...>& rhs);
template <typename T, std::size_t N>
bool bitwise_equal(const std::array<T, N>& lhs, const std::array<T, N>& rhs);
template <typename T>
bool bitwise_equal(const psio::shared_view_ptr<T>& lhs, const psio::shared_view_ptr<T>& rhs);

template <typename T>
   requires std::is_arithmetic_v<T>
bool bitwise_equal(const T& lhs, const T& rhs)
{
   return std::memcmp(&lhs, &rhs, sizeof(T)) == 0;
}

template <typename T>
   requires(!std::is_arithmetic_v<T>)
bool bitwise_equal(const T& lhs, const T& rhs)
{
   return lhs == rhs;
}

template <typename T>
bool bitwise_equal(const std::optional<T>& lhs, const std::optional<T>& rhs)
{
   if (lhs.has_value() != rhs.has_value())
      return false;
   if (!lhs.has_value())
      return true;
   return bitwise_equal(*lhs, *rhs);
}

template <typename T>
bool bitwise_equal(const std::vector<T>& lhs, const std::vector<T>& rhs)
{
   return std::equal(lhs.begin(), lhs.end(), rhs.begin(), rhs.end(),
                     [](const T& lhs, const T& rhs) { return bitwise_equal(lhs, rhs); });
}

template <typename Tuple, std::size_t... I>
bool bitwise_equal(const Tuple& lhs, const Tuple& rhs, std::index_sequence<I...>)
{
   return (true && ... && bitwise_equal(std::get<I>(lhs), std::get<I>(rhs)));
}

template <typename... T>
bool bitwise_equal(const std::tuple<T...>& lhs, const std::tuple<T...>& rhs)
{
   return bitwise_equal(lhs, rhs, std::make_index_sequence<sizeof...(T)>());
}

template <typename... T>
bool bitwise_equal(const std::variant<T...>& lhs, const std::variant<T...>& rhs)
{
   if (lhs.index() != rhs.index())
      return false;
   return std::visit(
       [](const auto& lhs, const auto& rhs)
       {
          if constexpr (std::is_same_v<decltype(lhs), decltype(rhs)>)
          {
             return bitwise_equal(lhs, rhs);
          }
          else
          {
             return false;
          }
       },
       lhs, rhs);
}

template <typename T, std::size_t N>
bool bitwise_equal(const std::array<T, N>& lhs, const std::array<T, N>& rhs)
{
   return std::equal(lhs.begin(), lhs.end(), rhs.begin(), rhs.end(),
                     [](const T& lhs, const T& rhs) { return bitwise_equal(lhs, rhs); });
}

template <typename T>
bool bitwise_equal(const psio::shared_view_ptr<T>& lhs, const psio::shared_view_ptr<T>& rhs)
{
   return bitwise_equal(lhs->unpack(), rhs->unpack());
}

template <typename T>
struct BitwiseEqual : Catch::MatcherBase<T>
{
   explicit BitwiseEqual(const T& v) : value(v) {}
   bool        match(const T& other) const { return bitwise_equal(value, other); }
   std::string describe() const { return "== " + Catch::StringMaker<T>::convert(value); }
   T           value;
};

inline std::vector<std::byte> to_bytes(const std::vector<char>& data)
{
   std::vector<std::byte> result;
   result.reserve(data.size());
   for (auto ch : data)
   {
      result.push_back(static_cast<std::byte>(ch));
   }
   return result;
}

template <typename T>
auto test_base(const T& value)
{
   psio::size_stream ss;
   psio::is_packable<T>::pack(value, ss);
   std::vector<char>   data;
   psio::vector_stream out{data};
   psio::is_packable<T>::pack(value, out);
   INFO("data: " << psio::hex(data.begin(), data.end()));
   INFO("type: " << boost::core::demangle(typeid(T).name()));
   CHECK(data.size() == ss.size);
   {
      T             result{};
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      bool          known_end;
      CHECK(psio::is_packable<T>::template unpack<true, true>(&result, has_unknown, known_end,
                                                              data.data(), pos, data.size()));
      CHECK(!has_unknown);
      CHECK(known_end);
      CHECK_THAT(result, BitwiseEqual(value));
      CHECK(pos == data.size());
   }
   {
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      bool          known_end;
      CHECK(psio::is_packable<T>::template unpack<false, true>(nullptr, has_unknown, known_end,
                                                               data.data(), pos, data.size()));
      CHECK(!has_unknown);
      CHECK(known_end);
      CHECK(pos == data.size());
   }
   {
      T             result{};
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      bool          known_end;  // unused when Verify = false
      CHECK(psio::is_packable<T>::template unpack<true, false>(&result, has_unknown, known_end,
                                                               data.data(), pos, data.size()));
      CHECK(!has_unknown);
      CHECK_THAT(result, BitwiseEqual(value));
      CHECK(pos == data.size());
   }
   // convenience functions
   {
      CHECK_THAT(psio::from_frac<T>(data), BitwiseEqual(value));
      CHECK_THAT(psio::from_frac<T>(psio::prevalidated{data}), BitwiseEqual(value));
      CHECK(psio::fracpack_validate_strict<T>(data));
   }
   // schema
   using namespace psio::schema_types;
   Schema         schema = SchemaBuilder().insert<T>("T").build();
   CompiledSchema cschema(schema);
   {
      INFO("schema: " << psio::format_json(schema));
      FracParser          parser{data, cschema, "T"};
      std::vector<char>   json;
      psio::vector_stream out{json};
      to_json(parser, out);
      CHECK(std::string_view{json.data(), json.size()} == psio::convert_to_json(value));
      CHECK(parser.in.pos == parser.in.end_pos);
      CHECK(!parser.in.has_unknown);
   }
   // Any prefix of the data should fail to verify
   for (std::size_t i = 0; i < data.size(); ++i)
   {
      INFO("leading bytes: " << i);
      // Making a copy in a separate allocation allows asan to detect out-of-bounds access
      std::unique_ptr<char[]> copy{new char[i]};
      std::memcpy(copy.get(), data.data(), i);
      {
         T             result{};
         std::uint32_t pos         = 0;
         bool          has_unknown = false;
         bool          known_end;
         CHECK(!psio::is_packable<T>::template unpack<true, true>(&result, has_unknown, known_end,
                                                                  copy.get(), pos, i));
      }
      {
         std::uint32_t pos         = 0;
         bool          has_unknown = false;
         bool          known_end;
         CHECK(!psio::is_packable<T>::template unpack<false, true>(nullptr, has_unknown, known_end,
                                                                   copy.get(), pos, i));
      }
      CHECK(!fracpack_validate({copy.get(), i}, cschema, "T"));
   }
   return data;
}

template <typename T>
struct packable_wrapper
{
   T           value;
   friend bool operator==(const packable_wrapper& lhs, const packable_wrapper& rhs)
   {
      return bitwise_equal(lhs.value, rhs.value);
   }
};
template <typename T>
packable_wrapper(T) -> packable_wrapper<T>;
template <typename T>
const T& clio_unwrap_packable(const packable_wrapper<T>& wrapper)
{
   return wrapper.value;
}
template <typename T>
T& clio_unwrap_packable(packable_wrapper<T>& wrapper)
{
   return wrapper.value;
}
template <typename T, typename Stream>
void to_json(const packable_wrapper<T>& wrapper, Stream& stream)
{
   to_json(wrapper.value, stream);
}
template <typename T>
constexpr const char* get_type_name(const packable_wrapper<T>*)
{
   using psio::get_type_name;
   return get_type_name((T*)nullptr);
}

template <typename... T>
auto wrap_packable(const std::variant<T...>& value);
template <typename T>
auto wrap_packable(const std::optional<T>& value);
template <typename T>
auto wrap_packable(const std::vector<T>& value);
template <typename T>
auto wrap_packable(const std::tuple<T>& value);

template <typename T>
auto wrap_packable(const T& value)
{
   return packable_wrapper{value};
}

template <typename T>
auto wrap_packable(const std::optional<T>& value)
{
   return packable_wrapper{value ? std::optional{wrap_packable(*value)} : std::nullopt};
}

template <typename T>
auto wrap_packable(const std::vector<T>& value)
{
   std::vector<decltype(wrap_packable(value.front()))> result;
   for (const auto& v : value)
   {
      result.push_back(wrap_packable(v));
   }
   return packable_wrapper{result};
}

template <typename T>
auto wrap_packable(const std::tuple<T>& value)
{
   return packable_wrapper{std::tuple{wrap_packable(std::get<0>(value))}};
}

template <std::size_t I, typename R, typename V>
auto wrap_packable_variant(const V& v)
{
   if (v.index() == I)
   {
      return R{std::in_place_index<I>, wrap_packable(std::get<I>(v))};
   }
   else if constexpr (I)
   {
      return wrap_packable_variant<I - 1, R>(v);
   }
   // valueless_by_exception doesn't exist
   __builtin_unreachable();
}

template <typename... T>
auto wrap_packable(const std::variant<T...>& value)
{
   return packable_wrapper{
       wrap_packable_variant<sizeof...(T) - 1,
                             std::variant<decltype(wrap_packable(std::declval<T>()))...>>(value)};
}

template <typename T>
void test(const T& value)
{
   auto base    = test_base(value);
   auto wrapped = test_base(wrap_packable(value));
   CHECK(base == wrapped);
}

template <typename T>
struct extensible_wrapper
{
   T value;
   PSIO_REFLECT(extensible_wrapper, value)
   friend bool operator==(const extensible_wrapper& lhs, const extensible_wrapper& rhs)
   {
      return bitwise_equal(lhs.value, rhs.value);
   }
};
template <typename T>
extensible_wrapper(T) -> extensible_wrapper<T>;

template <typename T>
auto wrap_packable(const extensible_wrapper<T>& value)
{
   return packable_wrapper{extensible_wrapper{wrap_packable(value.value)}};
}

template <typename T>
struct Catch::StringMaker<extensible_wrapper<T>>
{
   static std::string convert(const extensible_wrapper<T>& value)
   {
      return StringMaker<T>::convert(value.value);
   }
};

template <typename T>
struct nonextensible_wrapper
{
   T value;
   PSIO_REFLECT(nonextensible_wrapper, definitionWillNotChange(), value)
   friend bool operator==(const nonextensible_wrapper& lhs, const nonextensible_wrapper& rhs)
   {
      return bitwise_equal(lhs.value, rhs.value);
   }
};
template <typename T>
nonextensible_wrapper(T) -> nonextensible_wrapper<T>;

template <typename T>
auto wrap_packable(const nonextensible_wrapper<T>& value)
{
   return packable_wrapper{nonextensible_wrapper{wrap_packable(value.value)}};
}

template <typename T>
struct Catch::StringMaker<nonextensible_wrapper<T>>
{
   static std::string convert(const nonextensible_wrapper<T>& value)
   {
      return StringMaker<T>::convert(value.value);
   }
};

template <typename T>
void test(std::initializer_list<T> values)
{
   // top-level
   for (const auto& v : values)
   {
      test(v);
   }
   // optional
   test(std::optional<T>{});
   for (const auto& v : values)
   {
      test(std::optional<T>{v});
   }
   // as member
   for (const auto& v : values)
   {
      test(extensible_wrapper{v});
   }
   for (const auto& v : values)
   {
      test(nonextensible_wrapper{v});
   }
   for (const auto& v : values)
   {
      test(std::tuple{v});
   }
   // optional as member
   test(extensible_wrapper{std::optional<T>{}});
   for (const auto& v : values)
   {
      test(extensible_wrapper{std::optional{v}});
   }
   test(nonextensible_wrapper{std::optional<T>{}});
   for (const auto& v : values)
   {
      test(nonextensible_wrapper{std::optional{v}});
   }
   test(std::tuple{std::optional<T>{}});
   for (const auto& v : values)
   {
      test(std::tuple{std::optional{v}});
   }
   // vector<bool> is not a container
   if constexpr (!std::is_same_v<T, bool>)
   {
      // vector
      test(std::vector<T>{});
      test(std::vector<T>(values));
      test(std::optional<std::vector<T>>{});
      test(std::optional{std::vector<T>{}});
      test(std::optional{std::vector<T>(values)});

      // vector as member
      test(extensible_wrapper{std::vector<T>{}});
      test(extensible_wrapper{std::vector<T>(values)});
      test(extensible_wrapper{std::optional<std::vector<T>>{}});
      test(extensible_wrapper{std::optional{std::vector<T>{}}});
      test(extensible_wrapper{std::optional{std::vector<T>(values)}});

      test(nonextensible_wrapper{std::vector<T>{}});
      test(nonextensible_wrapper{std::vector<T>(values)});
      test(nonextensible_wrapper{std::optional<std::vector<T>>{}});
      test(nonextensible_wrapper{std::optional{std::vector<T>{}}});
      test(nonextensible_wrapper{std::optional{std::vector<T>(values)}});

      test(std::tuple{std::vector<T>{}});
      test(std::tuple{std::vector<T>(values)});
      test(std::tuple{std::optional<std::vector<T>>{}});
      test(std::tuple{std::optional{std::vector<T>{}}});
      test(std::tuple{std::optional{std::vector<T>(values)}});

      test(std::tuple{std::optional{std::uint32_t{6}}, std::vector<T>(values),
                      std::optional{std::uint32_t{7}}});
   }
   // variant
   for (const auto& v : values)
   {
      test(std::variant<T>{v});
      test(std::variant<T, T>{std::in_place_index<0>, v});
      test(std::variant<T, T>{std::in_place_index<1>, v});
   }
   // array
   {
      std::array<T, 20> a = {};
      assert(values.size() <= a.size());
      std::copy(values.begin(), values.end(), a.begin());
      test(a);
      test(std::optional<std::array<T, 20>>{});
      test(std::optional{a});
      test(extensible_wrapper{a});
      test(extensible_wrapper{std::optional<std::array<T, 20>>{}});
      test(extensible_wrapper{std::optional{a}});
      test(nonextensible_wrapper{a});
      test(nonextensible_wrapper{std::optional<std::array<T, 20>>{}});
      test(nonextensible_wrapper{std::optional{a}});
      test(std::tuple{a});
      test(std::tuple{std::optional<std::array<T, 20>>{}});
      test(std::tuple{std::optional{a}});
      test(std::tuple{std::optional{std::uint32_t{6}}, a, std::optional{std::uint32_t{7}}});
   }
   // shared_view_ptr
   {
      for (const auto& v : values)
      {
         test(psio::shared_view_ptr{v});
      }
   }
   // Sandwiched between two heap objects (checks correct tracking of fixed_pos vs heap_pos)
   for (const auto& v : values)
   {
      test(std::tuple{std::optional{std::uint32_t{6}}, v, std::optional{std::uint32_t{7}}});
      test(std::tuple{std::optional{std::uint32_t{6}}, nonextensible_wrapper{v},
                      std::optional{std::uint32_t{7}}});
      test(std::tuple{std::optional{std::uint32_t{6}}, extensible_wrapper{v},
                      std::optional{std::uint32_t{7}}});
      test(std::tuple{std::optional{std::uint32_t{6}}, std::optional<T>(v),
                      std::optional{std::uint32_t{7}}});
   }
}
