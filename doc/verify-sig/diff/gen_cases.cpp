// Writes a file of verification cases for differential testing of two
// verify-sig implementations.
//
// Record: u32 action length, packed verifySys action, u8 expected by the
// canonical (low-S) verifier (0 reject, 1 accept, 2 unspecified), u8 expected
// by a verifier that accepts either s (same codes), u16 label length, label.
//
// usage: gen_cases <out.bin> <random cases per curve> [wycheproof.txt]
#include <botan/auto_rng.h>
#include <botan/bigint.h>
#include <botan/ec_group.h>
#include <botan/ecdsa.h>
#include <botan/pubkey.h>
#include <botan/x509_key.h>
#include <psibase/block.hpp>
#include <psibase/serviceEntry.hpp>
#include <fstream>
#include <iostream>
#include <sstream>

using namespace psibase;
using Bytes = std::vector<unsigned char>;

static std::ofstream out;
static std::size_t   count = 0;

static void emit(const Bytes& hash32, const Bytes& key, const Bytes& sig, int canon, int plain,
                 const std::string& label)
{
   Checksum256 hash{};
   std::copy_n(hash32.begin(), std::min<std::size_t>(32, hash32.size()), hash.begin());
   Claim             claim{AccountNumber{"verify-sig"}, {key.begin(), key.end()}};
   std::vector<char> proof(sig.begin(), sig.end());
   Action            act{.service = claim.service,
                         .method  = MethodNumber{"verifySys"},
                         .rawData = psio::to_frac(std::tie(hash, claim, proof))};
   auto              packed = psio::to_frac(act);
   uint32_t          n      = packed.size();
   uint16_t          l      = label.size();
   out.write(reinterpret_cast<const char*>(&n), 4);
   out.write(packed.data(), n);
   out.put(static_cast<char>(canon));
   out.put(static_cast<char>(plain));
   out.write(reinterpret_cast<const char*>(&l), 2);
   out.write(label.data(), l);
   ++count;
}

static Bytes fromHex(const std::string& s)
{
   Bytes r;
   if (s == "-")
      return r;
   for (std::size_t i = 0; i + 1 < s.size(); i += 2)
      r.push_back(static_cast<unsigned char>(std::stoi(s.substr(i, 2), nullptr, 16)));
   return r;
}

static Bytes compressed(const Bytes& spki)
{
   const std::size_t header = spki.size() - 65;
   Bytes             r(spki.begin(), spki.begin() + header);
   r.push_back(spki.back() & 1 ? 0x03 : 0x02);
   r.insert(r.end(), spki.begin() + header + 1, spki.begin() + header + 33);
   r[1] -= 32;
   r[header - 2] -= 32;
   return r;
}

int main(int argc, char** argv)
{
   out.open(argv[1], std::ios::binary);
   int                   perCurve = std::atoi(argv[2]);
   Botan::AutoSeeded_RNG rng;
   auto rnd = [&](std::size_t n) { return ((static_cast<std::size_t>(rng.next_byte()) << 8) | rng.next_byte()) % n; };

   for (std::string curve : {"secp256k1", "secp256r1"})
   {
      Botan::EC_Group      group(curve);
      const Botan::BigInt& order = group.get_order();
      const Botan::BigInt  half  = order / 2;
      auto                 enc   = [](const Botan::BigInt& v) { Bytes b(32); Botan::BigInt::encode_1363(b.data(), 32, v); return b; };
      for (int i = 0; i < perCurve; ++i)
      {
         Botan::ECDSA_PrivateKey key(rng, group);
         Botan::ECDSA_PrivateKey other(rng, group);
         Bytes                   spki      = Botan::X509::BER_encode(key);
         Bytes                   otherSpki = Botan::X509::BER_encode(other);
         Bytes                   hash(32);
         rng.randomize(hash.data(), 32);
         Botan::PK_Signer signer(key, rng, "Raw", Botan::Signature_Format::Standard);
         Bytes            sig = signer.sign_message(hash, rng);
         Botan::BigInt    s(sig.data() + 32, 32);
         Bytes            low = sig, high = sig;
         auto             lowS  = s > half ? order - s : s;
         auto             highS = order - lowS;
         std::copy_n(enc(lowS).begin(), 32, low.begin() + 32);
         std::copy_n(enc(highS).begin(), 32, high.begin() + 32);
         const std::string c = curve + "-";

         emit(hash, spki, low, 1, 1, c + "valid-lowS");
         emit(hash, spki, high, 0, 1, c + "valid-highS");
         emit(hash, compressed(spki), low, 1, 1, c + "valid-compressed-key");
         emit(hash, compressed(spki), high, 0, 1, c + "valid-compressed-key-highS");
         emit(hash, otherSpki, low, 0, 0, c + "wrong-key");

         {  // one flipped bit in the signature
            Bytes m = low;
            m[rnd(64)] ^= 1 << (rng.next_byte() % 8);
            emit(hash, spki, m, 0, 0, c + "sig-bit-flip");
         }
         {  // one flipped bit in the hash
            Bytes m = hash;
            m[rnd(32)] ^= 1 << (rng.next_byte() % 8);
            emit(m, spki, low, 0, 0, c + "hash-bit-flip");
         }
         {  // one flipped bit anywhere in the key: outcome unspecified, must agree
            Bytes m = spki;
            m[rnd(m.size())] ^= 1 << (rng.next_byte() % 8);
            emit(hash, m, low, 2, 2, c + "key-bit-flip");
            Bytes mc = compressed(spki);
            mc[rnd(mc.size())] ^= 1 << (rng.next_byte() % 8);
            emit(hash, mc, low, 2, 2, c + "compressed-key-bit-flip");
         }
         {  // one random byte replaced in the key
            Bytes m = spki;
            m[rnd(m.size())] = rng.next_byte();
            emit(hash, m, low, 2, 2, c + "key-byte-random");
         }
         if (i % 16 == 0)
         {  // lengths and special values
            Bytes shorter(low.begin(), low.end() - 1), longer = low;
            longer.push_back(0);
            emit(hash, spki, shorter, 0, 0, c + "sig-63-bytes");
            emit(hash, spki, longer, 0, 0, c + "sig-65-bytes");
            emit(hash, spki, {}, 0, 0, c + "sig-empty");
            Bytes truncatedKey(spki.begin(), spki.end() - 1), longerKey = spki;
            longerKey.push_back(0);
            emit(hash, truncatedKey, low, 0, 0, c + "key-truncated");
            emit(hash, longerKey, low, 0, 0, c + "key-trailing-byte");
            emit(hash, {}, low, 0, 0, c + "key-empty");
            const Botan::BigInt& p = group.get_p();
            for (auto [name, v] : {std::pair{"zero", Botan::BigInt(0)}, std::pair{"one", Botan::BigInt(1)},
                                   std::pair{"n", order}, std::pair{"n-1", order - 1},
                                   std::pair{"n+1", order + 1}, std::pair{"p", p},
                                   std::pair{"max", (Botan::BigInt(1) << 256) - 1}})
            {
               Bytes rr = low, ss = low;
               std::copy_n(enc(v).begin(), 32, rr.begin());
               std::copy_n(enc(v).begin(), 32, ss.begin() + 32);
               emit(hash, spki, rr, 0, 0, c + "r=" + name);
               emit(hash, spki, ss, 0, 0, c + "s=" + name);
            }
         }
      }
   }
   if (argc > 3)
   {
      std::ifstream in(argv[3]);
      std::string   line;
      while (std::getline(in, line))
      {
         std::istringstream ls(line);
         std::string        h, k, s, label;
         int                canon, plain;
         ls >> h >> k >> s >> canon >> plain >> label;
         emit(fromHex(h), fromHex(k), fromHex(s), canon, plain, label);
      }
   }
   std::cout << count << " cases written to " << argv[1] << "\n";
}
