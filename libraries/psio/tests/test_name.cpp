#include <cstddef>
#include <psio/compress_name.hpp>

#include <catch2/catch.hpp>

TEST_CASE("test compress_name")
{
   CHECK(psio::detail::method_to_number("") == 0);
   CHECK(psio::detail::number_to_method(0) == "");
   CHECK(psio::detail::method_to_number("a") == 32783);
   CHECK(psio::detail::number_to_method(32783) == "a");
   CHECK(psio::detail::method_to_number("b") == 196);
   CHECK(psio::detail::number_to_method(196) == "b");
   CHECK(psio::detail::method_to_number("c") == 32884);
   CHECK(psio::detail::number_to_method(32884) == "c");
   CHECK(psio::detail::method_to_number("spiderman") == 311625498215);
   CHECK(psio::detail::number_to_method(311625498215) == "spiderman");
   CHECK(psio::detail::method_to_number("anthonystark") == 50913722085663764);
   CHECK(psio::detail::number_to_method(50913722085663764) == "anthonystark");
   CHECK(psio::detail::method_to_number("natasharomanoff") == 6905860632893337981);
   CHECK(psio::detail::method_to_number("#psaoryoiluhlrpyn") == 6905860632893337981);
   CHECK(psio::detail::number_to_method(6905860632893337981) == "#psaoryoiluhlrpyn");
   CHECK(psio::detail::method_to_number("NATASHAROMANOFF") == 679355919866582572);
   CHECK(psio::detail::method_to_number("abcdefghijklmnopqrstuvwxyz") == 2393445670689189432);
}
