#include <services/local/XKeys.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/fileUtil.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/Spki.hpp>
#include <services/user/Nop.hpp>
#include "XKeysCaller.hpp"

using namespace psibase;
using namespace LocalService;
using namespace TestService;
using namespace SystemService::AuthSig;
using namespace UserService;

struct WasmFileBody
{
   std::string       contentType() const { return "application/wasm"; }
   std::vector<char> body() const { return readWholeFile(filename); }
   std::string       filename;
};

struct SpkiBody
{
   static std::string contentType() { return "text/plain"; }
   static SpkiBody    unpack(std::vector<char>&& data)
   {
      return {{parseSubjectPublicKeyInfo(std::string_view{data.data(), data.size()})}};
   }
   SubjectPublicKeyInfo value;
};

TEST_CASE("create account and sign")
{
   DefaultTestChain t;
   auto             alice = AccountNumber{"alice123"};

   t.put(XAdmin::service, "/services/" + XKeysCaller::service.str(),
         WasmFileBody{"XKeysCaller.wasm"});
   t.post(XHttp::service, "/register_server",
          JsonBody{RegisteredServiceRow{XKeysCaller::service, XKeysCaller::service}});

   auto key = t.post<SpkiBody>(XKeysCaller::service, "/new", EmptyBody{}).value;
   REQUIRE(t.to<AuthSig>().newAccount(alice, key).succeeded());

   // The service uses wall-clock time to set the expiration, so
   // we need to sync the chain's time.
   t.startBlock(
       std::chrono::time_point_cast<BlockTime::duration>(std::chrono::system_clock::now()));

   auto tx = t.post<FracPackBody<SignedTransaction>>(
                  XKeysCaller::service, "/sign",
                  JsonBody{std::vector{Action{
                      .sender = alice, .service = Nop::service, .method = MethodNumber{"nop"}}}})
                 .value;

   expect(t.pushTransaction(tx));
}
