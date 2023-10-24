#include <services/system/RAuthSys.hpp>

#include <botan/ber_dec.h>
#include <botan/der_enc.h>
#include <botan/pem.h>
#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/AuthSys.hpp>
#include <services/system/ProxySys.hpp>

#include <string>
#include <string_view>

using namespace psibase;
using std::optional;
using std::string;
using std::string_view;
using std::tuple;

namespace SystemService
{
   std::vector<unsigned char> parseSubjectPublicKeyInfo(std::string_view s)
   {
      if (s.starts_with("PUB_"))
      {
         auto                       key = publicKeyFromString(s);
         std::vector<unsigned char> result;

         Botan::DER_Encoder encoder(
             [&](const uint8_t* data, std::size_t size)
             {
                auto p = reinterpret_cast<const unsigned char*>(data);
                result.insert(result.end(), p, p + size);
             });
         encoder.start_sequence();
         auto write_ecdsa = [&](Botan::OID group, const auto& keydata)
         {
            auto ecdsa = Botan::OID{1, 2, 840, 10045, 2, 1};
            encoder.start_sequence();
            encoder.encode(ecdsa);
            encoder.encode(group);
            encoder.end_cons();
            encoder.encode(keydata.data(), keydata.size(), Botan::ASN1_Type::BitString);
         };
         if (auto* k1 = std::get_if<0>(&key.data))
         {
            write_ecdsa(Botan::OID{1, 3, 132, 0, 10}, *k1);
         }
         else if (auto* r1 = std::get_if<1>(&key.data))
         {
            write_ecdsa(Botan::OID{1, 2, 840, 10045, 3, 1, 7}, *r1);
         }
         else
         {
            psibase::abortMessage("??? Wrong public key variant");
         }
         encoder.end_cons();
         return result;
      }
      else if (s.starts_with("-----BEGIN"))
      {
         Botan::AlgorithmIdentifier algorithm;
         std::vector<std::uint8_t>  key;
         auto                       ber = Botan::PEM_Code::decode_check_label(s, "PUBLIC KEY");
         Botan::BER_Decoder(ber)
             .start_sequence()
             .decode(algorithm)
             .decode(key, Botan::ASN1_Type::BitString)
             .end_cons();
         return std::vector<unsigned char>(ber.begin(), ber.end());
      }
      else
      {
         psibase::abortMessage("Expected public key");
      }
   }

   std::string to_string(const SubjectPublicKeyInfo& key)
   {
      return Botan::PEM_Code::encode(reinterpret_cast<const std::uint8_t*>(key.data.data()),
                                     key.data.size(), "PUBLIC KEY");
   }

   struct AuthQuery
   {
      auto accWithKey(SubjectPublicKeyInfo    key,
                      optional<AccountNumber> gt,
                      optional<AccountNumber> ge,
                      optional<AccountNumber> lt,
                      optional<AccountNumber> le,
                      optional<uint32_t>      first,
                      optional<uint32_t>      last,
                      optional<string>        before,
                      optional<string>        after) const
      {
         auto idx =
             AuthSys::Tables{AuthSys::service}.open<AuthSys::AuthTable>().getIndex<1>().subindex(
                 key);

         auto convert = [](const auto& opt)
         {
            optional<tuple<AccountNumber>> ret;
            if (opt)
               ret.emplace(std::make_tuple(opt.value()));
            return ret;
         };

         return makeConnection<Connection<AuthRecord, "AuthConnection", "AuthEdge">>(
             idx, {convert(gt)}, {convert(ge)}, {convert(lt)}, {convert(le)}, first, last, before,
             after);
      }

      auto account(AccountNumber name) const
      {
         AuthSys::Tables db{AuthSys::service};
         auto            account = db.open<AuthSys::AuthTable>().get(name);

         return account;
      }
   };
   PSIO_REFLECT(AuthQuery,
                method(accWithKey, key, gt, ge, lt, le, first, last, before, after),
                method(account, name)
                //
   );

   std::optional<HttpReply> RAuthSys::serveSys(HttpRequest request)
   {
      if (auto result = serveContent(request, Tables{getReceiver()}))
         return result;

      if (auto result = serveGraphQL(request, AuthQuery{}))
         return result;

      if (auto result = serveSimpleUI<AuthSys, true>(request))
         return result;

      return std::nullopt;

   }  // serveSys

   void RAuthSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      check(getSender() == getReceiver(), "wrong sender");
      storeContent(std::move(path), std::move(contentType), std::move(content),
                   Tables{getReceiver()});
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::RAuthSys)
