#include <psio/view.hpp>

#include <catch2/catch.hpp>

TEST_CASE("u8 view", "[view]")
{
   auto bin = psio::to_frac(std::uint8_t{0xFF});
   {
      psio::view<const std::uint8_t> v{bin};
      CHECK(v == 0xFF);
      CHECK(v.unpack() == 0xFF);
   }
   {
      psio::view<std::uint8_t> v{bin};
      std::uint8_t             value = v;
      CHECK(value == 0xFF);
      CHECK(v.unpack() == 0xFF);
      v     = 0xCC;
      value = v;
      CHECK(value == 0xCC);
   }
}

TEST_CASE("tuple view", "[view]")
{
   std::tuple t{std::uint8_t(42), std::uint8_t{127}};
   auto       bin = psio::to_frac(t);
   {
      auto v = psio::view<const std::tuple<std::uint8_t, std::uint8_t>>(bin);
      CHECK(get<0>(v) == 42);
      CHECK(get<1>(v) == 127);
      CHECK(v.unpack() == t);
      auto [v0, v1] = v;
      CHECK(v0 == 42);
      CHECK(v1 == 127);
   }
   {
      auto v = psio::view<std::tuple<std::uint8_t, std::uint8_t>>(bin);
      CHECK(get<0>(v) == 42);
      CHECK(get<1>(v) == 127);
      CHECK(v.unpack() == t);
      auto [v0, v1] = v;
      CHECK(v0 == 42);
      CHECK(v1 == 127);
      get<0>(v) = 0xCC;
      get<1>(v) = 0xFF;
      CHECK(psio::from_frac<std::tuple<std::uint8_t, std::uint8_t>>(bin) == std::tuple{0xCC, 0xFF});
   }
}

struct struct0
{
   std::uint8_t v0;
   std::uint8_t v1;
   friend bool  operator==(const struct0&, const struct0&) = default;
};
PSIO_REFLECT(struct0, v0, v1)

TEST_CASE("struct view", "[view]")
{
   auto bin = psio::to_frac(struct0{42, 127});
   {
      auto v = psio::view<const struct0>(bin);
      CHECK(v.v0() == 42);
      CHECK(v.v1() == 127);
   }
   {
      auto v = psio::view<struct0>(bin);
      CHECK(v.v0() == 42);
      CHECK(v.v1() == 127);
      v.v0() = 0xFF;
      v.v1() = 0xCC;
      CHECK(psio::from_frac<struct0>(bin) == struct0{0xFF, 0xCC});
   }
}

TEST_CASE("optional view empty", "[view]")
{
   auto bin = psio::to_frac(std::optional<std::uint8_t>{});
   {
      auto v = psio::view<const std::optional<std::uint8_t>>(bin);
      CHECK(!v);
      CHECK(!v.has_value());
      CHECK(v.value_or(42) == 42);
      CHECK_THROWS_AS(v.value(), std::bad_optional_access);
   }
   {
      auto v = psio::view<std::optional<std::uint8_t>>(bin);
      CHECK(!v);
      CHECK(!v.has_value());
      CHECK(v.value_or(42) == 42);
      CHECK_THROWS_AS(v.value(), std::bad_optional_access);
   }
}

TEST_CASE("optional view value", "[view]")
{
   auto bin = psio::to_frac(std::optional<std::uint8_t>{42});
   {
      auto v = psio::view<const std::optional<std::uint8_t>>(bin);
      CHECK(!!v);
      CHECK(v.has_value());
      CHECK(*v == 42);
      CHECK(v.value() == 42);
      std::optional<std::uint8_t> copy = v;
      CHECK(copy.has_value());
      CHECK(*copy == 42);
      CHECK(v.value_or(0xFF) == 42);
   }
   {
      auto v = psio::view<std::optional<std::uint8_t>>(bin);
      CHECK(!!v);
      CHECK(v.has_value());
      CHECK(*v == 42);
      CHECK(v.value() == 42);
      std::optional<std::uint8_t> copy = v;
      CHECK(copy.has_value());
      CHECK(*copy == 42);
      CHECK(v.value_or(0xFF) == 42);
   }
}

TEST_CASE("optional struct view", "[view]")
{
   auto bin = psio::to_frac(std::optional{struct0{42, 127}});
   {
      auto v = psio::view<const std::optional<struct0>>(bin);
      CHECK(v.has_value());
      CHECK(v->v0() == 42);
      CHECK(v->v1() == 127);
   }
   {
      auto v = psio::view<std::optional<struct0>>(bin);
      CHECK(v.has_value());
      CHECK(v->v0() == 42);
      CHECK(v->v1() == 127);
      v->v0() = 0xCC;
      v->v1() = 0xFF;

      CHECK(psio::from_frac<std::optional<struct0>>(bin) == struct0{0xCC, 0xFF});
   }
}

namespace
{

   std::string make_string(const std::string& s)
   {
      return s;
   }

   std::string make_string(std::uint8_t i)
   {
      return std::to_string(i);
   }

}  // namespace

TEST_CASE("variant", "[view]")
{
   std::variant<std::uint8_t, std::string> var(std::uint8_t{42});
   auto                                    bin = psio::to_frac(var);
   {
      auto v = psio::view<const decltype(var)>(bin);
      CHECK(holds_alternative<std::uint8_t>(v));
      CHECK(v.index() == 0);
      CHECK(visit([](auto x) { return make_string(x); }, v) == "42");
      CHECK(get<0>(v) == 42);
      CHECK_THROWS_AS(get<1>(v), std::bad_variant_access);
      CHECK(get<std::uint8_t>(v) == 42);
      CHECK_THROWS_AS(get<std::string>(v), std::bad_variant_access);
      CHECK(*get_if<0>(v) == 42);
      CHECK(!get_if<1>(v));
      CHECK(*get_if<std::uint8_t>(v) == 42);
      CHECK(!get_if<std::string>(v));
   }
   {
      auto v = psio::view<decltype(var)>(bin);
      CHECK(holds_alternative<std::uint8_t>(v));
      CHECK(v.index() == 0);
      CHECK(visit([](auto x) { return make_string(x); }, v) == "42");
      CHECK(get<0>(v) == 42);
      CHECK_THROWS_AS(get<1>(v), std::bad_variant_access);
      CHECK(get<std::uint8_t>(v) == 42);
      CHECK_THROWS_AS(get<std::string>(v), std::bad_variant_access);
      CHECK(*get_if<0>(v) == 42);
      CHECK(!get_if<1>(v));
      CHECK(*get_if<std::uint8_t>(v) == 42);
      CHECK(!get_if<std::string>(v));

      get<0>(v) = 0xFF;
      CHECK(psio::from_frac<decltype(var)>(bin) == decltype(var){std::uint8_t{0xFF}});
   }
}
