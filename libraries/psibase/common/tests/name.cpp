#include <catch2/catch_all.hpp>
#include <iostream>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psio/fracpack.hpp>

TEST_CASE("invalid-account-names-are-zeroed")
{
   auto acc = psibase::AccountNumber("");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("?");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("what?");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("?what");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("eaorintsl?");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("????");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("abcdefghijklmnopqrstuvwxyz");
   REQUIRE(acc.value == 0);
}

TEST_CASE("valid-account-names-check")
{
   CHECK(psibase::AccountNumber("a").value == 331048532879956736);
   CHECK(psibase::AccountNumber("b").value == 364153386167952384);
   CHECK(psibase::AccountNumber("c").value == 397258239455948032);
   CHECK(psibase::AccountNumber("abc123").value == 342084831226198272);
   CHECK(psibase::AccountNumber("spiderman").value == 950660654012764416);
   CHECK(psibase::AccountNumber("brucewayne").value == 389958816282596608);
   CHECK(psibase::AccountNumber("a+0").value == 331048532879956736);
   CHECK(psibase::AccountNumber("a+42").value == 331048532879956736 + 42);
   CHECK(psibase::AccountNumber("a+9").value == 331048532879956736 + 9);
   CHECK(psibase::AccountNumber("a+90").value == 331048532879956736 + 90);
   CHECK(psibase::AccountNumber("spiderman+255").value == 950660654012764416 + 255);
}

TEST_CASE("convert-account-names-back-to-string")
{
   CHECK(psibase::AccountNumber(331048532879956736).str() == "a");
   CHECK(psibase::AccountNumber(364153386167952384).str() == "b");
   CHECK(psibase::AccountNumber(397258239455948032).str() == "c");
   CHECK(psibase::AccountNumber(342084831226198272).str() == "abc123");
   CHECK(psibase::AccountNumber(950660654012764416).str() == "spiderman");
   CHECK(psibase::AccountNumber(389958816282596608).str() == "brucewayne");
   CHECK(psibase::AccountNumber(331048532879956736 + 42).str() == "a+42");
   CHECK(psibase::AccountNumber(331048532879956736 + 9).str() == "a+9");
   CHECK(psibase::AccountNumber(331048532879956736 + 90).str() == "a+90");
   CHECK(psibase::AccountNumber(950660654012764416 + 255).str() == "spiderman+255");
   CHECK(psibase::AccountNumber(0).str() == "");
}

namespace action_name_tests
{
   struct Reflected
   {
      uint64_t token_id = 7;
      int      registerEventIndex() { return 11; }
      int      requestRecovery() { return 23; }
   };
   PSIO_REFLECT(Reflected, token_id, method(registerEventIndex), method(requestRecovery))
}  // namespace action_name_tests

TEST_CASE("action-name-constant-generation")
{
   using namespace psibase::literals;
   constexpr psibase::ActionName name{"registerEventIndex"};
   constexpr auto                literal = "registerEventIndex"_action;
   static_assert(name == literal);
   static_assert("requestRecovery"_m == "requestrecovery"_action);
   static_assert(sizeof(psibase::ActionName) == sizeof(uint64_t));
   static_assert(std::is_same_v<psibase::ActionName, psibase::MethodNumber>);
   static_assert(name.value == psio::hash_name("registerEventIndex"));
   CHECK(name.str() == "registereventindex");
}

TEST_CASE("action-name-full-round-trips")
{
   for (std::string_view text :
        {"a", "b", "abc123", "foo_bar", "fooqbar", "load0", "loado", "regEvIdx", "sx", "szziat",
         "requestRecovery", "cpu_blocks_avg", "set_guild_weight_curve", "registerEventIndex"})
   {
      auto value   = psibase::ActionName{text};
      auto decoded = value.str();
      CHECK(psibase::ActionName{decoded} == value);
      std::string lower{text};
      for (auto& c : lower)
         if (c >= 'A' && c <= 'Z')
            c = c - 'A' + 'a';
      CHECK((decoded == lower || decoded.starts_with('#')));
   }
   CHECK(psibase::ActionName{"foo_bar"} != psibase::ActionName{"fooqbar"});
   CHECK(psibase::ActionName{"load0"} != psibase::ActionName{"loado"});
   CHECK(psibase::ActionName{"sx"} != psibase::ActionName{"szziat"});
}

TEST_CASE("action-name-invalid-input-is-explicit")
{
   for (std::string_view input : {"", "?", "a?", "foo-bar", "0abc", "a b", "#short",
                                  "#0000000000000000", "#C000000000000000", "#zzzzzzzzzzzzzzzz"})
      CHECK_FALSE(psibase::ActionName::parse(input));
   CHECK_FALSE(psibase::ActionName::parse(std::string(257, 'a')));
   CHECK_FALSE(psio::action_names::try_decode(0));
   CHECK_FALSE(psio::action_names::try_decode(uint64_t{2} << 62));
   CHECK(psibase::ActionName{}.str() == "<invalid-action-name:0000000000000000>");
   CHECK_FALSE(psibase::ActionName::parse(psibase::ActionName{}.str()));
}

TEST_CASE("action-name-hash-literals-and-bounds")
{
   constexpr auto sha_input = psio::action_names::impl::normalize(
       "this_is_a_model_independent_sha_padding_vector_with_more_than_sixty_four_ascii_characters_"
       "0123456789");
   static_assert(sha_input.has_value());
   static_assert(psio::action_names::impl::hash(*sha_input) == 14161499883774062114ULL);
   for (std::string_view text : {"#c000000000000000", "#ffffffffffffffff", "#d0123456789abcde"})
   {
      auto value = psibase::ActionName{text};
      CHECK(psio::action_names::is_hash(value.value));
      CHECK(value.str() == text);
   }
   auto input = std::string(256, 'x');
   auto value = psibase::ActionName::parse(input);
   REQUIRE(value);
   CHECK(psibase::ActionName{value->str()} == *value);
}

TEST_CASE("action-name-json-and-numeric-reflection")
{
   auto name = psibase::ActionName{"requestRecovery"};
   auto json = psio::convert_to_json(name);
   CHECK(psio::convert_from_json<psibase::ActionName>(json) == name);
   auto packed = psio::convert_to_frac(name);
   REQUIRE(packed.size() == 8);
   CHECK(psio::from_frac<psibase::ActionName>(packed) == name);
   for (unsigned i = 0; i < 8; ++i)
      CHECK(static_cast<unsigned char>(packed[i]) == ((name.value >> (i * 8)) & 255));
   action_name_tests::Reflected object;
   int                          result = 0;
   auto                         called = psio::get_member_function<action_name_tests::Reflected>(
       psibase::ActionName{"registerEventIndex"}.value,
       [&](auto member, auto) { result = (object.*member)(); });
   CHECK(called);
   CHECK(result == 11);
   constexpr auto generated =
       psio::reflect<action_name_tests::Reflected>::member_function_numbers[1];
   static_assert(generated == psibase::ActionName{"requestRecovery"}.value);
   called = psio::get_member_function<action_name_tests::Reflected>(
       generated, [&](auto member, auto) { result = (object.*member)(); });
   CHECK(called);
   CHECK(result == 23);
   int type_matches = 0;
   CHECK(psio::get_member_function_type<action_name_tests::Reflected>(
       generated, [&](auto, auto) { ++type_matches; }));
   CHECK(type_matches == 1);
   CHECK(psio::reflect<action_name_tests::Reflected>::data_member_name_numbers[0] ==
         psio::hash_name("token_id"));
}
