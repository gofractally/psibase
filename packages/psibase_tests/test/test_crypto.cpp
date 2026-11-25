#include <psibase/crypto.hpp>

#include <psio/to_hex.hpp>

#include <psibase/tester.hpp>

#include <catch2/catch_all.hpp>

using namespace std::literals::string_literals;
using namespace psibase;

Checksum256 c256(std::string_view s)
{
   Checksum256 result;
   check(s.size() == 2 * result.size(), "wrong size for sha256");
   check(psio::from_hex(s, result), "expected hex string");
   return result;
}

TEST_CASE("sha256")
{
   CHECK(sha256("", 0) == c256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
}

// A leaf is SHA-256 of 00 and the PSSZ of the value (a string: its bytes);
// an inner node is SHA-256 of 01, left, right.
TEST_CASE("merkle")
{
   Merkle m;
   CHECK(m.root() == Checksum256{});
   m.push("Humpty Dumpty sat on a wall"s);
   CHECK(m.root() == c256("307078b83cc2c8f389908022f097c6dee3bed23a0b6a4778c3f747bfb1749f30"));
   m.push("Humpty Dumpty had a great fall"s);
   CHECK(m.root() == c256("f974891c81e51376daeed44c8fddeab33785e1598de2c9dbc0fd425ade76f383"));
   m.push("All the king's horses and all the kings men"s);
   CHECK(m.root() == c256("b103968b7cf50a054a5cdd69e987e5c4c0924d1ebeb0edae8c7fbdcbd16b905b"));
   m.push("Couldn't put Humpty together again"s);
   CHECK(m.root() == c256("f60cc86c09c3123f0bca6551fcbcab93713675b98e97871cdcdb8280f945471c"));
}

// Test vectors from RFC 4231
TEST_CASE("hmac-sha256")
{
   {
      std::string key(20, 0x0b);
      std::string data("Hi There");
      CHECK(hmacSha256(key, data) ==
            c256("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"));
   }
   {
      std::string key("Jefe");
      std::string data("what do ya want for nothing?");
      CHECK(hmacSha256(key, data) ==
            c256("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"));
   }
   {
      std::string key(20, 0xaa);
      std::string data(50, 0xdd);
      CHECK(hmacSha256(key, data) ==
            c256("773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe"));
   }
   {
      std::string key(
          "\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16"
          "\x17\x18\x19");
      std::string data(50, 0xcd);
      CHECK(hmacSha256(key, data) ==
            c256("82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b"));
   }
   // Skip Test Case 5, because we don't do truncation
   {
      std::string key(131, 0xaa);
      std::string data("Test Using Larger Than Block-Size Key - Hash Key First");
      CHECK(hmacSha256(key, data) ==
            c256("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"));
   }
   {
      std::string key(131, 0xaa);
      std::string data(
          "This is a test using a larger than block-size key and a larger than block-size data. "
          "The key needs to be hashed before being used by the HMAC algorithm.");
      CHECK(hmacSha256(key, data) ==
            c256("9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2"));
   }
}

TEST_CASE("hmac-sha256 extra")
{
   {
      std::string key("A key sixty four bytes long, which is the block size for SHA256.");
      std::string data("The quick brown fox jumps over the lazy dog");
      CHECK(hmacSha256(key, data) ==
            c256("709B1EF75B86F4EDD8B0C7E3FD665D552BE12AC54C27465CE04051CDB8137F5F"));
   }
}
