#include <psio/fracpack2.hpp>
#include <psio/stream.hpp>

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
   requires std::is_arithmetic_v<T> bool
bitwise_equal(const T& lhs, const T& rhs)
{
   return std::memcmp(&lhs, &rhs, sizeof(T)) == 0;
}

template <typename T>
   requires(!std::is_arithmetic_v<T>) bool
bitwise_equal(const T& lhs, const T& rhs)
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
   return (... && bitwise_equal(std::get<I>(lhs), std::get<I>(rhs)));
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
struct BitwiseEqual : Catch::MatcherBase<T>
{
   explicit BitwiseEqual(const T& v) : value(v) {}
   bool        match(const T& other) const { return bitwise_equal(value, other); }
   std::string describe() const { return " == " + Catch::StringMaker<T>::convert(value); }
   T           value;
};

template <typename T>
constexpr bool need_bitwise_compare = std::is_floating_point_v<T>;

template <typename T>
constexpr bool need_bitwise_compare<std::optional<T>> = need_bitwise_compare<T>;

template <typename T>
constexpr bool need_bitwise_compare<std::vector<T>> = need_bitwise_compare<T>;

template <typename... T>
constexpr bool need_bitwise_compare<std::tuple<T...>> = (... || need_bitwise_compare<T>);

template <typename... T>
constexpr bool need_bitwise_compare<std::variant<T...>> = (... || need_bitwise_compare<T>);

template <typename T, std::size_t N>
constexpr bool need_bitwise_compare<std::array<T, N>> = need_bitwise_compare<T>;

template <typename T>
void test(const T& value)
{
   psio::size_stream ss;
   psio::is_packable<T>::pack(value, ss);
   std::vector<char>   data;
   psio::vector_stream out{data};
   psio::is_packable<T>::pack(value, out);
   CHECK(data.size() == ss.size);
   {
      T             result{};
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      CHECK(psio::is_packable<T>::template unpack<true, true>(&result, has_unknown, data.data(),
                                                              pos, data.size()));
      CHECK(!has_unknown);
      if constexpr (need_bitwise_compare<T>)
      {
         CHECK_THAT(result, BitwiseEqual(value));
      }
      else
      {
         CHECK(result == value);
      }
      CHECK(pos == data.size());
   }
   {
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      CHECK(psio::is_packable<T>::template unpack<false, true>(nullptr, has_unknown, data.data(),
                                                               pos, data.size()));
      CHECK(!has_unknown);
      CHECK(pos == data.size());
   }
   {
      T             result{};
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      CHECK(psio::is_packable<T>::template unpack<true, false>(&result, has_unknown, data.data(),
                                                               pos, data.size()));
      CHECK(!has_unknown);
      if constexpr (need_bitwise_compare<T>)
      {
         CHECK_THAT(result, BitwiseEqual(value));
      }
      else
      {
         CHECK(result == value);
      }
      CHECK(pos == data.size());
   }
   // Any prefix of the data should fail to verify
   for (std::size_t i = 0; i < data.size(); ++i)
   {
      // Making a copy in a separate allocation allows ubsan to detect out-of-bounds access
      std::unique_ptr<char[]> copy{new char[i]};
      std::memcpy(copy.get(), data.data(), i);
      {
         T             result{};
         std::uint32_t pos         = 0;
         bool          has_unknown = false;
         CHECK(!psio::is_packable<T>::template unpack<true, true>(&result, has_unknown, copy.get(),
                                                                  pos, i));
      }
      {
         std::uint32_t pos         = 0;
         bool          has_unknown = false;
         CHECK(!psio::is_packable<T>::template unpack<false, true>(nullptr, has_unknown, copy.get(),
                                                                   pos, i));
      }
   }
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
   }
}

struct fixed_struct
{
   std::uint32_t value;
   friend bool   operator==(const fixed_struct&, const fixed_struct&) = default;
};
PSIO_REFLECT(fixed_struct, definitionWillNotChange(), value)

struct padded_struct
{
   std::uint8_t  v1;
   std::uint32_t v2;
   friend bool   operator==(const padded_struct&, const padded_struct&) = default;
};
PSIO_REFLECT(padded_struct, definitionWillNotChange(), v1, v2)

struct variable_struct
{
   std::uint32_t value;
   friend bool   operator==(const variable_struct&, const variable_struct&) = default;
};
PSIO_REFLECT(variable_struct, value)

TEST_CASE("roundtrip")
{
   test<bool>({false, true});
   test<std::int8_t>({-128, -1, 0, 1, 127});
   test<std::uint8_t>({0, 1, 255});
   test<std::int16_t>({-32768, -1, 0, 1, 32767});
   test<std::uint16_t>({0, 1, 65535});
   test<std::int32_t>({std::numeric_limits<std::int32_t>::min(), -1, 0, 1,
                       std::numeric_limits<std::int32_t>::max()});
   test<std::uint32_t>({0, 1, std::numeric_limits<std::uint32_t>::max()});
   test<std::int64_t>({std::numeric_limits<std::int64_t>::min(), -1, 0, 1,
                       std::numeric_limits<std::int64_t>::max()});
   test<std::uint64_t>({0, 1, std::numeric_limits<std::uint64_t>::max()});
   test<float>({std::copysign(std::numeric_limits<float>::quiet_NaN(), -1.0f),
                std::copysign(std::numeric_limits<float>::signaling_NaN(), -1.0f),
                -std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::max(),
                -std::numeric_limits<float>::min(), -std::numeric_limits<float>::denorm_min(), -1,
                -0.0f, std::numeric_limits<float>::min(), 0, 1,
                std::numeric_limits<float>::denorm_min(), std::numeric_limits<float>::max(),
                std::numeric_limits<float>::infinity(), std::numeric_limits<float>::signaling_NaN(),
                std::numeric_limits<float>::quiet_NaN()});
   test<double>(
       {std::copysign(std::numeric_limits<double>::quiet_NaN(), -1.0),
        std::copysign(std::numeric_limits<double>::signaling_NaN(), -1.0),
        -std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::max(),
        -std::numeric_limits<double>::min(), -std::numeric_limits<double>::denorm_min(), -1, -0.0,
        std::numeric_limits<double>::min(), 0, 1, std::numeric_limits<double>::denorm_min(),
        std::numeric_limits<double>::max(), std::numeric_limits<double>::infinity(),
        std::numeric_limits<double>::signaling_NaN(), std::numeric_limits<double>::quiet_NaN()});
   test<std::string>({"", "Lorem ipsum dolor sit amet"});
   test<fixed_struct>({{0x12345678}, {0x90abcdef}});
   test<padded_struct>({{42, 0x12345678}, {43, 0x90abcdef}});
   test<variable_struct>({{0x12345678}, {0x90abcdef}});
   test<std::variant<std::int32_t, double, std::string>>(
       {1, 2.0, "Although I am an old man, night is generally my time for walking."});
   test<std::array<std::int32_t, 3>>({{1, 2, 3}, {4, 5, 6}, {7, 8, 9}});
   test<std::array<std::string, 3>>(
       {{"a", "bb", "ccc"}, {"dddd", "eeeee", "ffffff"}, {"ggggggg", "hhhhhhhh", "iiiiiiiii"}});
}
