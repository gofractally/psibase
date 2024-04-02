#include <psibase/PKCS11Prover.hpp>

#include <openssl/rand.h>
#include <openssl/sha.h>
#include <openssl/x509.h>
#include <psibase/EcdsaProver.hpp>
#include <psibase/block.hpp>
#include <psibase/log.hpp>
#include <psibase/openssl.hpp>

using namespace psibase;
using namespace psibase::pkcs11;

namespace
{

   constexpr const char key_label[]   = "psibase block signing key";
   constexpr const char eckey_label[] = "psibase block signing EC key";

   std::vector<unsigned char> getPublicKeyData(EVP_PKEY* key)
   {
      unsigned char* p = nullptr;
      auto           n = i2d_PublicKey(key, &p);
      if (n < 0)
      {
         handleOpenSSLError();
      }
      std::unique_ptr<unsigned char, OpenSSLDeleter> cleanup(p);
      return std::vector(p, p + n);
   }

   std::vector<unsigned char> getEcPrivateKeyData(EVP_PKEY* key)
   {
#if OPENSSL_VERSION_NUMBER >= 0x30000000
      BIGNUM* bn = nullptr;
      if (!EVP_PKEY_get_bn_param(key, "priv", &bn))
      {
         handleOpenSSLError();
      }
      std::unique_ptr<BIGNUM, OpenSSLDeleter> cleanup(bn);
#else
      auto eckey = EVP_PKEY_get0_EC_KEY(key);
      check(!!eckey, "Not an EC_KEY");
      const BIGNUM* bn = EC_KEY_get0_private_key(eckey);
      check(!!bn, "Failed to get private key");
#endif
      auto                       len = BN_num_bytes(bn);
      std::vector<unsigned char> privkey(len);
      BN_bn2bin(bn, &privkey[0]);
      return privkey;
   }

   std::vector<unsigned char> getKeyParams(EVP_PKEY* key)
   {
#if OPENSSL_VERSION_NUMBER >= 0x30000000
      unsigned char* p = nullptr;
      auto           n = i2d_KeyParams(key, &p);
      if (n < 0)
      {
         handleOpenSSLError();
      }
      std::unique_ptr<unsigned char, OpenSSLDeleter> cleanup(p);
      return std::vector(p, p + n);
#else
      auto eckey = EVP_PKEY_get0_EC_KEY(key);
      check(!!eckey, "Not an EC_KEY");
      int n = i2d_ECParameters(eckey, nullptr);
      if (n < 0)
      {
         handleOpenSSLError();
      }
      std::vector<unsigned char> result(n);
      unsigned char*             p = result.data();
      i2d_ECParameters(eckey, &p);
      return result;
#endif
   }

   std::vector<unsigned char> encodeOctetString(std::span<const unsigned char> content)
   {
      std::unique_ptr<ASN1_OCTET_STRING, OpenSSLDeleter> decoded{ASN1_OCTET_STRING_new()};
      if (!decoded)
      {
         handleOpenSSLError();
      }
      if (!ASN1_OCTET_STRING_set(decoded.get(), content.data(), content.size()))
      {
         handleOpenSSLError();
      }
      unsigned char* result = nullptr;
      int            n      = i2d_ASN1_OCTET_STRING(decoded.get(), &result);
      if (n < 0)
      {
         handleOpenSSLError();
      }
      std::unique_ptr<unsigned char, OpenSSLDeleter> cleanup(result);
      return std::vector<unsigned char>(result, result + n);
   }

   std::vector<unsigned char> decodeOctetString(std::span<const unsigned char> content)
   {
      const unsigned char*                               p = content.data();
      std::unique_ptr<ASN1_OCTET_STRING, OpenSSLDeleter> decoded{
          d2i_ASN1_OCTET_STRING(nullptr, &p, content.size())};
      if (!decoded)
      {
         handleOpenSSLError();
      }
      const unsigned char* result = ASN1_STRING_get0_data(decoded.get());
      int                  n      = ASN1_STRING_length(decoded.get());
      return std::vector<unsigned char>(result, result + n);
   }

   std::vector<unsigned char> encodeObjectId(ASN1_OBJECT* obj)
   {
      int sz = i2d_ASN1_OBJECT(obj, nullptr);
      if (sz < 0)
      {
         handleOpenSSLError();
      }
      std::vector<unsigned char> result(sz);
      if (sz != 0)
      {
         unsigned char* p = result.data();
         i2d_ASN1_OBJECT(obj, &p);
      }
      return result;
   }

   pkcs11::object_handle storeEcKey(pkcs11::session& s, std::string_view label, EVP_PKEY* key)
   {
      auto pubkey  = encodeOctetString(getPublicKeyData(key));
      auto privkey = getEcPrivateKeyData(key);
      auto params  = getKeyParams(key);

      // set id to sha-256 key fingerprint
      auto                       spki = getPublicKey(key);
      std::vector<unsigned char> fingerprint(32);
      SHA256(reinterpret_cast<const unsigned char*>(spki.data()), spki.size(), fingerprint.data());

      auto priv = s.CreateObject(attributes::class_{object_class::private_key},
                                 attributes::key_type{key_type::ecdsa}, attributes::token{true},
                                 attributes::label{std::string{label}}, attributes::id{fingerprint},
                                 attributes::ec_params{params}, attributes::value{privkey});
      // Do we actually need to record a public key as a separate object?
      auto pub = s.CreateObject(attributes::class_{object_class::public_key},
                                attributes::key_type{key_type::ecdsa}, attributes::token{true},
                                attributes::label{std::string{label}}, attributes::id{fingerprint},
                                attributes::ec_params{params}, attributes::ec_point{pubkey});
      return priv;
   }

   pkcs11::object_handle storeKey(pkcs11::session& s, std::string_view label, EVP_PKEY* key)
   {
      if (EVP_PKEY_base_id(key) == EVP_PKEY_EC)
      {
         return storeEcKey(s, label, key);
      }
      else
      {
         throw std::runtime_error("Unimplemented key type");
      }
   }

   std::vector<char> getEcPublicKey(pkcs11::session& session, pkcs11::object_handle private_key)
   {
      // look up the corresponding public key
      auto id  = session.GetAttributeValue<attributes::id>(private_key);
      auto pub = session.FindObjects(attributes::class_{object_class::public_key}, id);
      auto key = pub.empty() ? private_key : pub[0];

      auto [params, point] =
          session.GetAttributeValues<attributes::ec_params, attributes::ec_point>(key);
      // sequence{{ecdsa, ec_params}, ec_point}
      auto rawKey = decodeOctetString(point.value);
#if OPENSSL_VERSION_NUMBER >= 0x30000000
      const unsigned char* p         = reinterpret_cast<const unsigned char*>(params.value.data());
      auto                 keyParams = d2i_KeyParams(EVP_PKEY_EC, nullptr, &p, params.value.size());
      if (!keyParams)
      {
         handleOpenSSLError();
      }
      p = reinterpret_cast<const unsigned char*>(rawKey.data());
      std::unique_ptr<EVP_PKEY, OpenSSLDeleter> finalKey(
          d2i_PublicKey(EVP_PKEY_EC, &keyParams, &p, rawKey.size()));
      if (!finalKey)
      {
         handleOpenSSLError();
      }
      return getPublicKey(finalKey.get());
#else
      const unsigned char*                    p = params.value.data();
      std::unique_ptr<EC_KEY, OpenSSLDeleter> eckey(
          d2i_ECParameters(nullptr, &p, params.value.size()));
      if (!eckey)
      {
         handleOpenSSLError();
      }
      if (!EC_KEY_oct2key(eckey.get(), rawKey.data(), rawKey.size(), nullptr))
      {
         handleOpenSSLError();
      }
      std::unique_ptr<EVP_PKEY, OpenSSLDeleter> finalKey(EVP_PKEY_new());
      EVP_PKEY_assign_EC_KEY(finalKey.get(), eckey.release());
#endif
      return getPublicKey(finalKey.get());
   }

   std::vector<char> getPublicKey(pkcs11::session& session, pkcs11::object_handle private_key)
   {
      auto [class_, key_type] =
          session.GetAttributeValues<attributes::class_, attributes::key_type>(private_key);
      if (class_.value != object_class::private_key)
      {
         throw std::runtime_error("Private key expected");
      }
      if (key_type.value == key_type::ecdsa)
      {
         return getEcPublicKey(session, private_key);
      }
      else
      {
         throw std::runtime_error("Unnimplemented key type");
      }
   }

   // The ID is only a convenience. It isn't required for security.
   std::vector<unsigned char> newId(pkcs11::session& session)
   {
      std::vector<unsigned char> result(8);
      do
      {
         if (RAND_bytes(result.data(), result.size()) != 1)
         {
            handleOpenSSLError();
         }
      } while (!session.FindObjects(attributes::id{result}).empty());
      return result;
   }

   pkcs11::object_handle generateKey(pkcs11::session& session, std::string_view label, int nid)
   {
      auto tokenMechanisms = session.GetMechanismList();
      std::ranges::sort(tokenMechanisms);
      if (std::ranges::binary_search(tokenMechanisms, pkcs11::mechanism_type::ec_key_pair_gen))
      {
         auto params =
             encodeObjectId(std::unique_ptr<ASN1_OBJECT, OpenSSLDeleter>(OBJ_nid2obj(nid)).get());
         auto id          = newId(session);
         auto [pub, priv] = session.GenerateKeyPair(
             pkcs11::mechanism{pkcs11::mechanism_type::ec_key_pair_gen},
             std::tuple(attributes::token{true}, attributes::id{id},
                        attributes::label{std::string{label}}, attributes::verify{true},
                        attributes::ec_params{params}),
             std::tuple(attributes::token{true}, attributes::id{id},
                        attributes::label{std::string{label}}, attributes::sign{true}));
         return priv;
      }
      // If there is no suitable key gen mechansim, fall back on generating and
      // importing a key
      return storeKey(session, label, psibase::generateKey(nid).get());
   }

   // This converts a public key in SubjectPublicKeyInfo form
   // to the service-specific form used in a Claim
   std::vector<char> convertPublicKey(AccountNumber service, std::vector<char>&& in)
   {
      if (service == AccountNumber{"verify-sig"})
      {
         return std::move(in);
      }
      else if (service == AccountNumber{"verifyk1"})
      {
         const unsigned char* p = reinterpret_cast<const unsigned char*>(in.data());
         std::unique_ptr<EVP_PKEY, OpenSSLDeleter> key(d2i_PUBKEY(nullptr, &p, in.size()));
         if (!key)
         {
            handleOpenSSLError();
         }
         setCompressedKey(key.get());
         check(EVP_PKEY_base_id(key.get()) == EVP_PKEY_EC, "Expected EC key");
         auto         data = getPublicKeyData(key.get());
         EccPublicKey eckey;
         check(data.size() == eckey.size(), "Expected compressed public key");
         std::ranges::copy(data, eckey.begin());
         auto params = getKeyParams(key.get());
         p           = params.data();
         std::unique_ptr<ASN1_OBJECT, OpenSSLDeleter> id(
             d2i_ASN1_OBJECT(nullptr, &p, params.size()));
         check(!!id, "Expected named curve");
         auto nid = OBJ_obj2nid(id.get());
         if (nid == NID_X9_62_prime256v1)
         {
            return psio::to_frac(PublicKey{PublicKey::variant_type{std::in_place_index<1>, eckey}});
         }
         else if (nid == NID_secp256k1)
         {
            return psio::to_frac(PublicKey{PublicKey::variant_type{std::in_place_index<0>, eckey}});
         }
         else
         {
            throw std::runtime_error("Unsupported curve for verifyk1");
         }
      }
      else
      {
         throw std::runtime_error("Unsupported verify service");
      }
   }

   pkcs11::object_handle parseAndStoreKey(pkcs11::session&      session,
                                          AccountNumber         service,
                                          std::span<const char> key)
   {
      if (service == AccountNumber{"verify-sig"})
      {
         return storeKey(session, key_label, parsePrivateKey(key).get());
      }
      else if (service == AccountNumber{"verifyk1"})
      {
         auto           k = psio::from_frac<PrivateKey>(key);
         EccPrivateKey* eckey;
         int            nid;
         if (auto* k1 = std::get_if<0>(&k.data))
         {
            eckey = k1;
            nid   = NID_secp256k1;
         }
         if (auto* r1 = std::get_if<1>(&k.data))
         {
            eckey = r1;
            nid   = NID_X9_62_prime256v1;
         }
         else
         {
            throw std::runtime_error("Unexpected variant value");
         }

         auto params =
             encodeObjectId(std::unique_ptr<ASN1_OBJECT, OpenSSLDeleter>(OBJ_nid2obj(nid)).get());
         auto privkey = std::vector<unsigned char>(eckey->begin(), eckey->end());
         auto pubkey =
             encodeOctetString(std::visit(std::identity(), psibase::getPublicKey(k).data));
         std::vector<unsigned char> fingerprint(32);
         SHA256(pubkey.data(), pubkey.size(), fingerprint.data());
         std::string_view label = eckey_label;

         auto priv = session.CreateObject(
             attributes::class_{object_class::private_key}, attributes::key_type{key_type::ecdsa},
             attributes::token{true}, attributes::label{std::string{label}},
             attributes::id{fingerprint}, attributes::ec_params{params},
             attributes::value{privkey});
         auto pub = session.CreateObject(
             attributes::class_{object_class::public_key}, attributes::key_type{key_type::ecdsa},
             attributes::token{true}, attributes::label{std::string{label}},
             attributes::id{fingerprint}, attributes::ec_params{params},
             attributes::ec_point{pubkey});
         return priv;
      }
      else
      {
         throw std::runtime_error("Unsupported verify service");
      }
   }

   std::vector<char> formatSignature(AccountNumber            service,
                                     const std::vector<char>& pubkey,
                                     std::vector<char>&&      sig)
   {
      if (service == AccountNumber{"verify-sig"})
      {
         return std::move(sig);
      }
      else if (service == AccountNumber{"verifyk1"})
      {
         EccSignature result;
         check(result.size() == sig.size(), "Wrong size for ECDSA signature");
         std::memcpy(result.data(), sig.data(), sig.size());
         psio::view<const PublicKey> pkey_view{pubkey};
         switch (pkey_view.data().index())
         {
            case 0:
               return psio::to_frac(
                   Signature{Signature::variant_type{std::in_place_index<0>, result}});
            case 1:
               return psio::to_frac(
                   Signature{Signature::variant_type{std::in_place_index<1>, result}});
            default:
               throw std::runtime_error("Wrong variant value");
         }
      }
      else
      {
         throw std::runtime_error("Unsupported verify service");
      }
   }

   // Use the CKA_ALLOWED_MECHANISMS attribute if available or the token's mechanism list otherwise.
   std::vector<pkcs11::mechanism_type> getKeyMechanisms(pkcs11::session&      session,
                                                        pkcs11::object_handle privateKey)
   {
      if (auto mechanisms =
              session.TryGetAttributeValue<pkcs11::attributes::allowed_mechanisms>(privateKey))
      {
         if (!mechanisms->value.empty())
         {
            return std::move(mechanisms->value);
         }
      }
      return session.GetMechanismList();
   }
}  // namespace

void psibase::loadPKCS11Keys(std::shared_ptr<pkcs11::session> session,
                             AccountNumber                    service,
                             std::string_view                 label,
                             CompoundProver&                  out)
{
   auto keys = session->FindObjects(attributes::class_{object_class::private_key},
                                    attributes::key_type{key_type::ecdsa},
                                    attributes::label{std::string{label}});
   for (pkcs11::object_handle key : keys)
   {
      try
      {
         out.add(std::make_shared<PKCS11Prover>(session, service, key));
      }
      catch (std::runtime_error& e)
      {
         PSIBASE_LOG(psibase::loggers::generic::get(), warning) << "Load key failed: " << e.what();
      }
   }
}

void psibase::loadPKCS11Keys(std::shared_ptr<pkcs11::session> session, CompoundProver& out)
{
   loadPKCS11Keys(session, AccountNumber{"verify-sig"}, key_label, out);
   loadPKCS11Keys(session, AccountNumber{"verifyk1"}, eckey_label, out);
}

psibase::PKCS11Prover::PKCS11Prover(std::shared_ptr<pkcs11::session> session,
                                    AccountNumber                    service,
                                    pkcs11::object_handle            privateKey)
    : service(service),
      pubKey(convertPublicKey(service, ::getPublicKey(*session, privateKey))),
      session(session),
      privateKey(privateKey)
{
   auto mechanisms = getKeyMechanisms(*session, privateKey);
   std::ranges::sort(mechanisms);
   if (std::ranges::binary_search(mechanisms, pkcs11::mechanism_type::ecdsa_sha256))
   {
      mechanism.mechanism = pkcs11::mechanism_type::ecdsa_sha256;
   }
   else if (std::ranges::binary_search(mechanisms, pkcs11::mechanism_type::ecdsa))
   {
      mechanism.mechanism = pkcs11::mechanism_type::ecdsa;
      prehash             = true;
   }
   else
   {
      throw std::runtime_error("Key does not support ecdsa");
   }
}

psibase::PKCS11Prover::PKCS11Prover(std::shared_ptr<pkcs11::session> session,
                                    AccountNumber                    service,
                                    std::span<const char>            key)
    : PKCS11Prover(session, service, parseAndStoreKey(*session, service, key))
{
}

psibase::PKCS11Prover::PKCS11Prover(std::shared_ptr<pkcs11::session> session, AccountNumber service)
    : PKCS11Prover(session,
                   service,
                   ::generateKey(*session,
                                 service == AccountNumber{"verify-sig"} ? key_label : eckey_label,
                                 service == AccountNumber{"verify-sig"} ? NID_X9_62_prime256v1
                                                                        : NID_secp256k1))
{
}

std::vector<char> psibase::PKCS11Prover::prove(std::span<const char> data, const Claim& claim) const
{
   if ((service == AccountNumber() || claim.service == service) && claim.rawData == pubKey)
   {
      auto data_cnvt = std::span{reinterpret_cast<const unsigned char*>(data.data()), data.size()};
      std::vector<char> result;
      if (prehash)
      {
         std::array<unsigned char, 32> hash;
         SHA256(data_cnvt.data(), data_cnvt.size(), hash.data());
         result = session->Sign(mechanism, privateKey, hash);
      }
      else
      {
         result = session->Sign(mechanism, privateKey, data_cnvt);
      }
      return formatSignature(service, pubKey, std::move(result));
   }
   else
   {
      return {};
   }
}

bool psibase::PKCS11Prover::remove(const Claim& claim)
{
   return (service == AccountNumber() || claim.service == service) && claim.rawData == pubKey;
}

void psibase::PKCS11Prover::get(std::vector<Claim>& out) const
{
   out.push_back({service, pubKey});
}

void psibase::PKCS11Prover::get(std::vector<ClaimKey>& out) const
{
   // PKCS11 keys are stored in the token. We don't need to export them
   // to the config file
}

psibase::Claim psibase::PKCS11Prover::get() const
{
   return {service, pubKey};
}
