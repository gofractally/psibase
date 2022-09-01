#include <secp256k1.h>
#include <psibase/EcdsaProver.hpp>
#include <psibase/block.hpp>

namespace
{
   secp256k1_context* get_context()
   {
      static secp256k1_context* result = secp256k1_context_create(SECP256K1_CONTEXT_SIGN);
      return result;
   }
}  // namespace

psibase::EcdsaSecp256K1Sha256Prover::EcdsaSecp256K1Sha256Prover(AccountNumber     contract,
                                                                const PrivateKey& key)
    : contract(contract)
{
   const auto& k1key = std::get<0>(key.data);
   std::memcpy(privateKey, k1key.data(), sizeof(privateKey));
   auto             ctx = get_context();
   secp256k1_pubkey pub;
   if (!secp256k1_ec_pubkey_create(ctx, &pub, privateKey))
   {
      throw std::runtime_error("invalid private key");
   }

   EccPublicKey eccPubKey;
   std::size_t  sz = eccPubKey.size();
   secp256k1_ec_pubkey_serialize(ctx, reinterpret_cast<unsigned char*>(eccPubKey.data()), &sz, &pub,
                                 SECP256K1_EC_COMPRESSED);
   pubKey =
       psio::convert_to_frac(PublicKey{PublicKey::variant_type{std::in_place_index<0>, eccPubKey}});
}

std::vector<char> psibase::EcdsaSecp256K1Sha256Prover::prove(std::span<const char> data,
                                                             const Claim&          claim) const
{
   if ((contract == AccountNumber() || claim.contract == contract) && claim.rawData == pubKey)
   {
      Checksum256 hash = sha256(data.data(), data.size());
      // sign compact
      auto                      ctx = get_context();
      secp256k1_ecdsa_signature sig;
      if (!secp256k1_ecdsa_sign(ctx, &sig, reinterpret_cast<const unsigned char*>(hash.data()),
                                privateKey, nullptr, nullptr))
      {
         return {};
      }
      EccSignature result;
      secp256k1_ecdsa_signature_serialize_compact(
          ctx, reinterpret_cast<unsigned char*>(result.data()), &sig);
      return psio::convert_to_frac(
          Signature{Signature::variant_type{std::in_place_index<0>, result}});
   }
   else
   {
      return {};
   }
}
