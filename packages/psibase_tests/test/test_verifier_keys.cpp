// Key and signature encodings accepted by the verifier services (verify-k1
// for secp256k1 and verify-r1 for secp256r1), which key goes to which
// verifier (psibase/verifier.hpp), and how auth-sig uses that.
#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/verifier.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/VerifyK1.hpp>
#include <services/system/VerifyR1.hpp>

#include <array>

using namespace psibase;
using SystemService::AuthSig::PrivateKeyInfo;
using SystemService::AuthSig::SubjectPublicKeyInfo;

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

   // The verifier that keys of this group go to. Encodings that no verifier
   // accepts are presented to the verifier of the curve they were made from.
   AccountNumber verifierOf(std::string_view group)
   {
      return requireVerifierFor(getSubjectPublicKeyInfo(PrivateKeyInfo::create(group)).data);
   }

   // The verifier that is not `service`
   AccountNumber otherVerifier(AccountNumber service)
   {
      return service == SystemService::VerifyK1::service ? SystemService::VerifyR1::service
                                                         : SystemService::VerifyK1::service;
   }

   // The file holding the code of a verifier
   const char* wasmOf(AccountNumber service)
   {
      return service == SystemService::VerifyK1::service ? "VerifyK1.wasm" : "VerifyR1.wasm";
   }

   struct Fixture
   {
      DefaultTestChain t;
      AccountNumber    alice = t.addAccount(AccountNumber("alice"));

      // A transaction from `sender` carrying one claim for `key` that names
      // `service`. Every proof is verified whether or not it is needed.
      Transaction transaction(const Bytes& key, AccountNumber service, AccountNumber sender)
      {
         t.startBlock(0);
         auto trx = t.makeTransaction({{.sender = sender, .service = AccountNumber{"nop"}}});
         trx.claims.push_back({.service = service, .rawData = {key.begin(), key.end()}});
         return trx;
      }
      // From an account that needs no signature
      Transaction transaction(const Bytes& key, AccountNumber service)
      {
         return transaction(key, service, alice);
      }
      // Names the verifier for the key, as every signer does.
      Transaction transaction(const Bytes& key)
      {
         return transaction(key, requireVerifierFor(key));
      }

      Bytes sign(const Transaction& trx, const PrivateKeyInfo& key)
      {
         auto packed = psio::to_pssz(trx);
         return SystemService::AuthSig::sign(key, sha256(packed.data(), packed.size()));
      }

      TraceResult push(const Transaction& trx, const Bytes& proof)
      {
         return TraceResult(t.pushTransaction(
             SignedTransaction{.transaction = psio::shared_pssz<Transaction>{trx},
                               .proofs      = {{proof.begin(), proof.end()}}}));
      }
   };
}  // namespace

TEST_CASE("verifiers: both curves, valid and invalid signatures")
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

TEST_CASE("verifiers: only the low-S form is accepted")
{
   Fixture f;
   for (auto [group, order] : {std::pair{std::string_view{"secp256r1"}, &r1Order},
                               std::pair{std::string_view{"secp256k1"}, &k1Order}})
   {
      INFO(group);
      // Several keys and messages; sign() already returns the low-S form.
      for (int i = 0; i < 8; ++i)
      {
         auto priv = PrivateKeyInfo::create(group);
         auto trx  = f.transaction(getSubjectPublicKeyInfo(priv).data);
         auto sig  = f.sign(trx, priv);
         // (r, n - s) satisfies the ECDSA equation too, but is not canonical.
         CHECK(f.push(trx, otherS(sig, *order)).failed("signature invalid"));
         CHECK(f.push(trx, sig).succeeded());
      }
   }
}

TEST_CASE("verifiers: signature length")
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

TEST_CASE("verifiers: public key encodings")
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
   SECTION("hybrid point")
   {
      // 06/07 || X || Y is a third encoding of the same point
      for (std::string_view group : {"secp256r1", "secp256k1"})
      {
         INFO(group);
         auto priv = PrivateKeyInfo::create(group);
         auto key  = getSubjectPublicKeyInfo(priv).data;
         key[key.size() - 65] = 0x06 | (key.back() & 1);
         auto trx             = f.transaction(key, verifierOf(group));
         CHECK(f.push(trx, f.sign(trx, priv)).failed("invalid public key"));
      }
   }
   SECTION("unused bits in the bit string")
   {
      auto priv = PrivateKeyInfo::create("secp256k1");
      auto key  = getSubjectPublicKeyInfo(priv).data;
      key[key.size() - 66] = 1;
      CHECK(!verifierFor(key));
      auto trx = f.transaction(key, verifierOf("secp256k1"));
      CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
   }
   SECTION("trailing data")
   {
      auto priv = PrivateKeyInfo::create("secp256r1");
      auto key  = getSubjectPublicKeyInfo(priv).data;
      key.push_back(0);
      CHECK(!verifierFor(key));
      auto trx = f.transaction(key, verifierOf("secp256r1"));
      CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
   }
   SECTION("unknown curve")
   {
      auto priv = PrivateKeyInfo::create("secp256r1");
      auto key  = getSubjectPublicKeyInfo(priv).data;
      key[22] ^= 1;  // last byte of the curve identifier
      CHECK(!verifierFor(key));
      auto trx = f.transaction(key, verifierOf("secp256r1"));
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
      for (std::string_view group : {"secp256r1", "secp256k1"})
      {
         INFO(group);
         auto priv = PrivateKeyInfo::create(group);
         auto trx  = f.transaction({}, verifierOf(group));
         CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
      }
   }
}

TEST_CASE("verifiers: each rejects keys of the other type")
{
   Fixture f;
   for (std::string_view group : {"secp256r1", "secp256k1"})
   {
      INFO(group);
      auto priv  = PrivateKeyInfo::create(group);
      auto key   = getSubjectPublicKeyInfo(priv).data;
      auto right = requireVerifierFor(key);
      auto wrong = otherVerifier(right);
      for (const Bytes& encoded : {key, compressed(key)})
      {
         INFO("key size " << encoded.size());
         // A correct signature for this very transaction makes no difference.
         auto misdirected = f.transaction(encoded, wrong);
         CHECK(f.push(misdirected, f.sign(misdirected, priv)).failed("unsupported public key"));
         auto directed = f.transaction(encoded, right);
         CHECK(f.push(directed, f.sign(directed, priv)).succeeded());
      }
   }
}

TEST_CASE("verifierFor: the verifier for a key")
{
   // The names are valid account names.
   CHECK(SystemService::VerifyK1::service.str() == "verify-k1");
   CHECK(SystemService::VerifyR1::service.str() == "verify-r1");
   CHECK(AccountNumber{"verify-k1"} == SystemService::VerifyK1::service);
   CHECK(AccountNumber{"verify-r1"} == SystemService::VerifyR1::service);
   CHECK(AccountNumber{SystemService::VerifyK1::service.str()}.value ==
         SystemService::VerifyK1::service.value);
   CHECK(AccountNumber{SystemService::VerifyR1::service.str()}.value ==
         SystemService::VerifyR1::service.value);
   CHECK(SystemService::VerifyK1::service != SystemService::VerifyR1::service);
   CHECK(SystemService::VerifyK1::service.value != 0);
   CHECK(SystemService::VerifyR1::service.value != 0);

   CHECK(verifierFor(KeyType::secp256k1) == SystemService::VerifyK1::service);
   CHECK(verifierFor(KeyType::secp256r1) == SystemService::VerifyR1::service);
   CHECK(verifiedKeyType(SystemService::VerifyK1::service) == KeyType::secp256k1);
   CHECK(verifiedKeyType(SystemService::VerifyR1::service) == KeyType::secp256r1);
   CHECK(!verifiedKeyType(SystemService::AuthSig::AuthSig::service));
   CHECK(!verifiedKeyType(AccountNumber{}));

   SECTION("both curves, both point encodings")
   {
      for (auto [group, type, service] :
           {std::tuple{std::string_view{"secp256k1"}, KeyType::secp256k1,
                       SystemService::VerifyK1::service},
            std::tuple{std::string_view{"secp256r1"}, KeyType::secp256r1,
                       SystemService::VerifyR1::service}})
      {
         INFO(group);
         auto key = getSubjectPublicKeyInfo(PrivateKeyInfo::create(group)).data;
         REQUIRE(key.size() > 65);
         CHECK(verifierFor(key) == service);
         CHECK(keyType(key) == type);
         CHECK(verifier::ecPoint(key, type).size() == 65);
         auto small = compressed(key);
         CHECK(verifierFor(small) == service);
         CHECK(keyType(small) == type);
         CHECK(verifier::ecPoint(small, type).size() == 33);
         // The same bytes as chars, as a claim holds them
         std::vector<char> chars(key.begin(), key.end());
         CHECK(verifierFor(std::span<const char>{chars}) == service);
         CHECK(requireVerifierFor(chars) == service);
      }
   }
   SECTION("anything else has no verifier")
   {
      auto good = getSubjectPublicKeyInfo(PrivateKeyInfo::create("secp256r1")).data;
      REQUIRE(verifierFor(good));

      CHECK(!verifierFor(Bytes{}));
      CHECK(!verifierFor(Bytes{0x30}));
      CHECK(!verifierFor(Bytes(91, 0)));
      CHECK(!verifierFor(Bytes(good.size(), 0xff)));
      std::string_view text = "-----BEGIN PUBLIC KEY-----";
      CHECK(!verifierFor(Bytes(text.begin(), text.end())));

      auto trailing = good;
      trailing.push_back(0);
      CHECK(!verifierFor(trailing));

      auto truncated = good;
      truncated.pop_back();
      CHECK(!verifierFor(truncated));

      auto otherCurve = good;
      otherCurve[22] ^= 1;  // last byte of the curve identifier
      CHECK(!verifierFor(otherCurve));

      auto unusedBits = good;
      unusedBits[unusedBits.size() - 66] = 1;
      CHECK(!verifierFor(unusedBits));

      auto wrongLength = good;
      ++wrongLength[1];
      CHECK(!verifierFor(wrongLength));

      // secp384r1: a real key of a type that has no verifier
      Bytes p384 = {0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce,
                    0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22,
                    0x03, 0x62, 0x00, 0x04};
      p384.resize(120, 0x11);
      CHECK(!verifierFor(p384));
   }
}

TEST_CASE("auth-sig: a claim must name the verifier for the account's key")
{
   using SystemService::AuthSig::AuthSig;
   Fixture f;
   auto&   t = f.t;
   for (std::string_view group : {"secp256r1", "secp256k1"})
   {
      INFO(group);
      auto priv  = PrivateKeyInfo::create(group);
      auto pub   = getSubjectPublicKeyInfo(priv);
      auto right = requireVerifierFor(pub.data);
      auto name  = AccountNumber{group == "secp256r1" ? "bobr" : "bobk"};
      auto bob   = t.addAccount(name, pub);

      // A second service running the same verifier code: it accepts the same
      // signatures, but it is not the verifier for this key.
      auto copy = AccountNumber{group == "secp256r1" ? "copyr" : "copyk"};
      t.addService(copy, wasmOf(right), CodeRow::isVerify);

      auto claim = [&](AccountNumber service)
      { return Claim{.service = service, .rawData = {pub.data.begin(), pub.data.end()}}; };
      auto accepts = [&](std::vector<Claim> claims)
      {
         return t.from(f.alice)
             .to<AuthSig>()
             .checkAuthSys(0, bob, ServiceMethod{}, std::move(claims))
             .returnVal();
      };

      // auth-sig itself, asked directly
      CHECK(accepts({claim(right)}));
      CHECK(!accepts({claim(copy)}));
      CHECK(!accepts({claim(otherVerifier(right))}));
      CHECK(!accepts({claim(AuthSig::service)}));
      CHECK(!accepts({}));
      CHECK(accepts({claim(copy), claim(right)}));

      // In a transaction. The copy verifies the signature, so it is auth-sig
      // that refuses.
      {
         auto trx = f.transaction(pub.data, copy, bob);
         CHECK(f.push(trx, f.sign(trx, priv)).failed("Authorization for"));
      }
      // The other curve's verifier does not even take the key.
      {
         auto trx = f.transaction(pub.data, otherVerifier(right), bob);
         CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
      }
      // The right one, signed by somebody else
      {
         auto trx = f.transaction(pub.data, right, bob);
         CHECK(f.push(trx, f.sign(trx, PrivateKeyInfo::create(group))).failed("signature invalid"));
      }
      {
         auto trx = f.transaction(pub.data, right, bob);
         CHECK(f.push(trx, f.sign(trx, priv)).succeeded());
      }
   }
}

TEST_CASE("auth-sig: only keys that have a verifier are stored")
{
   using SystemService::AuthSig::AuthSig;
   Fixture f;
   auto&   t       = f.t;
   auto    authSig = t.from(f.alice).to<AuthSig>();

   SECTION("every encoding the verifiers accept")
   {
      for (std::string_view group : {"secp256r1", "secp256k1"})
      {
         INFO(group);
         auto priv = PrivateKeyInfo::create(group);
         auto key  = getSubjectPublicKeyInfo(priv).data;
         for (const Bytes& encoded : {key, compressed(key)})
         {
            INFO("key size " << encoded.size());
            REQUIRE(authSig.setKey(SubjectPublicKeyInfo{encoded}).succeeded());
            REQUIRE(t.from(f.alice)
                        .to<SystemService::Accounts>()
                        .setAuthServ(AuthSig::service)
                        .succeeded());
            // The account is usable with that key
            auto trx = f.transaction(encoded);
            CHECK(f.push(trx, f.sign(trx, priv)).succeeded());
            // and with no other.
            auto otherPriv = PrivateKeyInfo::create(group);
            auto bad       = f.transaction(getSubjectPublicKeyInfo(otherPriv).data);
            CHECK(f.push(bad, f.sign(bad, otherPriv)).failed("Authorization for"));
            // Back to no signature for the next round.
            auto restore = t.makeTransaction(
                {transactor<SystemService::Accounts>{f.alice, SystemService::Accounts::service}
                     .setAuthServ(AccountNumber{"auth-any"})});
            restore.claims.push_back(
                {.service = requireVerifierFor(encoded), .rawData = {encoded.begin(), encoded.end()}});
            REQUIRE(f.push(restore, f.sign(restore, priv)).succeeded());
         }
      }
   }
   SECTION("keys that nothing can verify")
   {
      auto good = getSubjectPublicKeyInfo(PrivateKeyInfo::create("secp256r1")).data;

      // secp384r1: well formed, but no verifier
      Bytes p384 = {0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce,
                    0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22,
                    0x03, 0x62, 0x00, 0x04};
      p384.resize(120, 0x11);

      auto otherCurve = good;
      otherCurve[22] ^= 1;
      auto trailing = good;
      trailing.push_back(0);
      auto unusedBits                    = good;
      unusedBits[unusedBits.size() - 66] = 1;

      int n = 0;
      for (const Bytes& key : {p384, otherCurve, trailing, unusedBits, Bytes{}, Bytes{0x30, 0x00}})
      {
         INFO("key " << n++ << ", size " << key.size());
         CHECK(authSig.setKey(SubjectPublicKeyInfo{key}).failed("unsupported public key"));
         t.startBlock(0);
         CHECK(authSig.newAccount(AccountNumber{"carolcarol"}, SubjectPublicKeyInfo{key})
                   .failed("unsupported public key"));
         t.startBlock(0);
      }
      CHECK(authSig.newAccount(AccountNumber{"carolcarol"}, SubjectPublicKeyInfo{good}).succeeded());
   }
}
