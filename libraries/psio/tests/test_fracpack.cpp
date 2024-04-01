#include "test_fracpack.hpp"

TEST_CASE("roundtrip")
{
   test<std::string>({"", "Lorem ipsum dolor sit amet"});
   test<std::tuple<>>({std::tuple()});
   test<std::variant<std::int32_t, double, std::string>>(
       {1, 2.0, "Although I am an old man, night is generally my time for walking."});
}

namespace psio
{

   template <typename S>
   struct expand_shared_view_ptr_stream : S
   {
      using S::S;
   };

   template <typename T, typename S>
   void to_json(const shared_view_ptr<T>& obj, expand_shared_view_ptr_stream<S>& stream)
   {
      to_json(obj->unpack(), stream);
   }

   std::string expand_json(const auto& t)
   {
      expand_shared_view_ptr_stream<size_stream> ss;
      to_json(t, ss);
      std::string                                     result(ss.size, 0);
      expand_shared_view_ptr_stream<fixed_buf_stream> fbs(result.data(), result.size());
      to_json(t, fbs);
      if (fbs.pos != fbs.end)
         abort_error(stream_error::underrun);
      return result;
   }

}  // namespace psio

template <typename T, typename U>
void test_compat(const T& t, const U& u, bool expect_unknown)
{
   std::vector<char>   data;
   psio::vector_stream out{data};
   psio::is_packable<T>::pack(t, out);
   INFO("data: " << psio::hex(data.begin(), data.end()));
   INFO("type: " << boost::core::demangle(typeid(U).name()));
   {
      U             result{};
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      bool          known_end;
      CHECK(psio::is_packable<U>::template unpack<true, true>(&result, has_unknown, known_end,
                                                              data.data(), pos, data.size()));
      CHECK(has_unknown == expect_unknown);
      CHECK_THAT(result, BitwiseEqual(u));
      if (!expect_unknown)
         CHECK(known_end);
      if (known_end)
         CHECK(pos == data.size());
   }
   {
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      bool          known_end;
      CHECK(psio::is_packable<U>::template unpack<false, true>(nullptr, has_unknown, known_end,
                                                               data.data(), pos, data.size()));
      CHECK(has_unknown == expect_unknown);
      if (!expect_unknown)
         CHECK(known_end);
      if (known_end)
         CHECK(pos == data.size());
   }
   {
      U             result{};
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      bool          known_end;
      CHECK(psio::is_packable<U>::template unpack<true, false>(&result, has_unknown, known_end,
                                                               data.data(), pos, data.size()));
      CHECK(has_unknown == false);  // Not modified when Verify is false
      CHECK_THAT(result, BitwiseEqual(u));
      // known_end can't be used because it is uninitialzed when Verify is false
      if (!expect_unknown)
         CHECK(pos == data.size());
   }
   {
      CHECK_THAT(psio::from_frac<U>(data), BitwiseEqual(u));
      CHECK_THAT(psio::from_frac<U>(psio::prevalidated{data}), BitwiseEqual(u));
      CHECK(psio::fracpack_validate<U>(data) ==
            (expect_unknown ? psio::validation_t::extended : psio::validation_t::valid));
   }
   {
      using namespace psio::schema_types;
      psio::Schema s1 = psio::SchemaBuilder().insert<T>("T").build();
      psio::Schema s2 = psio::SchemaBuilder().expandNested().insert<U>("U").build();
      INFO("schema1: " << psio::format_json(s1));
      INFO("schema2: " << psio::format_json(s2));
      // validate schema comparison
      auto diff = match(s1, s2, {{psio::schema_types::Type{"T"}, psio::schema_types::Type{"U"}}});
      if (expect_unknown)
      {
         CHECK((diff & psio::SchemaDifference::dropField) != 0);
         diff &= ~psio::SchemaDifference::dropField;
      }
      CHECK((diff & ~(psio::SchemaDifference::upgrade)) == 0);
      // validate compatible serialization
      CompiledSchema      cschema(s2);
      FracParser          parser{data, cschema, "U"};
      std::vector<char>   json;
      psio::vector_stream out{json};
      to_json(parser, out);
      CHECK(std::string_view{json.data(), json.size()} == psio::expand_json(u));
      if (parser.in.known_end)
         CHECK(parser.in.pos == parser.in.end_pos);
      CHECK(parser.in.has_unknown == expect_unknown);
   }
}

template <typename T, typename U>
void test_compat_wrap(const T& t, const U& u, bool expect_unknown)
{
   using namespace std::literals;
   test_compat(t, u, expect_unknown);
   test_compat(std::optional{t}, std::optional{u}, expect_unknown);
   test_compat(std::vector{t}, std::vector{u}, expect_unknown);
   test_compat(std::tuple{t, "It is an ancient mariner"s},
               std::tuple{u, "It is an ancient mariner"s}, expect_unknown);
   test_compat(std::optional{std::vector{t}}, std::optional{std::vector{u}}, expect_unknown);
   test_compat(extensible_wrapper{t}, extensible_wrapper{u}, expect_unknown);
   test_compat(extensible_wrapper{std::optional{t}}, extensible_wrapper{std::optional{u}},
               expect_unknown);
   test_compat(extensible_wrapper{std::vector{t}}, extensible_wrapper{std::vector{u}},
               expect_unknown);
   test_compat(nonextensible_wrapper{t}, nonextensible_wrapper{u}, expect_unknown);
   test_compat(nonextensible_wrapper{std::optional{t}}, nonextensible_wrapper{std::optional{u}},
               expect_unknown);
   test_compat(nonextensible_wrapper{std::vector{t}}, nonextensible_wrapper{std::vector{u}},
               expect_unknown);
   test_compat(std::array{t}, std::array{u}, expect_unknown);
   test_compat(std::variant<T>{t}, std::variant<U>{u}, expect_unknown);
   test_compat(psio::shared_view_ptr{t}, psio::shared_view_ptr{u}, expect_unknown);
   test_compat(psio::shared_view_ptr<T>{t}, to_bytes(psio::to_frac(t)), false);
}

template <typename...>
struct struct_;

template <>
struct struct_<>
{
   PSIO_REFLECT(struct_);
   friend bool operator==(const struct_&, const struct_&) = default;
};

template <typename T0>
struct struct_<T0>
{
   T0 v0;
   PSIO_REFLECT(struct_, v0)
   friend bool operator==(const struct_& lhs, const struct_& rhs)
   {
      return bitwise_equal(lhs.v0, rhs.v0);
   }
};

template <typename T0, typename T1>
struct struct_<T0, T1>
{
   T0 v0;
   T1 v1;
   PSIO_REFLECT(struct_, v0, v1)
   friend bool operator==(const struct_& lhs, const struct_& rhs)
   {
      return bitwise_equal(lhs.v0, rhs.v0) && bitwise_equal(lhs.v1, rhs.v1);
   }
};

template <typename T0, typename T1, typename T2>
struct struct_<T0, T1, T2>
{
   T0 v0;
   T1 v1;
   T2 v2;
   PSIO_REFLECT(struct_, v0, v1, v2)
   friend bool operator==(const struct_& lhs, const struct_& rhs)
   {
      return bitwise_equal(lhs.v0, rhs.v0) && bitwise_equal(lhs.v1, rhs.v1) &&
             bitwise_equal(lhs.v2, rhs.v2);
   }
};

TEST_CASE("compatibility")
{
   using namespace std::literals;
   test_compat_wrap(""sv, ""s, false);
   test_compat_wrap("Tyger Tyger, burning bright"sv, "Tyger Tyger, burning bright"s, false);
   test_compat_wrap(std::tuple<std::int32_t>(42),
                    std::tuple<std::int32_t, std::optional<std::int32_t>>(42, std::nullopt), false);
   test_compat_wrap(std::tuple<std::int32_t, std::optional<std::int32_t>>(42, 43),
                    std::tuple<std::int32_t>(42), true);
   test_compat_wrap(std::tuple(), std::tuple<std::optional<std::uint8_t>>(std::nullopt), false);
   test_compat_wrap(std::tuple<std::optional<std::uint8_t>>(42), std::tuple(), true);
   test_compat_wrap(struct_<std::int32_t>(42),
                    struct_<std::int32_t, std::optional<std::int32_t>>(42, std::nullopt), false);
   test_compat_wrap(struct_<std::int32_t, std::optional<std::int32_t>>(42, 43),
                    struct_<std::int32_t>(42), true);
   test_compat_wrap(
       std::tuple(std::tuple(std::optional{std::uint8_t{0xFF}}), std::optional{std::uint8_t{0xCC}}),
       std::tuple<std::tuple<>>{}, true);
}

template <typename T>
void test_invalid(const char* hex)
{
   INFO("data: " << hex);
   INFO("type: " << boost::core::demangle(typeid(T).name()));
   std::vector<char> data;
   CHECK(psio::from_hex(hex, data));
   {
      T             result{};
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      bool          known_end;
      CHECK(!psio::is_packable<T>::template unpack<true, true>(&result, has_unknown, known_end,
                                                               data.data(), pos, data.size()));
   }
   {
      std::uint32_t pos         = 0;
      bool          has_unknown = false;
      bool          known_end;
      CHECK(!psio::is_packable<T>::template unpack<false, true>(nullptr, has_unknown, known_end,
                                                                data.data(), pos, data.size()));
   }
   {
      using namespace psio::schema_types;
      Schema schema = SchemaBuilder().insert<T>("T").build();
      INFO("schema: " << psio::format_json(schema));
      CompiledSchema cschema(schema);
      CHECK(!fracpack_validate(data, cschema, "T"));
   }
}

template <typename T>
void test_invalid(std::initializer_list<const char*> hex)
{
   for (const char* h : hex)
   {
      test_invalid<T>(h);
   }
}

TEST_CASE("invalid")
{
   // bool is 0 or 1
   test_invalid<bool>({"02", "03", "FF"});
   // optional must be 1 or an offset pointer
   test_invalid<std::optional<std::uint8_t>>({"00000000", "02000000", "03000000", "05000000FFFF"});
   // vector byte size must be a multiple of the element size
   test_invalid<std::vector<std::uint16_t>>("03000000FFFFFFFFFFFF");
   // negative offset
   test_invalid<std::tuple<std::uint32_t, std::optional<std::uint8_t>>>("0800CCCCCCCCFFFFFFFF");
   test_invalid<struct_<std::uint32_t, std::optional<std::uint8_t>>>("0800CCCCCCCCFFFFFFFF");
   // gaps after unknown fields
   test_invalid<std::tuple<std::tuple<std::uint32_t>,
                           std::tuple<std::uint32_t, std::optional<std::uint8_t>>>>(
       "0800"
       "08000000"
       "0F000000"
       "0800CCCCCCCC04000000FF"
       "0800DDDDDDDD05000000EEEE");
   test_invalid<
       struct_<struct_<std::uint32_t>, struct_<std::uint32_t, std::optional<std::uint8_t>>>>(
       "0800"
       "08000000"
       "0F000000"
       "0800CCCCCCCC04000000FF"
       "0800DDDDDDDD05000000EEEE");
   // Malformed extensions
   test_invalid<std::tuple<>>({"0100FF", "040002000000", "040005000000FFFF", "08000800000005000000",
                               "08000100000005000000FF", "0C000C0000000900000004000000FF"});
   test_invalid<struct_<>>({"0100FF", "040002000000", "040005000000FFFF", "08000800000005000000",
                            "08000100000005000000FF", "0C000C0000000900000004000000FF"});
   // variant cannot unpack unknown alternatives; known alternatives must have the correct size
   test_invalid<std::variant<std::uint8_t>>({"0002000000FFFF", "0101000000FF"});
   // No trailing empty optionals
   test_invalid<std::tuple<std::optional<std::uint8_t>>>(
       {"040001000000", "08000100000001000000", "08000800000001000000FF"});
   test_invalid<std::tuple<>>({"040001000000", "08000100000001000000", "08000800000001000000FF"});
   test_invalid<struct_<std::optional<std::uint8_t>>>(
       {"040001000000", "08000100000001000000", "08000800000001000000FF"});
   test_invalid<struct_<>>({"040001000000", "08000100000001000000", "08000800000001000000FF"});
   // Offset pointer to empty container must use compression
   test_invalid<std::optional<std::string>>("0400000000000000");
   test_invalid<std::optional<std::vector<std::uint8_t>>>("0400000000000000");
   test_invalid<std::optional<std::vector<std::tuple<>>>>("0400000000000000");
   test_invalid<std::tuple<std::string>>("04000400000000000000");
   test_invalid<std::tuple<std::vector<std::uint8_t>>>("04000400000000000000");
   test_invalid<std::tuple<std::vector<std::tuple<>>>>("04000400000000000000");
   test_invalid<struct_<std::string>>("04000400000000000000");
   test_invalid<struct_<std::vector<std::uint8_t>>>("04000400000000000000");
   test_invalid<struct_<std::vector<std::tuple<>>>>("04000400000000000000");
}
