#include <services/test/CredResThief.hpp>

#include <services/system/AuthDelegate.hpp>
#include <services/system/Credentials.hpp>
#include <services/system/RAuthSig.hpp>
#include <services/system/VerifySig.hpp>
#include <services/user/Tokens.hpp>

using namespace psibase;
using namespace SystemService;
using namespace TestService;
using namespace UserService;
using SystemService::AuthSig::RAuthSig;
using SystemService::AuthSig::SubjectPublicKeyInfo;

struct KeyData
{
   std::optional<SystemService::AuthSig::AuthRecord> account;
   PSIO_REFLECT(KeyData, account)
};

struct KeyReply
{
   KeyData data;
   PSIO_REFLECT(KeyReply, data)
};

void CredResThief::create()
{
   auto owner = getSender();
   auto query = std::format(R"(query {{ account(name: "{}") {{ account pubkey }} }})", owner.str());
   auto reply = to<RAuthSig>()
                    .serveSys(HttpRequest{
                        .host        = "auth-sig.psibase.localhost:8080",
                        .method      = "POST",
                        .target      = "/graphql",
                        .contentType = "application/graphql",
                        .body        = std::vector(query.begin(), query.end()),
                    })
                    .value();
   auto ownerAccount =
       psio::convert_from_json<KeyReply>(std::string(reply.body.begin(), reply.body.end()))
           .data.account;
   check(ownerAccount.has_value(), "Could not find owner key");
   auto id = to<Credentials>().issue(keyFingerprint(ownerAccount->pubkey), std::nullopt,
                                     std::vector{MethodNumber{"bill"}});
   open<CredIdTable>().put({owner, id});
}

void CredResThief::buyRes(Quantity amount)
{
   auto sender = getSender();
   auto id     = open<CredIdTable>().get(sender).value().id;
   auto sys    = to<Tokens>().getSysToken().value().id;

   to<Tokens>().debit(sys, sender, amount, "");
   to<Tokens>().credit(sys, Credentials::service, amount, "");
   to<Credentials>().resource(id, amount);
}

void CredResThief::bill(SubjectPublicKeyInfo key, ServiceMethod method)
{
   to<Credentials>().checkAuthSys(
       AuthInterface::firstAuthFlag, Credentials::CREDENTIAL_SENDER, method,
       std::vector{Claim{VerifySig::service, {key.data.begin(), key.data.end()}}});
}

void CredResThief::useDisk(std::uint32_t n)
{
   open<BigDataTable>().put({.owner = getSender(), .data = std::vector<char>(n)});
}

PSIBASE_DISPATCH(CredResThief)
