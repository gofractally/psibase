#include <psibase/crypto.hpp>

#include <psio/from_json.hpp>

#include <psibase/tester.hpp>

#include <catch2/catch.hpp>

using namespace std::literals::string_literals;
using namespace psibase;

Checksum256 c256(std::string_view s)
{
   Checksum256 result;
   check(s.size() == 2 * result.size(), "wrong size for sha256");
   check(psio::unhex(result.begin(), s.begin(), s.end()), "expected hex string");
   return result;
}

TEST_CASE("sha256")
{
   CHECK(sha256("", 0) == c256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
}

TEST_CASE("merkle")
{
   Merkle m;
   CHECK(m.root() == Checksum256{});
   m.push("Humpty Dumpty sat on a wall"s);
   CHECK(m.root() == c256("7dc04c8ce45a4ccb47e8c27b6a2670d6d20afe0d76df7619a5f1bcf111caac30"));
   m.push("Humpty Dumpty had a great fall"s);
   CHECK(m.root() == c256("49c42986a440d7aaff541c12b4efdda90c1d2c22fd69caff665d56b59c781408"));
   m.push("All the king's horses and all the kings men"s);
   CHECK(m.root() == c256("d29bf8f14d8f94f15ead4530d4fbce2b9364f87b3c1fae79807ff66e24be62b7"));
   m.push("Couldn't put Humpty together again"s);
   CHECK(m.root() == c256("2f699f82a77b0f03d62f368af6f4e76619807d6c77794ee44ca6901a59e4ed9f"));
}
