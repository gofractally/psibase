// Key and signature encodings accepted by the verify-sig service, on both curves.
#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/VerifySig.hpp>

#include <array>

using namespace psibase;
using SystemService::AuthSig::PrivateKeyInfo;

namespace
{
   using Bytes = std::vector<unsigned char>;

   // Group orders, big-endian.
   constexpr std::array<unsigned char, 32> k1Order = {
       0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
       0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41};
   constexpr std::array<unsigned char, 32> r1Order = {
       0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
       0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51};

   // Replaces s with order - s: the other valid signature for the same message.
   Bytes otherS(Bytes sig, const std::array<unsigned char, 32>& order)
   {
      int borrow = 0;
      for (int i = 31; i >= 0; --i)
      {
         int d       = order[i] - sig[32 + i] - borrow;
         borrow      = d < 0;
         sig[32 + i] = static_cast<unsigned char>(d + (borrow ? 256 : 0));
      }
      return sig;
   }

   // Rewrites an uncompressed-point SubjectPublicKeyInfo with a compressed point.
   Bytes compressed(const Bytes& spki)
   {
      REQUIRE(spki.size() > 68);
      const std::size_t header = spki.size() - 65;
      REQUIRE(spki[header] == 0x04);
      Bytes result(spki.begin(), spki.begin() + header);
      result.push_back(spki.back() & 1 ? 0x03 : 0x02);
      result.insert(result.end(), spki.begin() + header + 1, spki.begin() + header + 33);
      result[1] -= 32;           // outer SEQUENCE length
      result[header - 2] -= 32;  // BIT STRING length
      return result;
   }

   struct Fixture
   {
      DefaultTestChain t;
      AccountNumber    alice = t.addAccount(AccountNumber("alice"));

      // A transaction from an account that needs no signature, carrying one
      // verify-sig claim. Every proof is verified whether or not it is needed.
      Transaction transaction(const Bytes& key)
      {
         t.startBlock(0);
         auto trx = t.makeTransaction({{.sender = alice, .service = AccountNumber{"nop"}}});
         trx.claims.push_back({.service = SystemService::VerifySig::service,
                               .rawData = {key.begin(), key.end()}});
         return trx;
      }

      Bytes sign(const Transaction& trx, const PrivateKeyInfo& key)
      {
         auto packed = psio::convert_to_frac(trx);
         return SystemService::AuthSig::sign(key, sha256(packed.data(), packed.size()));
      }

      TraceResult push(const Transaction& trx, const Bytes& proof)
      {
         return TraceResult(t.pushTransaction(
             SignedTransaction{.transaction = trx, .proofs = {{proof.begin(), proof.end()}}}));
      }
   };
}  // namespace

TEST_CASE("verify-sig: both curves, valid and invalid signatures")
{
   Fixture f;
   for (std::string_view group : {"secp256r1", "secp256k1"})
   {
      INFO(group);
      auto priv  = PrivateKeyInfo::create(group);
      auto other = PrivateKeyInfo::create(group);
      auto key   = getSubjectPublicKeyInfo(priv).data;
      auto trx   = f.transaction(key);
      auto sig   = f.sign(trx, priv);
      REQUIRE(sig.size() == 64);

      CHECK(f.push(trx, sig).succeeded());
      CHECK(f.push(trx, f.sign(trx, other)).failed("signature invalid"));

      auto corrupted = sig;
      corrupted[40] ^= 1;
      CHECK(f.push(trx, corrupted).failed("signature invalid"));

      CHECK(f.push(trx, Bytes(64, 0)).failed("signature invalid"));
   }
}

TEST_CASE("verify-sig: either s value is accepted")
{
   Fixture f;
   for (auto [group, order] : {std::pair{std::string_view{"secp256r1"}, &r1Order},
                               std::pair{std::string_view{"secp256k1"}, &k1Order}})
   {
      INFO(group);
      auto priv = PrivateKeyInfo::create(group);
      auto key  = getSubjectPublicKeyInfo(priv).data;

      auto first = f.transaction(key);
      CHECK(f.push(first, f.sign(first, priv)).succeeded());

      // A transaction can only be applied once, so the other s value is
      // checked on a second transaction.
      auto second = f.transaction(key);
      CHECK(f.push(second, otherS(f.sign(second, priv), *order)).succeeded());
   }
}

TEST_CASE("verify-sig: signature length")
{
   Fixture f;
   auto    priv = PrivateKeyInfo::create("secp256r1");
   auto    trx  = f.transaction(getSubjectPublicKeyInfo(priv).data);
   auto    sig  = f.sign(trx, priv);

   auto shorter = sig;
   shorter.pop_back();
   CHECK(f.push(trx, shorter).failed("signature invalid"));

   auto longer = sig;
   longer.push_back(0);
   CHECK(f.push(trx, longer).failed("signature invalid"));
}

TEST_CASE("verify-sig: public key encodings")
{
   Fixture f;

   SECTION("compressed points")
   {
      // Several keys, so that both parities of y are exercised.
      for (std::string_view group : {"secp256r1", "secp256k1"})
      {
         INFO(group);
         bool seen[2] = {};
         for (int i = 0; i < 8 || !seen[0] || !seen[1]; ++i)
         {
            auto priv = PrivateKeyInfo::create(group);
            auto key  = compressed(getSubjectPublicKeyInfo(priv).data);
            seen[key[key.size() - 33] & 1] = true;
            auto trx = f.transaction(key);
            CHECK(f.push(trx, f.sign(trx, priv)).succeeded());
         }
      }
   }
   SECTION("compressed point with the wrong parity")
   {
      for (std::string_view group : {"secp256r1", "secp256k1"})
      {
         INFO(group);
         auto priv = PrivateKeyInfo::create(group);
         auto key  = compressed(getSubjectPublicKeyInfo(priv).data);
         key[key.size() - 33] ^= 1;
         auto trx = f.transaction(key);
         CHECK(f.push(trx, f.sign(trx, priv)).failed("signature invalid"));
      }
   }
   SECTION("trailing data")
   {
      auto priv = PrivateKeyInfo::create("secp256r1");
      auto key  = getSubjectPublicKeyInfo(priv).data;
      key.push_back(0);
      auto trx = f.transaction(key);
      CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
   }
   SECTION("unknown curve")
   {
      auto priv = PrivateKeyInfo::create("secp256r1");
      auto key  = getSubjectPublicKeyInfo(priv).data;
      key[22] ^= 1;  // last byte of the curve identifier
      auto trx = f.transaction(key);
      CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
   }
   SECTION("point not on the curve")
   {
      for (std::string_view group : {"secp256r1", "secp256k1"})
      {
         INFO(group);
         auto priv = PrivateKeyInfo::create(group);
         auto key  = getSubjectPublicKeyInfo(priv).data;
         key.back() ^= 1;
         auto trx = f.transaction(key);
         CHECK(f.push(trx, f.sign(trx, priv)).failed(""));
      }
   }
   SECTION("empty key")
   {
      auto priv = PrivateKeyInfo::create("secp256r1");
      auto trx  = f.transaction({});
      CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
   }
}
