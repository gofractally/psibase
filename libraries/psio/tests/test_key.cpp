#include <psio/schema.hpp>
#include <psio/to_key.hpp>

#include <psio/to_hex.hpp>

#include <catch2/catch.hpp>

using namespace psio::schema_types;

template <typename T>
void test_schema_to_key(const T& value)
{
   auto                expected = psio::convert_to_key(value);
   auto                packed   = psio::to_frac(value);
   std::vector<char>   key;
   psio::vector_stream stream{key};
   auto                schema = SchemaBuilder{}.insert<T>("T").build();
   CompiledSchema      cschema{schema};
   FracParser          parser{packed, cschema, "T", false};
   to_key(parser, stream);
   CHECK(psio::to_hex(key) == psio::to_hex(expected));
}

template <typename T>
void test_to_key(std::initializer_list<T> items)
{
   REQUIRE(std::ranges::is_sorted(items));
   std::string prev_str;
   const T*    prev = nullptr;
   for (const auto& item : items)
   {
      auto key     = psio::convert_to_key(item);
      auto key_str = psio::to_hex(key);
      if (prev)
      {
         if (*prev < item)
         {
            CHECK(prev_str < key_str);
            CHECK(!prev_str.starts_with(key_str));
         }
         else
            CHECK(prev_str == key_str);
      }
      prev     = &item;
      prev_str = std::move(key_str);
   }
   for (const auto& item : items)
   {
      test_schema_to_key(item);
   }
}

TEST_CASE("bool key")
{
   test_to_key({false, true});
}

TEST_CASE("[u]int8_t key")
{
   test_to_key<std::int8_t>({-128, -1, 0, 1, 127});
   test_to_key<std::uint8_t>({0, 1, 255});
}

TEST_CASE("[u]int16_t key")
{
   test_to_key<std::int16_t>({-32768, -1, 0, 1, 32767});
   test_to_key<std::uint16_t>({0, 1, 65535});
}

TEST_CASE("[u]int32_t key")
{
   test_to_key<std::int32_t>({std::numeric_limits<std::int32_t>::min(), -1, 0, 1,
                              std::numeric_limits<std::int32_t>::max()});
   test_to_key<std::uint32_t>({0, 1, std::numeric_limits<std::uint32_t>::max()});
}

TEST_CASE("[u]int64_t key")
{
   test_to_key<std::int64_t>({std::numeric_limits<std::int64_t>::min(), -1, 0, 1,
                              std::numeric_limits<std::int64_t>::max()});
   test_to_key<std::uint64_t>({0, 1, std::numeric_limits<std::uint64_t>::max()});
}

TEST_CASE("float/double key")
{
   test_to_key<float>(
       {-std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::max(), -1,
        -std::numeric_limits<float>::min(), -std::numeric_limits<float>::denorm_min(), -0.0f, 0,
        std::numeric_limits<float>::denorm_min(), std::numeric_limits<float>::min(), 1,
        std::numeric_limits<float>::max(), std::numeric_limits<float>::infinity()});
   test_to_key<double>(
       {-std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::max(), -1,
        -std::numeric_limits<double>::min(), -std::numeric_limits<double>::denorm_min(), -0.0, 0,
        std::numeric_limits<double>::denorm_min(), std::numeric_limits<double>::min(), 1,
        std::numeric_limits<double>::max(), std::numeric_limits<double>::infinity()});
}

TEST_CASE("string key")
{
   using namespace std::literals::string_literals;
   test_to_key<std::string>({"", "\0"s, "Lorem ipsum dolor sit amet", "\xc2\xa6"});
}

TEST_CASE("optional key")
{
   test_to_key<std::optional<std::uint32_t>>({std::nullopt, 0, 1});
   test_to_key<std::optional<std::uint8_t>>({std::nullopt, 0, 1});
   test_to_key<std::optional<std::int8_t>>({std::nullopt, -128, -1, 1, 127});
   test_to_key<std::optional<std::vector<std::uint32_t>>>(
       {std::nullopt, std::vector<std::uint32_t>{}, std::vector<std::uint32_t>{0, 1}});
}

TEST_CASE("vector key")
{
   test_to_key<std::vector<std::uint32_t>>({{}, {0, 0}, {0, 0, 1}, {0, 1}});
   test_to_key<std::vector<std::uint8_t>>({{}, {0, 0}, {0, 0, 1}, {0, 1}});
   test_to_key<std::vector<std::optional<std::uint32_t>>>(
       {{}, {std::nullopt, 0}, {std::nullopt, 0, 1}, {0, 1}});
   test_to_key<std::vector<std::optional<std::uint8_t>>>(
       {{}, {std::nullopt, 0}, {std::nullopt, 0, 1}, {0, 1}});
}

TEST_CASE("tuple key")
{
   test_to_key<std::tuple<std::uint32_t, std::uint32_t>>({{0, 0}, {0, 1}, {1, 0}, {1, 1}});
   test_to_key<std::tuple<std::optional<std::uint32_t>, std::optional<std::uint32_t>>>(
       {{std::nullopt, 0}, {std::nullopt, 1}, {1, std::nullopt}, {1, 1}});
}
