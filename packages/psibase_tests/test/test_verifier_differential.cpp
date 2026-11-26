// The two P-256 verifiers must agree: verify-r1 (Botan) and the second
// verifier (BearSSL) are given the same key, digest and signature, and each
// must accept exactly what the other accepts.
//
// The cases are generated here from fresh keys on every run, so the count is
// fixed and the keys are not. The Wycheproof vectors are a fixed set:
// data/wycheproof_ecdsa_secp256r1_sha256_p1363_test.json is the file
// testvectors_v1/ecdsa_secp256r1_sha256_p1363_test.json of
// github.com/C2SP/wycheproof (version 0.9rc5, Apache License 2.0), unmodified.
#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/verifier.hpp>
#include <psio/json_value.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/VerifyBear1.hpp>
#include <services/system/VerifyR1.hpp>

#include <array>
#include <chrono>
#include <map>

using namespace psibase;
using SystemService::VerifyBear1;
using SystemService::VerifyR1;
using SystemService::AuthSig::PrivateKeyInfo;

namespace
{
   using Bytes  = std::vector<unsigned char>;
   using Scalar = std::array<unsigned char, 32>;

   // The group order n of P-256, big-endian
   constexpr Scalar order = {0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
                             0xff, 0xff, 0xff, 0xff, 0xff, 0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17,
                             0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51};

   Scalar plus(Scalar value, int delta)
   {
      int carry = delta;
      for (int i = 31; i >= 0 && carry != 0; --i)
      {
         int v    = value[i] + carry;
         carry    = v < 0 ? -1 : (v > 255 ? 1 : 0);
         value[i] = static_cast<unsigned char>(v & 0xff);
      }
      return value;
   }

   Scalar scalar(unsigned char low)
   {
      Scalar result = {};
      result[31]    = low;
      return result;
   }

   // order - s
   Scalar negate(std::span<const unsigned char> s)
   {
      Scalar result;
      int    borrow = 0;
      for (int i = 31; i >= 0; --i)
      {
         int d     = order[i] - s[i] - borrow;
         borrow    = d < 0;
         result[i] = static_cast<unsigned char>(d + (borrow ? 256 : 0));
      }
      return result;
   }

   Bytes compressed(const Bytes& spki)
   {
      const std::size_t header = spki.size() - 65;
      Bytes             result(spki.begin(), spki.begin() + header);
      result.push_back(spki.back() & 1 ? 0x03 : 0x02);
      result.insert(result.end(), spki.begin() + header + 1, spki.begin() + header + 33);
      result[1] -= 32;           // outer SEQUENCE length
      result[header - 2] -= 32;  // BIT STRING length
      return result;
   }

   // SubjectPublicKeyInfo around an uncompressed point
   Bytes spkiOf(std::span<const unsigned char> point)
   {
      auto  alg = verifier::algorithm(KeyType::secp256r1);
      Bytes result{0x30, static_cast<unsigned char>(alg.size() + 3 + point.size())};
      result.insert(result.end(), alg.begin(), alg.end());
      result.insert(result.end(), {0x03, static_cast<unsigned char>(point.size() + 1), 0x00});
      result.insert(result.end(), point.begin(), point.end());
      return result;
   }

   Bytes fromHex(std::string_view hex)
   {
      auto digit = [](char c) -> int
      {
         if (c >= '0' && c <= '9')
            return c - '0';
         if (c >= 'a' && c <= 'f')
            return c - 'a' + 10;
         if (c >= 'A' && c <= 'F')
            return c - 'A' + 10;
         return -1;
      };
      REQUIRE(hex.size() % 2 == 0);
      Bytes result;
      for (std::size_t i = 0; i < hex.size(); i += 2)
      {
         REQUIRE(digit(hex[i]) >= 0);
         REQUIRE(digit(hex[i + 1]) >= 0);
         result.push_back(static_cast<unsigned char>(digit(hex[i]) * 16 + digit(hex[i + 1])));
      }
      return result;
   }

   std::string toHex(std::span<const unsigned char> bytes)
   {
      std::string result;
      for (auto b : bytes)
      {
         result += "0123456789abcdef"[b >> 4];
         result += "0123456789abcdef"[b & 15];
      }
      return result;
   }

   struct Case
   {
      std::string         kind;
      Bytes               key;
      Checksum256         hash;
      Bytes               signature;
      std::optional<bool> expected;  // where the right answer is certain
   };

   Bytes signature(const Scalar& r, std::span<const unsigned char> s)
   {
      Bytes result(r.begin(), r.end());
      result.insert(result.end(), s.begin(), s.end());
      return result;
   }

   struct Tally
   {
      std::size_t cases        = 0;
      std::size_t accepted     = 0;
      std::size_t rejected     = 0;
      std::size_t disagreed    = 0;
      std::size_t unexpected   = 0;
      // kind -> (accepted, rejected)
      std::map<std::string, std::pair<std::size_t, std::size_t>> byKind;
      // The reasons each verifier gave: they may differ, the decision may not.
      std::map<std::string, std::size_t> reasons[2];
   };

   struct Differential
   {
      DefaultTestChain t;
      AccountNumber    alice = t.addAccount(AccountNumber("alice"));
      Tally            tally;
      std::size_t      inBlock = 0;

      // Decisions already made. The same key, digest and signature can come
      // up twice (a normalized vector may be another vector), and the chain
      // does not take the same transaction twice.
      std::map<std::string, std::string> decided;

      // One verifier's decision: an empty string if it accepts, or its reason
      std::string decide(AccountNumber service, const Case& c)
      {
         auto id = service.str() + toHex(c.key) + "/" +
                   toHex(std::span<const unsigned char>{c.hash.data(), c.hash.size()}) + "/" +
                   toHex(c.signature);
         if (auto pos = decided.find(id); pos != decided.end())
            return pos->second;
         return decided[id] = decideNew(service, c);
      }

      std::string decideNew(AccountNumber service, const Case& c)
      {
         VerifyArgs args{c.hash,
                         Claim{.service = service, .rawData = {c.key.begin(), c.key.end()}},
                         {c.signature.begin(), c.signature.end()}};
         auto trace = t.pushTransaction(t.makeTransaction({Action{
             .sender  = alice,
             .service = service,
             .method  = MethodNumber{"verifySys"},
             .rawData = psio::to_pssz(args),
         }}));
         if (!trace.error)
            return {};
         REQUIRE(!trace.error->empty());
         // Anything but the verifier's own refusal is a fault of this test.
         REQUIRE(trace.error->find("'" + service.str() + "' aborted") != std::string::npos);
         return *trace.error;
      }

      void run(const Case& c)
      {
         // The same action is never pushed twice in a block, but a block
         // does not have to hold every case either.
         if (++inBlock == 200)
         {
            t.startBlock();
            inBlock = 0;
         }
         std::string decisions[2] = {decide(VerifyR1::service, c), decide(VerifyBear1::service, c)};
         bool        accepted[2]  = {decisions[0].empty(), decisions[1].empty()};
         ++tally.cases;
         for (int i = 0; i < 2; ++i)
            if (!accepted[i])
            {
               // "service 'verify-r1' aborted with message: signature invalid"
               auto pos = decisions[i].rfind(": ");
               ++tally.reasons[i][pos == std::string::npos ? decisions[i]
                                                           : decisions[i].substr(pos + 2)];
            }
         auto describe = [&]
         {
            return c.kind + "\n  key  " + toHex(c.key) + "\n  hash " +
                   toHex(std::span<const unsigned char>{c.hash.data(), c.hash.size()}) +
                   "\n  sig  " + toHex(c.signature) + "\n  verify-r1: " +
                   (accepted[0] ? "accepted" : decisions[0]) + "\n  " +
                   VerifyBear1::service.str() + ": " + (accepted[1] ? "accepted" : decisions[1]);
         };
         if (accepted[0] != accepted[1])
         {
            ++tally.disagreed;
            FAIL_CHECK("the verifiers disagree: " << describe());
            return;
         }
         ++(accepted[0] ? tally.accepted : tally.rejected);
         auto& kind = tally.byKind[c.kind];
         ++(accepted[0] ? kind.first : kind.second);
         if (c.expected && *c.expected != accepted[0])
         {
            ++tally.unexpected;
            FAIL_CHECK("both verifiers " << (accepted[0] ? "accepted" : "rejected")
                                         << " what should have been "
                                         << (*c.expected ? "accepted" : "rejected") << ": "
                                         << describe());
         }
      }

      void report(std::string_view title)
      {
         std::string text{title};
         text += ": " + std::to_string(tally.cases) + " cases, " + std::to_string(tally.accepted) +
                 " accepted by both, " + std::to_string(tally.rejected) + " rejected by both, " +
                 std::to_string(tally.disagreed) + " disagreements, " +
                 std::to_string(tally.unexpected) + " unexpected decisions\n";
         for (auto& [kind, counts] : tally.byKind)
            text += "  " + kind + ": " + std::to_string(counts.first) + " accepted, " +
                    std::to_string(counts.second) + " rejected\n";
         for (int i = 0; i < 2; ++i)
         {
            text += i == 0 ? "  reasons given by verify-r1:"
                           : "  reasons given by " + VerifyBear1::service.str() + ":";
            for (auto& [reason, count] : tally.reasons[i])
               text += " \"" + reason + "\" x" + std::to_string(count);
            text += "\n";
         }
         std::printf("%s", text.c_str());
         std::fflush(stdout);
      }
   };
}  // namespace

TEST_CASE("P-256 verifiers agree: generated cases")
{
   Differential d;
   const int    keys = 40;

   for (int k = 0; k < keys; ++k)
   {
      auto priv  = PrivateKeyInfo::create("secp256r1");
      auto other = PrivateKeyInfo::create("secp256r1");
      auto key   = getSubjectPublicKeyInfo(priv).data;
      auto small = compressed(key);
      // The digest signed is that of a message that differs per key.
      Bytes message{'c', 'a', 's', 'e', static_cast<unsigned char>(k)};
      auto  hash = sha256(message.data(), message.size());
      auto  sig  = SystemService::AuthSig::sign(priv, hash);
      REQUIRE(sig.size() == 64);
      Bytes sigBytes(sig.begin(), sig.end());
      std::span<const unsigned char> rSpan{sigBytes.data(), 32};
      std::span<const unsigned char> sSpan{sigBytes.data() + 32, 32};
      Scalar                         r;
      std::copy(rSpan.begin(), rSpan.end(), r.begin());

      // Valid signatures, with both encodings of the key
      d.run({"valid, uncompressed key", key, hash, sigBytes, true});
      d.run({"valid, compressed key", small, hash, sigBytes, true});

      // The high-S twin (r, n - s) satisfies the equation but is not accepted.
      auto twin = signature(r, negate(sSpan));
      d.run({"high-S twin, uncompressed key", key, hash, twin, false});
      d.run({"high-S twin, compressed key", small, hash, twin, false});

      // Single-bit corruptions of the signature
      for (int i = 0; i < 24; ++i)
      {
         auto bad = sigBytes;
         bad[(k * 7 + i * 11) % 64] ^= static_cast<unsigned char>(1 << ((k + i) % 8));
         // A flipped bit may leave s low or make it high; either way the
         // signature is no longer the one that was made.
         d.run({"bit flipped in the signature", i % 2 ? key : small, hash, bad, false});
      }
      // of the digest
      for (int i = 0; i < 16; ++i)
      {
         auto bad = hash;
         bad[(k * 5 + i * 3) % 32] ^= static_cast<unsigned char>(1 << ((k + i) % 8));
         d.run({"bit flipped in the digest", i % 2 ? key : small, bad, sigBytes, false});
      }
      // and of the point, in both encodings (the prefix byte included). What
      // results may be no point, another point, or another encoding; none
      // of them is the key that signed.
      for (int i = 0; i < 12; ++i)
      {
         auto bad = key;
         bad[bad.size() - 65 + (k * 13 + i * 17) % 65] ^=
             static_cast<unsigned char>(1 << ((k + i) % 8));
         d.run({"bit flipped in the uncompressed point", bad, hash, sigBytes, false});
      }
      for (int i = 0; i < 12; ++i)
      {
         auto bad = small;
         bad[bad.size() - 33 + (k * 13 + i * 17) % 33] ^=
             static_cast<unsigned char>(1 << ((k + i) % 8));
         // Flipping the parity bit of the prefix gives the point with the
         // other y, which is on the curve; anything else gives another x.
         d.run({"bit flipped in the compressed point", bad, hash, sigBytes, false});
      }

      // r and s at the edges of their range
      const Scalar edges[] = {scalar(0), scalar(1), plus(order, -1), order, plus(order, 1)};
      for (auto& edge : edges)
      {
         d.run({"r at an edge of its range", key, hash, signature(edge, sSpan), false});
         d.run({"s at an edge of its range", k % 2 ? key : small, hash, signature(r, edge), false});
      }
      for (auto& rEdge : edges)
         for (auto& sEdge : edges)
            d.run({"r and s at edges of their range", k % 2 ? small : key, hash,
                   signature(rEdge, sEdge), false});

      // Another key's signature, and this signature under another key
      auto otherSig = SystemService::AuthSig::sign(other, hash);
      d.run({"signature by another key", key, hash, Bytes(otherSig.begin(), otherSig.end()),
             false});
      d.run({"another key", compressed(getSubjectPublicKeyInfo(other).data), hash, sigBytes,
             false});

      // Points not on the curve. Uncompressed: the right x with a wrong y.
      {
         auto bad = key;
         bad.back() ^= 1;
         d.run({"uncompressed point not on the curve", bad, hash, sigBytes, false});
         bad = key;
         bad[bad.size() - 32] ^= 0x80;
         d.run({"uncompressed point not on the curve", bad, hash, sigBytes, false});
         // x and y both zero, and both all ones (not below the field prime)
         bad = key;
         std::fill(bad.end() - 64, bad.end(), 0);
         d.run({"uncompressed point not on the curve", bad, hash, sigBytes, false});
         std::fill(bad.end() - 64, bad.end(), 0xff);
         d.run({"uncompressed point not on the curve", bad, hash, sigBytes, false});
      }
      // Compressed: an x derived from the digest. About half of all x have
      // no point; the rest are somebody else's key. Rejected either way,
      // and the two must agree on which is which only in rejecting.
      for (int i = 0; i < 4; ++i)
      {
         auto bad  = small;
         auto seed = sha256(bad.data(), bad.size());
         seed[0] ^= static_cast<unsigned char>(i);
         auto x = sha256(seed.data(), seed.size());
         std::copy(x.begin(), x.end(), bad.end() - 32);
         d.run({"compressed point with an arbitrary x", bad, hash, sigBytes, false});
      }
      // x not below the field prime
      {
         auto bad = small;
         std::fill(bad.end() - 32, bad.end(), 0xff);
         d.run({"compressed point with x out of range", bad, hash, sigBytes, false});
      }
   }

   d.report("generated P-256 cases");
   CHECK(d.tally.cases >= 4000);
   CHECK(d.tally.disagreed == 0);
   CHECK(d.tally.unexpected == 0);
   // Both encodings of every key verified.
   CHECK(d.tally.accepted == 2 * keys);
}

TEST_CASE("P-256 verifiers agree: Wycheproof ECDSA P-256 SHA-256 P1363 vectors")
{
   Differential d;
   auto contents = readWholeFile("wycheproof_ecdsa_secp256r1_sha256_p1363_test.json");
   auto document =
       psio::from_ijson<psio::json_value>(std::string{contents.data(), contents.size()});
   auto groups = document.find("testGroups");
   REQUIRE(groups != nullptr);
   REQUIRE(groups->as_array() != nullptr);

   std::size_t vectors = 0, validHighS = 0, validLowS = 0, invalid = 0;
   for (auto& group : *groups->as_array())
   {
      auto publicKey = group.find("publicKey");
      REQUIRE(publicKey != nullptr);
      auto point = fromHex(*publicKey->find("uncompressed")->as_string());
      REQUIRE(point.size() == 65);
      auto key   = spkiOf(point);
      auto small = compressed(key);
      REQUIRE(verifierFor(key) == VerifyR1::service);

      for (auto& test : *group.find("tests")->as_array())
      {
         auto message = fromHex(*test.find("msg")->as_string());
         auto sig     = fromHex(*test.find("sig")->as_string());
         auto result  = *test.find("result")->as_string();
         auto id      = test.find("tcId")->as_number()->text;
         auto hash    = sha256(message.data(), message.size());
         ++vectors;

         // Wycheproof's "valid" is the mathematical one. Here a signature is
         // also required to be 64 bytes with s <= n/2.
         std::optional<bool> expected;
         std::string         kind;
         if (result == "invalid")
         {
            expected = false;
            kind     = "wycheproof invalid";
            ++invalid;
         }
         else if (result == "valid" && sig.size() == 64)
         {
            bool low = verifier::isLowS(std::span<const unsigned char, 64>{sig.data(), 64},
                                        KeyType::secp256r1);
            expected = low;
            kind     = low ? "wycheproof valid, low S" : "wycheproof valid, high S";
            ++(low ? validLowS : validHighS);
         }
         else
         {
            kind = "wycheproof " + result;
         }
         d.run({kind + " (tcId " + id + ")", key, hash, sig, expected});
         d.run({kind + " (tcId " + id + ", compressed key)", small, hash, sig, expected});

         // A valid high-S vector's twin is a valid low-S signature.
         if (expected && !*expected && result == "valid")
         {
            Scalar r;
            std::copy(sig.begin(), sig.begin() + 32, r.begin());
            auto twin =
                signature(r, negate(std::span<const unsigned char>{sig.data() + 32, 32}));
            d.run({"wycheproof valid, high S, normalized (tcId " + id + ")", key, hash, twin,
                   true});
         }
      }
   }
   // Per-vector kinds would make the summary as long as the file.
   d.tally.byKind.clear();
   d.report("Wycheproof P-256 vectors");
   std::printf("  %zu vectors: %zu invalid, %zu valid with low S, %zu valid with high S\n",
               vectors, invalid, validLowS, validHighS);
   CHECK(vectors == 262);
   CHECK(d.tally.disagreed == 0);
   CHECK(d.tally.unexpected == 0);
}

// verify-r1 is deployed with its curve already set up (prestart in
// VerifyR1.cpp, evaluated when the service is built). The same code without
// that step sets the curve up in every instance that verifies. Here both
// verify the same signatures, one transaction and so one instance each, and
// the deployed one must not be paying for the set-up.
TEST_CASE("verify-r1 is pre-initialized")
{
   Differential d;
   auto         lazy = AccountNumber{"lazy-r1"};
   d.t.addService(lazy, "VerifyR1NotPreinitialized.wasm", CodeRow::isVerify);

   auto priv = PrivateKeyInfo::create("secp256r1");
   auto key  = getSubjectPublicKeyInfo(priv).data;

   auto elapsed = [&](AccountNumber service, int rounds)
   {
      std::vector<std::int64_t> times;
      for (int i = 0; i < rounds; ++i)
      {
         Bytes message{'t', static_cast<unsigned char>(i), static_cast<unsigned char>(i >> 8)};
         auto  hash = sha256(message.data(), message.size());
         auto  sig  = SystemService::AuthSig::sign(priv, hash);
         Case  c{"timing", key, hash, Bytes(sig.begin(), sig.end()), true};
         auto  begin = std::chrono::steady_clock::now();
         auto  reason = d.decide(service, c);
         auto  end    = std::chrono::steady_clock::now();
         REQUIRE(reason == "");
         times.push_back(
             std::chrono::duration_cast<std::chrono::microseconds>(end - begin).count());
      }
      std::ranges::sort(times);
      return times;
   };

   // Warm both once: the first use of a service compiles it.
   elapsed(VerifyR1::service, 3);
   elapsed(lazy, 3);
   d.t.startBlock();
   const int rounds = 200;
   auto      ready  = elapsed(VerifyR1::service, rounds);
   d.t.startBlock();
   auto unprepared = elapsed(lazy, rounds);

   std::printf(
       "one verification in its own transaction, microseconds (min / median / max of %d):\n"
       "  verify-r1 as deployed:        %lld / %lld / %lld\n"
       "  same code, not pre-initialized: %lld / %lld / %lld\n",
       rounds, (long long)ready.front(), (long long)ready[rounds / 2], (long long)ready.back(),
       (long long)unprepared.front(), (long long)unprepared[rounds / 2],
       (long long)unprepared.back());
   std::fflush(stdout);

   // The set-up is several times a verification. The machine may be busy,
   // so the fastest runs are compared.
   CHECK(ready.front() < unprepared.front());
   CHECK(ready[rounds / 2] < unprepared[rounds / 2]);
}
