// Bitcoin's wallet import format as psibase/wif.hpp defines it, against
// `wif-vectors.json` beside this file. The Rust (`rust/psibase/src/wif.rs`),
// TypeScript (common-lib `test/wif.test.mjs`) and Python
// (`programs/psinode/tests/test_wif.py`) implementations read the same file.
//
// Native only (it reads a file of the source tree and derives public keys
// with OpenSSL).
#include <psibase/OpenSSLProver.hpp>
#include <psibase/block.hpp>
#include <psibase/verifier.hpp>
#include <psibase/wif.hpp>

#include <catch2/catch_all.hpp>
#include <openssl/bn.h>
#include <openssl/ec.h>
#include <openssl/obj_mac.h>
#include <rapidjson/document.h>

#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using namespace psibase;

namespace
{
   rapidjson::Document loadVectors()
   {
      std::ifstream in{PSIBASE_WIF_VECTORS, std::ios::binary};
      REQUIRE(in.good());
      std::string text{std::istreambuf_iterator<char>{in}, std::istreambuf_iterator<char>{}};
      rapidjson::Document doc;
      doc.Parse(text.data(), text.size());
      REQUIRE(!doc.HasParseError());
      return doc;
   }

   std::string str(const rapidjson::Value& v)
   {
      return std::string{v.GetString(), v.GetStringLength()};
   }

   std::vector<unsigned char> unhex(std::string_view text)
   {
      auto nibble = [](char ch) -> unsigned
      { return ch <= '9' ? ch - '0' : (ch | 0x20) - 'a' + 10; };
      std::vector<unsigned char> result;
      for (std::size_t i = 0; i + 1 < text.size(); i += 2)
         result.push_back(static_cast<unsigned char>(nibble(text[i]) * 16 + nibble(text[i + 1])));
      return result;
   }

   // The public key of `secret` as a SEC1 point
   std::vector<unsigned char> publicKey(std::span<const unsigned char, 32> secret, bool compressed)
   {
      EC_GROUP* group = EC_GROUP_new_by_curve_name(NID_secp256k1);
      BIGNUM*   d     = BN_bin2bn(secret.data(), secret.size(), nullptr);
      EC_POINT* point = EC_POINT_new(group);
      REQUIRE(EC_POINT_mul(group, point, d, nullptr, nullptr, nullptr) == 1);
      std::vector<unsigned char> result(compressed ? 33 : 65);
      auto form = compressed ? POINT_CONVERSION_COMPRESSED : POINT_CONVERSION_UNCOMPRESSED;
      REQUIRE(EC_POINT_point2oct(group, point, form, result.data(), result.size(), nullptr) ==
              result.size());
      EC_POINT_free(point);
      BN_clear_free(d);
      EC_GROUP_free(group);
      return result;
   }

   // SubjectPublicKeyInfo of a secp256k1 point
   std::vector<unsigned char> spki(std::span<const unsigned char> point)
   {
      auto                       alg = verifier::algorithm(KeyType::secp256k1);
      std::vector<unsigned char> result{0x30,
                                        static_cast<unsigned char>(alg.size() + 3 + point.size())};
      result.insert(result.end(), alg.begin(), alg.end());
      result.insert(result.end(), {0x03, static_cast<unsigned char>(point.size() + 1), 0x00});
      result.insert(result.end(), point.begin(), point.end());
      return result;
   }
}  // namespace

TEST_CASE("wif: valid vectors")
{
   auto        doc   = loadVectors();
   const auto& valid = doc["valid"];
   REQUIRE(valid.Size() >= 12);
   for (const auto& v : valid.GetArray())
   {
      INFO(str(v["name"]));
      auto text       = str(v["wif"]);
      auto secret     = unhex(str(v["secret"]));
      bool compressed = v["compressed"].GetBool();
      auto network    = str(v["network"]) == "mainnet" ? WifNetwork::mainnet : WifNetwork::testnet;
      REQUIRE(secret.size() == 32);
      std::span<const unsigned char, 32> secretSpan{secret.data(), 32};

      CHECK(wifEncode(secretSpan, compressed, network) == text);
      CHECK(looksLikeWif(text));

      WifError error{};
      auto     key = wifDecode(text, &error);
      REQUIRE(key.has_value());
      CHECK(std::equal(secret.begin(), secret.end(), key->secret.begin()));
      CHECK(key->compressed == compressed);
      CHECK(key->network == network);

      // Key derivation agrees, and both forms of the public key are keys
      // that verify-k1 accepts: the string chooses which one a claim names.
      auto compressedKey   = publicKey(key->secret, true);
      auto uncompressedKey = publicKey(key->secret, false);
      CHECK(compressedKey == unhex(str(v["publicKeyCompressed"])));
      CHECK(uncompressedKey == unhex(str(v["publicKeyUncompressed"])));
      CHECK(verifierFor(std::span<const unsigned char>{spki(compressedKey)}) == verifier::k1);
      CHECK(verifierFor(std::span<const unsigned char>{spki(uncompressedKey)}) == verifier::k1);
   }
}

TEST_CASE("wif: defaults are compressed and mainnet")
{
   auto secret = unhex("0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d");
   CHECK(wifEncode(std::span<const unsigned char, 32>{secret.data(), 32}) ==
         "KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617");
}

TEST_CASE("wif: white space at the ends")
{
   auto doc = loadVectors();
   for (const auto& v : doc["whitespace"].GetArray())
   {
      INFO(str(v["name"]));
      auto key      = wifDecode(str(v["text"]));
      auto expected = wifDecode(str(v["wif"]));
      REQUIRE(key.has_value());
      REQUIRE(expected.has_value());
      CHECK(key->secret == expected->secret);
      CHECK(key->compressed == expected->compressed);
      CHECK(key->network == expected->network);
      CHECK(looksLikeWif(str(v["text"])));
   }
}

TEST_CASE("wif: invalid vectors")
{
   auto        doc     = loadVectors();
   const auto& invalid = doc["invalid"];
   REQUIRE(invalid.Size() >= 20);
   for (const auto& v : invalid.GetArray())
   {
      INFO(str(v["name"]));
      auto     text  = str(v["text"]);
      WifError error = WifError::badCharacter;
      CHECK(!wifDecode(text).has_value());
      REQUIRE(!wifDecode(text, &error).has_value());
      CHECK(wifErrorName(error) == str(v["error"]));
      CHECK(!wifErrorMessage(error).empty());
      CHECK(looksLikeWif(text) == v["looksLikeWif"].GetBool());
   }
}

// psinode -k takes a WIF string: the signer made from it claims the public
// key in the form the string asks for.
TEST_CASE("wif: the node's signer")
{
   auto doc = loadVectors();
   for (const auto& v : doc["valid"].GetArray())
   {
      INFO(str(v["name"]));
      auto key = wifDecode(str(v["wif"]));
      REQUIRE(key.has_value());
      OpenSSLProver prover{*key};
      auto          claim = prover.get();
      auto          expected =
          spki(unhex(str(v[key->compressed ? "publicKeyCompressed" : "publicKeyUncompressed"])));
      CHECK(claim.service == verifier::k1);
      CHECK(std::vector<unsigned char>(claim.rawData.begin(), claim.rawData.end()) == expected);

      std::string_view message   = "a block";
      auto             signature = prover.prove(message, claim);
      REQUIRE(signature.size() == 64);
      CHECK(verifier::isLowS(
          std::span<const unsigned char, 64>{
              reinterpret_cast<const unsigned char*>(signature.data()), 64},
          KeyType::secp256k1));
   }
}
