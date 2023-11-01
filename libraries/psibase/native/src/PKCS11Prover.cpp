#include <psibase/PKCS11Prover.hpp>

#include <openssl/sha.h>
#include <psibase/block.hpp>
#include <psibase/log.hpp>
#include <psibase/openssl.hpp>

using namespace psibase;
using namespace psibase::pkcs11;

namespace
{

   constexpr const char key_label[] = "psibase block signing key";

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
      BIGNUM* bn = nullptr;
      if (!EVP_PKEY_get_bn_param(key, "priv", &bn))
      {
         handleOpenSSLError();
      }
      std::unique_ptr<BIGNUM, OpenSSLDeleter> cleanup(bn);
      auto                                    len = BN_num_bytes(bn);
      std::vector<unsigned char>              privkey(len);
      BN_bn2bin(bn, &privkey[0]);
      return privkey;
   }

   std::vector<unsigned char> getKeyParams(EVP_PKEY* key)
   {
      unsigned char* p = nullptr;
      auto           n = i2d_KeyParams(key, &p);
      if (n < 0)
      {
         handleOpenSSLError();
      }
      std::unique_ptr<unsigned char, OpenSSLDeleter> cleanup(p);
      return std::vector(p, p + n);
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

   pkcs11::object_handle storeEcKey(pkcs11::session& s, std::string_view label, EVP_PKEY* key)
   {
      auto pubkey  = encodeOctetString(getPublicKeyData(key));
      auto privkey = getEcPrivateKeyData(key);
      auto params  = getKeyParams(key);

      attributes::allowed_mechanisms mechanisms;
      auto                           tokenMechanisms = s.GetMechanismList();
      std::ranges::sort(tokenMechanisms);
      if (std::ranges::binary_search(tokenMechanisms, pkcs11::mechanism_type::ecdsa_sha256))
      {
         mechanisms.value.push_back(pkcs11::mechanism_type::ecdsa_sha256);
      }
      else if (std::ranges::binary_search(tokenMechanisms, pkcs11::mechanism_type::ecdsa))
      {
         mechanisms.value.push_back(pkcs11::mechanism_type::ecdsa);
      }

      // set id to sha-256 key fingerprint
      auto                       spki = getPublicKey(key);
      std::vector<unsigned char> fingerprint(32);
      SHA256(reinterpret_cast<const unsigned char*>(spki.data()), spki.size(), fingerprint.data());

      auto priv = s.CreateObject(
          attributes::class_{object_class::private_key}, attributes::key_type{key_type::ecdsa},
          attributes::token{true}, attributes::label{std::string{label}}, mechanisms,
          attributes::id{fingerprint}, attributes::ec_params{params}, attributes::value{privkey});
      // Do we actually need to record a public key as a separate object?
      auto pub = s.CreateObject(
          attributes::class_{object_class::public_key}, attributes::key_type{key_type::ecdsa},
          attributes::token{true}, attributes::label{std::string{label}}, mechanisms,
          attributes::id{fingerprint}, attributes::ec_params{params}, attributes::ec_point{pubkey});
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
      const unsigned char* p         = reinterpret_cast<const unsigned char*>(params.value.data());
      auto                 keyParams = d2i_KeyParams(EVP_PKEY_EC, nullptr, &p, params.value.size());
      if (!keyParams)
      {
         handleOpenSSLError();
      }
      auto rawKey = decodeOctetString(point.value);
      p           = reinterpret_cast<const unsigned char*>(rawKey.data());
      std::unique_ptr<EVP_PKEY, OpenSSLDeleter> finalKey(
          d2i_PublicKey(EVP_PKEY_EC, &keyParams, &p, rawKey.size()));
      if (!finalKey)
      {
         handleOpenSSLError();
      }
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

   pkcs11::object_handle generateKey(pkcs11::session& session)
   {
      // if the session supports key generation...
      // otherwise
      return storeKey(session, key_label, psibase::generateKey().get());
   }
}  // namespace

void psibase::loadPKCS11Keys(std::shared_ptr<pkcs11::session> session,
                             AccountNumber                    service,
                             CompoundProver&                  out)
{
   auto keys =
       session->FindObjects(attributes::class_{object_class::private_key},
                            attributes::key_type{key_type::ecdsa}, attributes::label{key_label});
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

psibase::PKCS11Prover::PKCS11Prover(std::shared_ptr<pkcs11::session> session,
                                    AccountNumber                    service,
                                    pkcs11::object_handle            privateKey)
    : service(service),
      pubKey(::getPublicKey(*session, privateKey)),
      session(session),
      privateKey(privateKey)
{
   auto mechanisms =
       session->GetAttributeValue<pkcs11::attributes::allowed_mechanisms>(privateKey).value;
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
    : PKCS11Prover(session, service, storeKey(*session, key_label, parsePrivateKey(key).get()))
{
}

psibase::PKCS11Prover::PKCS11Prover(std::shared_ptr<pkcs11::session> session, AccountNumber service)
    : PKCS11Prover(session, service, ::generateKey(*session))
{
}

std::vector<char> psibase::PKCS11Prover::prove(std::span<const char> data, const Claim& claim) const
{
   if ((service == AccountNumber() || claim.service == service) && claim.rawData == pubKey)
   {
      auto data_cnvt = std::span{reinterpret_cast<const unsigned char*>(data.data()), data.size()};
      if (prehash)
      {
         std::array<unsigned char, 32> hash;
         SHA256(data_cnvt.data(), data_cnvt.size(), hash.data());
         return session->Sign(mechanism, privateKey, hash);
      }
      else
      {
         return session->Sign(mechanism, privateKey, data_cnvt);
      }
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
