// Generates packed verifySys actions (the exact bytes the node hands to
// VerifySig via getCurrentAction) for secp256k1 and secp256r1, valid and
// invalid, built the same way as psibase::makeVerify.
#include <botan/auto_rng.h>
#include <botan/ec_group.h>
#include <botan/ecdsa.h>
#include <botan/pubkey.h>
#include <botan/x509_key.h>
#include <psibase/block.hpp>
#include <psibase/serviceEntry.hpp>
#include <fstream>
#include <iostream>

using namespace psibase;

static void write(const std::string& name, const Action& act)
{
   auto          packed = psio::to_frac(act);
   std::ofstream out(name, std::ios::binary);
   out.write(packed.data(), packed.size());
   std::cout << name << " " << packed.size() << " bytes\n";
}

int main(int argc, char** argv)
{
   std::string           dir = argc > 1 ? argv[1] : ".";
   Botan::AutoSeeded_RNG rng;
   for (const char* curve : {"secp256k1", "secp256r1"})
   {
      Botan::ECDSA_PrivateKey key(rng, Botan::EC_Group(curve));
      auto                    spki = Botan::X509::BER_encode(key);
      Checksum256             hash;
      rng.randomize(hash.data(), hash.size());
      Botan::PK_Signer signer(key, rng, "Raw", Botan::Signature_Format::Standard);
      auto             sig = signer.sign_message(hash, rng);

      Claim             claim{AccountNumber{"verify-sig"}, {spki.begin(), spki.end()}};
      std::vector<char> proof(sig.begin(), sig.end());
      std::cout << curve << ": spki " << spki.size() << " bytes, signature " << sig.size()
                << " bytes\n";
      auto make = [&](const std::vector<char>& p)
      {
         return Action{.service = claim.service,
                       .method  = MethodNumber{"verifySys"},
                       .rawData = psio::to_frac(std::tie(hash, claim, p))};
      };
      write(dir + "/" + curve + "_valid.bin", make(proof));
      auto bad = proof;
      bad[40] ^= 1;
      write(dir + "/" + curve + "_invalid.bin", make(bad));
   }
}
