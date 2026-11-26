// Key and signature encodings accepted by the verifier services, which keys
// may use which verifier (psibase/verifier.hpp), and how auth-sig uses that.
//
// Every case about encodings runs against each verifier with the same
// expectations: verify-k1 for secp256k1, and both verify-r1 (Botan) and the
// second P-256 verifier (BearSSL) for secp256r1.
#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/verifier.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/VerifyBr1.hpp>
#include <services/system/VerifyK1.hpp>
#include <services/system/VerifyR1.hpp>

#include <array>

using namespace psibase;
using SystemService::VerifyBr1;
using SystemService::VerifyK1;
using SystemService::VerifyR1;
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

   // A verifier and the kind of key it takes
   struct Target
   {
      std::string_view                     group;
      KeyType                              type;
      AccountNumber                        service;
      const std::array<unsigned char, 32>* order;

      std::string name() const { return std::string{group} + " by " + service.str(); }
   };

   // Every verifier, taken from the list of allowed verifiers. A verifier
   // added there is tested here.
   std::vector<Target> targets()
   {
      std::vector<Target> result;
      for (auto service : allowedVerifiers(KeyType::secp256r1))
         result.push_back({"secp256r1", KeyType::secp256r1, service, &r1Order});
      for (auto service : allowedVerifiers(KeyType::secp256k1))
         result.push_back({"secp256k1", KeyType::secp256k1, service, &k1Order});
      return result;
   }

   // A verifier for the other curve
   AccountNumber otherCurveVerifier(KeyType type)
   {
      return verifierFor(type == KeyType::secp256k1 ? KeyType::secp256r1 : KeyType::secp256k1);
   }

   // The file holding the code of a verifier
   const char* wasmOf(AccountNumber service)
   {
      if (service == VerifyK1::service)
         return "VerifyK1.wasm";
      else if (service == VerifyR1::service)
         return "VerifyR1.wasm";
      else
         return "VerifyBr1.wasm";
   }

   // The part of auth-sig's account that these tests ask for
   struct StoredKeys
   {
      SystemService::AuthSig::AuthKey owner;
      SystemService::AuthSig::AuthKey active;
      PSIO_REFLECT(StoredKeys, owner, active)
   };
   struct StoredKey
   {
      std::optional<StoredKeys> account;
      PSIO_REFLECT(StoredKey, account)
   };
   struct StoredKeyReply
   {
      StoredKey data;
      PSIO_REFLECT(StoredKeyReply, data)
   };

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

TEST_CASE("verifiers: valid and invalid signatures")
{
   Fixture f;
   for (auto target : targets())
   {
      INFO(target.name());
      auto priv  = PrivateKeyInfo::create(target.group);
      auto other = PrivateKeyInfo::create(target.group);
      auto key   = getSubjectPublicKeyInfo(priv).data;
      auto trx   = f.transaction(key, target.service);
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
   for (auto target : targets())
   {
      INFO(target.name());
      // Several keys and messages; sign() already returns the low-S form.
      for (int i = 0; i < 8; ++i)
      {
         auto priv = PrivateKeyInfo::create(target.group);
         auto trx  = f.transaction(getSubjectPublicKeyInfo(priv).data, target.service);
         auto sig  = f.sign(trx, priv);
         // (r, n - s) satisfies the ECDSA equation too, but is not canonical.
         CHECK(f.push(trx, otherS(sig, *target.order)).failed("signature invalid"));
         CHECK(f.push(trx, sig).succeeded());
      }
   }
}

TEST_CASE("verifiers: signature length")
{
   Fixture f;
   for (auto target : targets())
   {
      INFO(target.name());
      auto priv = PrivateKeyInfo::create(target.group);
      auto trx  = f.transaction(getSubjectPublicKeyInfo(priv).data, target.service);
      auto sig  = f.sign(trx, priv);

      auto shorter = sig;
      shorter.pop_back();
      CHECK(f.push(trx, shorter).failed("signature invalid"));

      auto longer = sig;
      longer.push_back(0);
      CHECK(f.push(trx, longer).failed("signature invalid"));

      CHECK(f.push(trx, Bytes{}).failed("signature invalid"));
   }
}

TEST_CASE("verifiers: public key encodings")
{
   Fixture f;
   for (auto target : targets())
   {
      DYNAMIC_SECTION(target.name())
      {
         SECTION("compressed points")
         {
            // Several keys, so that both parities of y are exercised.
            bool seen[2] = {};
            for (int i = 0; i < 8 || !seen[0] || !seen[1]; ++i)
            {
               auto priv = PrivateKeyInfo::create(target.group);
               auto key  = compressed(getSubjectPublicKeyInfo(priv).data);
               seen[key[key.size() - 33] & 1] = true;
               auto trx = f.transaction(key, target.service);
               CHECK(f.push(trx, f.sign(trx, priv)).succeeded());
            }
         }
         SECTION("compressed point with the wrong parity")
         {
            auto priv = PrivateKeyInfo::create(target.group);
            auto key  = compressed(getSubjectPublicKeyInfo(priv).data);
            key[key.size() - 33] ^= 1;
            auto trx = f.transaction(key, target.service);
            CHECK(f.push(trx, f.sign(trx, priv)).failed("signature invalid"));
         }
         SECTION("hybrid point")
         {
            // 06/07 || X || Y is a third encoding of the same point
            auto priv = PrivateKeyInfo::create(target.group);
            auto key  = getSubjectPublicKeyInfo(priv).data;
            key[key.size() - 65] = 0x06 | (key.back() & 1);
            auto trx             = f.transaction(key, target.service);
            CHECK(f.push(trx, f.sign(trx, priv)).failed("invalid public key"));
         }
         SECTION("point prefix that is no encoding at all")
         {
            auto priv = PrivateKeyInfo::create(target.group);
            auto key  = getSubjectPublicKeyInfo(priv).data;
            for (unsigned char prefix : {0x00, 0x01, 0x02, 0x03, 0x05, 0x08, 0xff})
            {
               INFO("prefix " << int(prefix));
               auto bad                 = key;
               bad[bad.size() - 65]     = prefix;
               auto trx                 = f.transaction(bad, target.service);
               CHECK(f.push(trx, f.sign(trx, priv)).failed("invalid public key"));
            }
            auto small = compressed(key);
            for (unsigned char prefix : {0x00, 0x01, 0x04, 0x06, 0x07, 0xff})
            {
               INFO("compressed, prefix " << int(prefix));
               auto bad               = small;
               bad[bad.size() - 33]   = prefix;
               auto trx               = f.transaction(bad, target.service);
               CHECK(f.push(trx, f.sign(trx, priv)).failed("invalid public key"));
            }
         }
         SECTION("unused bits in the bit string")
         {
            auto priv = PrivateKeyInfo::create(target.group);
            auto key  = getSubjectPublicKeyInfo(priv).data;
            key[key.size() - 66] = 1;
            CHECK(!verifierFor(key));
            auto trx = f.transaction(key, target.service);
            CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
         }
         SECTION("trailing data")
         {
            auto priv = PrivateKeyInfo::create(target.group);
            auto key  = getSubjectPublicKeyInfo(priv).data;
            key.push_back(0);
            CHECK(!verifierFor(key));
            auto trx = f.transaction(key, target.service);
            CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
         }
         SECTION("unknown curve")
         {
            auto priv = PrivateKeyInfo::create(target.group);
            auto key  = getSubjectPublicKeyInfo(priv).data;
            // last byte of the curve identifier
            key[2 + verifier::algorithm(target.type).size() - 1] ^= 1;
            CHECK(!verifierFor(key));
            auto trx = f.transaction(key, target.service);
            CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
         }
         SECTION("point not on the curve")
         {
            auto priv = PrivateKeyInfo::create(target.group);
            auto key  = getSubjectPublicKeyInfo(priv).data;
            key.back() ^= 1;
            auto trx = f.transaction(key, target.service);
            // Rejected by the verifier itself, with one of its own messages.
            auto result = f.push(trx, f.sign(trx, priv));
            CHECK((result.failed("invalid public key") || result.failed("signature invalid")));
         }
         SECTION("coordinate not below the field prime")
         {
            auto priv = PrivateKeyInfo::create(target.group);
            auto key  = getSubjectPublicKeyInfo(priv).data;
            std::fill(key.end() - 64, key.end() - 32, 0xff);  // x
            auto trx    = f.transaction(key, target.service);
            auto result = f.push(trx, f.sign(trx, priv));
            CHECK((result.failed("invalid public key") || result.failed("signature invalid")));

            auto small = compressed(getSubjectPublicKeyInfo(priv).data);
            std::fill(small.end() - 32, small.end(), 0xff);
            auto trx2    = f.transaction(small, target.service);
            auto result2 = f.push(trx2, f.sign(trx2, priv));
            CHECK((result2.failed("invalid public key") || result2.failed("signature invalid")));
         }
         SECTION("empty key")
         {
            auto priv = PrivateKeyInfo::create(target.group);
            auto trx  = f.transaction({}, target.service);
            CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
         }
         SECTION("a key of the other type")
         {
            auto priv  = PrivateKeyInfo::create(target.group);
            auto key   = getSubjectPublicKeyInfo(priv).data;
            auto wrong = otherCurveVerifier(target.type);
            for (const Bytes& encoded : {key, compressed(key)})
            {
               INFO("key size " << encoded.size());
               // A correct signature for this very transaction makes no difference.
               auto misdirected = f.transaction(encoded, wrong);
               CHECK(f.push(misdirected, f.sign(misdirected, priv))
                         .failed("unsupported public key"));
               auto directed = f.transaction(encoded, target.service);
               CHECK(f.push(directed, f.sign(directed, priv)).succeeded());
            }
         }
      }
   }
}

TEST_CASE("verifierFor: the verifiers for a key")
{
   // The names are valid account names.
   for (auto [service, name] : {std::pair{VerifyK1::service, std::string_view{"verify-k1"}},
                                std::pair{VerifyR1::service, std::string_view{"verify-r1"}}})
   {
      CHECK(service.str() == name);
      CHECK(AccountNumber{name} == service);
   }
   for (auto service : {VerifyK1::service, VerifyR1::service, VerifyBr1::service})
   {
      CHECK(service.value != 0);
      CHECK(AccountNumber{service.str()}.value == service.value);
      CHECK(!service.str().empty());
   }
   CHECK(VerifyK1::service != VerifyR1::service);
   CHECK(VerifyK1::service != VerifyBr1::service);
   CHECK(VerifyR1::service != VerifyBr1::service);

   // The default for each type, and what is allowed
   CHECK(verifierFor(KeyType::secp256k1) == VerifyK1::service);
   CHECK(verifierFor(KeyType::secp256r1) == VerifyR1::service);
   CHECK(std::ranges::equal(allowedVerifiers(KeyType::secp256k1), std::array{VerifyK1::service}));
   CHECK(std::ranges::equal(allowedVerifiers(KeyType::secp256r1),
                            std::array{VerifyR1::service, VerifyBr1::service}));
   CHECK(verifiedKeyType(VerifyK1::service) == KeyType::secp256k1);
   CHECK(verifiedKeyType(VerifyR1::service) == KeyType::secp256r1);
   CHECK(verifiedKeyType(VerifyBr1::service) == KeyType::secp256r1);
   CHECK(!verifiedKeyType(SystemService::AuthSig::AuthSig::service));
   CHECK(!verifiedKeyType(AccountNumber{}));

   SECTION("both curves, both point encodings")
   {
      for (auto [group, type, service] :
           {std::tuple{std::string_view{"secp256k1"}, KeyType::secp256k1, VerifyK1::service},
            std::tuple{std::string_view{"secp256r1"}, KeyType::secp256r1, VerifyR1::service}})
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

         for (const Bytes& encoded : {key, small})
         {
            for (auto candidate : {VerifyK1::service, VerifyR1::service, VerifyBr1::service})
            {
               bool allowed = std::ranges::contains(allowedVerifiers(type), candidate);
               CHECK(isAllowedVerifier(candidate, encoded) == allowed);
            }
            CHECK(!isAllowedVerifier(SystemService::AuthSig::AuthSig::service, encoded));
            CHECK(!isAllowedVerifier(AccountNumber{}, encoded));
         }
         CHECK(isAllowedVerifier(service, std::span<const char>{chars}));
      }
   }
   SECTION("anything else has no verifier")
   {
      auto good = getSubjectPublicKeyInfo(PrivateKeyInfo::create("secp256r1")).data;
      REQUIRE(verifierFor(good));

      // secp384r1: a key of a type that has no verifier
      Bytes p384 = {0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
                    0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x62, 0x00, 0x04};
      p384.resize(120, 0x11);

      auto trailing = good;
      trailing.push_back(0);
      auto truncated = good;
      truncated.pop_back();
      auto otherCurve = good;
      otherCurve[22] ^= 1;  // last byte of the curve identifier
      auto unusedBits                    = good;
      unusedBits[unusedBits.size() - 66] = 1;
      auto wrongLength = good;
      ++wrongLength[1];
      std::string_view text = "-----BEGIN PUBLIC KEY-----";

      for (const Bytes& key :
           {Bytes{}, Bytes{0x30}, Bytes(91, 0), Bytes(good.size(), 0xff),
            Bytes(text.begin(), text.end()), trailing, truncated, otherCurve, unusedBits,
            wrongLength, p384})
      {
         INFO("key size " << key.size());
         CHECK(!verifierFor(key));
         CHECK(!keyType(key));
         for (auto candidate : {VerifyK1::service, VerifyR1::service, VerifyBr1::service})
            CHECK(!isAllowedVerifier(candidate, key));
      }
   }
   SECTION("the low-S rule")
   {
      for (auto [type, order] :
           {std::pair{KeyType::secp256k1, &k1Order}, std::pair{KeyType::secp256r1, &r1Order}})
      {
         // half = (n - 1) / 2, the largest low s
         std::array<unsigned char, 32> half  = *order;
         int                           carry = 0;
         for (auto& byte : half)
         {
            int next = byte & 1;
            byte     = static_cast<unsigned char>((byte >> 1) | (carry << 7));
            carry    = next;
         }
         std::array<unsigned char, 64> sig = {};
         std::copy(half.begin(), half.end(), sig.begin() + 32);
         CHECK(verifier::isLowS(sig, type));
         // n - half = half + 1 is its twin, the smallest high s
         auto twin = otherS(Bytes(sig.begin(), sig.end()), *order);
         CHECK(!verifier::isLowS(std::span<const unsigned char, 64>{twin.data(), 64}, type));
         sig[63] ^= 0xff;  // some smaller s
         sig[32] = 0;
         CHECK(verifier::isLowS(sig, type));
         std::fill(sig.begin() + 32, sig.end(), 0xff);
         CHECK(!verifier::isLowS(sig, type));
         std::fill(sig.begin() + 32, sig.end(), 0);
         CHECK(verifier::isLowS(sig, type));
      }
   }
}

TEST_CASE("auth-sig: a claim must name the verifier stored with the account's key")
{
   using SystemService::AuthSig::AuthSig;
   Fixture f;
   auto&   t = f.t;
   int     n = 0;
   for (auto target : targets())
   {
      // Only the default verifier is what newAccount stores.
      if (target.service != verifierFor(target.type))
         continue;
      INFO(target.name());
      auto priv  = PrivateKeyInfo::create(target.group);
      auto pub   = getSubjectPublicKeyInfo(priv);
      auto right = target.service;
      auto bob   = t.addAccount(AccountNumber{n == 0 ? "bobbob1" : "bobbob2"}, pub);

      // A second service running the same verifier code: it accepts the same
      // signatures, but it is not the verifier stored for this account.
      auto copy = AccountNumber{n == 0 ? "copy1" : "copy2"};
      t.addService(copy, wasmOf(right), CodeRow::isVerify);
      ++n;

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
      CHECK(!accepts({claim(otherCurveVerifier(target.type))}));
      CHECK(!accepts({claim(AuthSig::service)}));
      CHECK(!accepts({}));
      CHECK(accepts({claim(copy), claim(right)}));
      // Another verifier allowed for the key is not the stored one either.
      for (auto allowed : allowedVerifiers(target.type))
         CHECK(accepts({claim(allowed)}) == (allowed == right));

      // In a transaction. The copy verifies the signature, so it is auth-sig
      // that refuses.
      {
         auto trx = f.transaction(pub.data, copy, bob);
         CHECK(f.push(trx, f.sign(trx, priv)).failed("Authorization for"));
      }
      // The other curve's verifier does not even take the key.
      {
         auto trx = f.transaction(pub.data, otherCurveVerifier(target.type), bob);
         CHECK(f.push(trx, f.sign(trx, priv)).failed("unsupported public key"));
      }
      // The right one, signed by somebody else
      {
         auto trx = f.transaction(pub.data, right, bob);
         CHECK(f.push(trx, f.sign(trx, PrivateKeyInfo::create(target.group)))
                   .failed("signature invalid"));
      }
      {
         auto trx = f.transaction(pub.data, right, bob);
         CHECK(f.push(trx, f.sign(trx, priv)).succeeded());
      }
   }
}

TEST_CASE("auth-sig: the verifier is stored with each key")
{
   using SystemService::AuthSig::AuthSig;
   using SystemService::AuthSig::KeySpec;
   Fixture f;
   auto&   t = f.t;

   // Distinct owner and active keys, so that a claim counts for one of them only.
   auto ownerPriv  = PrivateKeyInfo::create("secp256r1");
   auto owner      = getSubjectPublicKeyInfo(ownerPriv);
   auto activePriv = PrivateKeyInfo::create("secp256r1");
   auto active     = getSubjectPublicKeyInfo(activePriv);
   auto bob        = AccountNumber{"bobbobbob"};
   REQUIRE(t.from(f.alice)
               .to<AuthSig>()
               .newAccount(bob, KeySpec::of(owner), KeySpec::of(active))
               .succeeded());

   // What auth-sig's query service reports: this is where a signer learns
   // which verifier to name for an account.
   auto stored = [&]
   {
      auto query = std::format(
          R"(query {{ account(name: "{}") {{ owner {{ verifier key seq }} active {{ verifier key seq }} }} }})",
          bob.str());
      auto res  = t.post(AuthSig::service, "/graphql", GraphQLBody{query});
      auto body = std::string(res.body.begin(), res.body.end());
      UNSCOPED_INFO(body);
      return psio::from_ijson<StoredKeyReply>(body).data.account.value();
   };
   // An action of bob's, signed with `priv`, in a claim for `key` naming `service`
   auto signedBy = [&](const PrivateKeyInfo& priv, const SubjectPublicKeyInfo& key,
                       AccountNumber service, Action action)
   {
      t.startBlock(0);
      auto trx = t.makeTransaction({std::move(action)});
      trx.claims.push_back({.service = service, .rawData = {key.data.begin(), key.data.end()}});
      return f.push(trx, f.sign(trx, priv));
   };
   auto byActive = [&](AccountNumber service, Action action)
   { return signedBy(activePriv, active, service, std::move(action)); };
   auto byOwner = [&](AccountNumber service, Action action)
   { return signedBy(ownerPriv, owner, service, std::move(action)); };
   auto nop = [&] { return Action{.sender = bob, .service = AccountNumber{"nop"}}; };
   transactor<AuthSig> authSig{bob, AuthSig::service};

   // The default verifier is stored with each key of a new account.
   CHECK(stored().owner.verifier == VerifyR1::service);
   CHECK(stored().active.verifier == VerifyR1::service);
   CHECK(stored().active.key == active);
   CHECK(byActive(VerifyR1::service, nop()).succeeded());
   // The other allowed verifier checks the signature and finds it good, but
   // it is not the one stored with the key.
   CHECK(byActive(VerifyBr1::service, nop()).failed("Authorization for"));

   SECTION("choosing the second verifier for the active key")
   {
      REQUIRE(byOwner(VerifyR1::service, authSig.setActive(KeySpec{active, 5, VerifyBr1::service}))
                  .succeeded());
      CHECK(stored().active.verifier == VerifyBr1::service);
      CHECK(stored().active.key == active);
      CHECK(stored().active.seq == 5);
      // The owner key is as it was.
      CHECK(stored().owner.verifier == VerifyR1::service);

      CHECK(byActive(VerifyBr1::service, nop()).succeeded());
      // The default verifier's claims are now refused, though the signature is good.
      CHECK(byActive(VerifyR1::service, nop()).failed("Authorization for"));
      CHECK(byActive(VerifyK1::service, nop()).failed("unsupported public key"));
      CHECK(byOwner(VerifyR1::service, nop()).succeeded());
      CHECK(byOwner(VerifyBr1::service, nop()).failed("Authorization for"));

      // Back to the default
      REQUIRE(byOwner(VerifyR1::service, authSig.setActive(KeySpec::of(active))).succeeded());
      CHECK(stored().active.verifier == VerifyR1::service);
      CHECK(byActive(VerifyR1::service, nop()).succeeded());
      CHECK(byActive(VerifyBr1::service, nop()).failed("Authorization for"));
   }
   SECTION("a verifier that is not allowed for the key")
   {
      const char* notAllowed = "verifier is not allowed for this type of key";
      auto        with       = [&](AccountNumber verifier, const SubjectPublicKeyInfo& key)
      { return byOwner(VerifyR1::service, authSig.setActive(KeySpec{key, 0, verifier})); };
      // The other curve's verifier
      CHECK(with(VerifyK1::service, active).failed(notAllowed));
      // A service that is not a verifier
      CHECK(with(AuthSig::service, active).failed(notAllowed));
      CHECK(with(AccountNumber{}, active).failed(notAllowed));
      // A verify service that runs an allowed verifier's code under another name
      auto copy = AccountNumber{"copycopy"};
      t.addService(copy, "VerifyBr1.wasm", CodeRow::isVerify);
      CHECK(with(copy, active).failed(notAllowed));

      // A secp256k1 key has one verifier.
      auto k1 = getSubjectPublicKeyInfo(PrivateKeyInfo::create("secp256k1"));
      CHECK(with(VerifyBr1::service, k1).failed(notAllowed));
      CHECK(with(VerifyR1::service, k1).failed(notAllowed));
      // A key nothing verifies
      auto bad = active;
      bad.data.push_back(0);
      CHECK(with(VerifyBr1::service, bad).failed("unsupported public key"));

      // Nothing changed.
      CHECK(stored().active.verifier == VerifyR1::service);
      CHECK(stored().active.key == active);
      CHECK(byActive(VerifyR1::service, nop()).succeeded());
   }
}

TEST_CASE("auth-sig: only keys that have a verifier are stored")
{
   using SystemService::AuthSig::AuthSig;
   using SystemService::AuthSig::KeySpec;
   Fixture f;
   auto&   t       = f.t;
   auto    authSig = t.from(f.alice).to<AuthSig>();

   SECTION("every encoding the verifiers accept, with every allowed verifier")
   {
      for (auto target : targets())
      {
         INFO(target.name());
         auto priv = PrivateKeyInfo::create(target.group);
         auto key  = getSubjectPublicKeyInfo(priv).data;
         for (const Bytes& encoded : {key, compressed(key)})
         {
            INFO("key size " << encoded.size());
            // The default verifier is stored when none is named.
            KeySpec spec{SubjectPublicKeyInfo{encoded}, 0, {}};
            if (target.service != verifierFor(target.type))
               spec.verifier = target.service;
            REQUIRE(authSig.setKeys(spec, spec).succeeded());
            REQUIRE(t.from(f.alice)
                        .to<SystemService::Accounts>()
                        .setAuthServ(AuthSig::service)
                        .succeeded());
            // The account is usable with that key
            auto trx = f.transaction(encoded, target.service);
            CHECK(f.push(trx, f.sign(trx, priv)).succeeded());
            // and with no other.
            auto otherPriv = PrivateKeyInfo::create(target.group);
            auto bad = f.transaction(getSubjectPublicKeyInfo(otherPriv).data, target.service);
            CHECK(f.push(bad, f.sign(bad, otherPriv)).failed("Authorization for"));
            // Back to no signature for the next round.
            auto restore = t.makeTransaction(
                {transactor<SystemService::Accounts>{f.alice, SystemService::Accounts::service}
                     .setAuthServ(AccountNumber{"auth-any"})});
            restore.claims.push_back(
                {.service = target.service, .rawData = {encoded.begin(), encoded.end()}});
            REQUIRE(f.push(restore, f.sign(restore, priv)).succeeded());
         }
      }
   }
   SECTION("keys that nothing can verify")
   {
      auto good = getSubjectPublicKeyInfo(PrivateKeyInfo::create("secp256r1")).data;

      // secp384r1: well formed, but no verifier
      Bytes p384 = {0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
                    0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x62, 0x00, 0x04};
      p384.resize(120, 0x11);

      auto otherCurve = good;
      otherCurve[22] ^= 1;
      auto trailing = good;
      trailing.push_back(0);
      auto unusedBits                    = good;
      unusedBits[unusedBits.size() - 66] = 1;

      auto ok = KeySpec::of(SubjectPublicKeyInfo{good});
      int  n  = 0;
      for (const Bytes& key : {p384, otherCurve, trailing, unusedBits, Bytes{}, Bytes{0x30, 0x00}})
      {
         INFO("key " << n++ << ", size " << key.size());
         auto bad = KeySpec::of(SubjectPublicKeyInfo{key});
         // As the owner key and as the active key
         CHECK(authSig.setKeys(bad, ok).failed("unsupported public key"));
         t.startBlock(0);
         CHECK(authSig.setKeys(ok, bad).failed("unsupported public key"));
         t.startBlock(0);
         CHECK(authSig.setKeys(KeySpec{SubjectPublicKeyInfo{key}, 0, VerifyR1::service}, ok)
                   .failed("unsupported public key"));
         t.startBlock(0);
         CHECK(authSig.newAccount(AccountNumber{"carolcarol"}, bad, ok)
                   .failed("unsupported public key"));
         t.startBlock(0);
         CHECK(authSig.newAccount(AccountNumber{"carolcarol"}, ok, bad)
                   .failed("unsupported public key"));
         t.startBlock(0);
      }
      CHECK(authSig.newAccount(AccountNumber{"carolcarol"}, ok, ok).succeeded());
   }
}
