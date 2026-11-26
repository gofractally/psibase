#include <services/test/TestModes.hpp>

#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/system/HttpServer.hpp>

#include <string>
#include <string_view>
#include <tuple>

using namespace psibase;
using namespace SystemService;
using namespace TestService;

namespace
{
   // NoteRow without its declaration: what a writer that does not know the
   // bound puts in a JSON body.
   struct LooseNote
   {
      std::uint32_t id;
      std::string   text;
   };
   PSIO_REFLECT(LooseNote, id, text)

   const std::string fits    = "12345678";
   const std::string tooLong = "123456789";
   const std::string notUtf8 = "ab\xff";
}  // namespace

// The ordinary PSIO write checks nothing a type declares and a trusted read
// checks nothing either (gofractally/psio#14), so each boundary states its
// mode (gofractally/psibase#2281).
TEST_CASE("two modes: an action argument outside its declaration is refused at dispatch")
{
   DefaultTestChain t;
   t.addService(TestModes::service, "TestModes.wasm");
   auto svc = t.from(TestModes::service).to<TestModes>();

   CHECK(svc.declared(fits).returnVal() == 8);

   // The ordinary write packs an argument list whatever it holds (the fast
   // write): the transaction reaches the service, and its dispatcher refuses
   // the arguments before the action runs.
   using Args = psio::reflect<TestModes>::method_arg_tuple<0>;
   auto push  = [&](std::vector<char> args)
   {
      return TraceResult{t.pushTransaction(t.makeTransaction({Action{
          TestModes::service, TestModes::service, MethodNumber{"declared"}, std::move(args)}}))};
   };
   const std::string_view refused = "invalid argument encoding for declared";
   CHECK(push(psio::to_pssz(Args{"caf\xc3\xa9"})).succeeded());
   CHECK(push(psio::to_pssz(Args{tooLong})).failed(refused));
   CHECK(push(psio::to_pssz(Args{notUtf8})).failed(refused));
   // The validated write of the same values refuses them at the caller.
   std::vector<char> out;
   CHECK(psio::encode_pssz_checked(psio::pssz{}, Args{fits}, out).ok());
   CHECK(!psio::encode_pssz_checked(psio::pssz{}, Args{tooLong}, out).ok());
   CHECK(!psio::encode_pssz_checked(psio::pssz{}, Args{notUtf8}, out).ok());
   // An argument list packed without the declaration (wide offsets) is
   // another encoding, refused as well.
   CHECK(push(psio::to_pssz(std::tuple{notUtf8})).failed(refused));
}

TEST_CASE("two modes: a row of the service's own table is written fast and read trusted")
{
   DefaultTestChain t;
   t.addService(TestModes::service, "TestModes.wasm");
   auto svc = t.from(TestModes::service).to<TestModes>();

   REQUIRE(svc.store(1, fits).succeeded());
   CHECK(svc.length(1).returnVal() == 8);
   CHECK(svc.valid(1).returnVal());

   // Text that is not UTF-8: the row is stored and read back as written.
   // Only a reader that validates sees that it is not a NoteRow.
   REQUIRE(svc.store(2, notUtf8).succeeded());
   CHECK(svc.length(2).returnVal() == 3);
   CHECK(!svc.valid(2).returnVal());

   // Nine bytes under max<8>, the last member of the row: the offsets still
   // fit, so the fast write has a frame for it.
   REQUIRE(svc.store(3, tooLong).succeeded());
   CHECK(svc.length(3).returnVal() == 9);
   CHECK(!svc.valid(3).returnVal());

   // The validated write is asked for by name and refuses both.
   CHECK(svc.storeChecked(4, fits).succeeded());
   CHECK(svc.storeChecked(5, notUtf8).failed("utf8"));
   CHECK(svc.storeChecked(6, tooLong).failed("length_bound"));

   // A test is not the service: it reads the row with validation.
   CHECK(t.kvGet<NoteRow>(DbId::service, std::tuple{TestModes::service, std::uint16_t{0},
                                                     std::uint8_t{0}, std::uint32_t{1}})
             .value()
             .text == fits);
}

TEST_CASE("two modes: an HTTP JSON body outside its declaration is refused")
{
   DefaultTestChain t;
   t.addService(TestModes::service, "TestModes.wasm");
   t.from(TestModes::service).to<HttpServer>().registerServer(TestModes::service);

   auto ok = t.post(TestModes::service, "/note", JsonBody{LooseNote{7, fits}});
   CHECK(static_cast<int>(ok.status) == 200);
   CHECK(std::string(ok.body.begin(), ok.body.end()) == "7");

   auto bad = t.post(TestModes::service, "/note", JsonBody{LooseNote{7, tooLong}});
   CHECK(static_cast<int>(bad.status) != 200);
   CHECK(std::string(bad.body.begin(), bad.body.end()).find("length_bound") != std::string::npos);
}
