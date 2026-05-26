#include <catch2/catch_all.hpp>
#include <iostream>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>

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
   REQUIRE(psibase::MethodNumber("natasharomanoff").value == 6905860632893337981);
   REQUIRE(psibase::MethodNumber("NATASHAROMANOFF").value == 679355919866582572);
   REQUIRE(psibase::MethodNumber("abcdefghijklmnopqrstuvwxyz").value == 2393445670689189432);
}

TEST_CASE("convert-method-names-back-to-string")
{
   REQUIRE(psibase::MethodNumber(32783).str() == "a");
   REQUIRE(psibase::MethodNumber(196).str() == "b");
   REQUIRE(psibase::MethodNumber(32884).str() == "c");
   REQUIRE(psibase::MethodNumber(311625498215).str() == "spiderman");
   REQUIRE(psibase::MethodNumber(56488722015273161).str() == "brucewayne");
   REQUIRE(psibase::MethodNumber(50913722085663764).str() == "anthonystark");
   REQUIRE(psibase::MethodNumber(6905860632893337981).str() == "#psaoryoiluhlrpyn");
   REQUIRE(psibase::MethodNumber(0).str() == "");
}
