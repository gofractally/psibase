#include <catch2/catch.hpp>
#include <iostream>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>

TEST_CASE("invalid-account-names-are-zeroed")
{
   auto acc = psibase::AccountNumber("9");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("3");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("1abc");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("1234");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("9asdf");
   REQUIRE(acc.value == 0);

   acc = psibase::AccountNumber("");
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
   REQUIRE(psibase::AccountNumber("a").value == 49158);
   REQUIRE(psibase::AccountNumber("b").value == 184);
   REQUIRE(psibase::AccountNumber("c").value == 16538);
   REQUIRE(psibase::AccountNumber("abc123").value == 1754468116);
   REQUIRE(psibase::AccountNumber("spiderman").value == 483466201442);
   REQUIRE(psibase::AccountNumber("brucewayne").value == 132946582102463);
   REQUIRE(psibase::AccountNumber("anthonystark").value == 183678712946955);
   REQUIRE(psibase::AccountNumber("natasharomanoff").value == 5818245174062392369);
}

TEST_CASE("convert-account-names-back-to-string")
{
   REQUIRE(psibase::AccountNumber(49158).str() == "a");
   REQUIRE(psibase::AccountNumber(184).str() == "b");
   REQUIRE(psibase::AccountNumber(16538).str() == "c");
   REQUIRE(psibase::AccountNumber(1754468116).str() == "abc123");
   REQUIRE(psibase::AccountNumber(483466201442).str() == "spiderman");
   REQUIRE(psibase::AccountNumber(132946582102463).str() == "brucewayne");
   REQUIRE(psibase::AccountNumber(183678712946955).str() == "anthonystark");
   REQUIRE(psibase::AccountNumber(5818245174062392369).str() == "natasharomanoff");
   REQUIRE(psibase::AccountNumber(0).str() == "");
}

TEST_CASE("invalid-method-names-are-zeroed")
{
   auto acc = psibase::MethodNumber("");
   REQUIRE(acc.value == 0);

   acc = psibase::MethodNumber("?");
   REQUIRE(acc.value == 0);

   acc = psibase::MethodNumber("a?");
   REQUIRE(acc.value == 0);

   acc = psibase::MethodNumber("eaorintsl?");
   REQUIRE(acc.value == 0);
}

TEST_CASE("valid-method-names-check")
{
   REQUIRE(psibase::MethodNumber("a").value == 32783);
   REQUIRE(psibase::MethodNumber("b").value == 196);
   REQUIRE(psibase::MethodNumber("c").value == 32884);
   REQUIRE(psibase::MethodNumber("abc123").value == 691485674271);
   REQUIRE(psibase::MethodNumber("spiderman").value == 311625498215);
   REQUIRE(psibase::MethodNumber("brucewayne").value == 56488722015273161);
   REQUIRE(psibase::MethodNumber("anthonystark").value == 50913722085663764);
   REQUIRE(psibase::MethodNumber("natasharomanoff").value == 13346021867974402139);
}

TEST_CASE("convert-method-names-back-to-string")
{
   REQUIRE(psibase::MethodNumber(32783).str() == "a");
   REQUIRE(psibase::MethodNumber(196).str() == "b");
   REQUIRE(psibase::MethodNumber(32884).str() == "c");
   REQUIRE(psibase::MethodNumber(311625498215).str() == "spiderman");
   REQUIRE(psibase::MethodNumber(56488722015273161).str() == "brucewayne");
   REQUIRE(psibase::MethodNumber(50913722085663764).str() == "anthonystark");
   REQUIRE(psibase::MethodNumber(13346021867974402139).str() == "#hneunophpilcroch");
   REQUIRE(psibase::MethodNumber(0).str() == "");
}