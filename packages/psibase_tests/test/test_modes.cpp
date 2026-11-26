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

   // NoteRow as an older version of the service had it: no text yet
   struct OldNote
   {
      std::uint32_t id;
   };
   PSIO_REFLECT(OldNote, id)

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
   // The action builders (the tester here, transactor, Actor) pack with the
   // fast write too: the same refusal, from the dispatcher.
   CHECK(svc.declared(tooLong).failed(refused));
   CHECK(svc.declared(notUtf8).failed(refused));
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

// What "its own table" rests on: a service that is not privileged reaches a
// database only through the db service, which lets it write under its own
// account and no other; the node itself opens a database for a privileged
// service only.
TEST_CASE("two modes: only the service writes under its own account")
{
   DefaultTestChain t;
   t.addService(TestModes::service, "TestModes.wasm");
   const auto other = AccountNumber{"test-mds2"};
   t.addService(other, "TestModes.wasm");
   auto svc = t.from(TestModes::service).to<TestModes>();

   CHECK(svc.writeOther(TestModes::service, 0).succeeded());
   CHECK(svc.writeOther(TestModes::service, 1).succeeded());
   CHECK(svc.writeOther(other, 0).failed("cannot write to another service's prefix"));
   CHECK(svc.writeOther(other, 1).failed("cannot write to another service's prefix"));
   CHECK(svc.openDirect(other).failed("service may not open databases"));
   CHECK(svc.openDirect(TestModes::service).failed("service may not open databases"));
}

// A trusted read holds nothing against what the row's type declares, but it
// stays inside the row: bytes that are not a frame of the type (what a wrong
// change of the type would leave in the table) end the action that reads
// them, through the decode (Table::get) and through a view (Table::getView),
// each with its message (gofractally/psio#15).
TEST_CASE("two modes: an own row that is not a frame of its type ends the action")
{
   DefaultTestChain t;
   t.addService(TestModes::service, "TestModes.wasm");
   auto svc = t.from(TestModes::service).to<TestModes>();

   const std::string_view view = "view: the bytes are not a frame of the type: ";
   auto viewFails = [&](std::uint32_t id, std::string_view why)
   { return svc.viewLength(id).failed(std::string(view) + std::string(why)); };

   // header (size of the fixed part), id, offset of the text, text
   const auto row = psio::to_pssz(NoteRow{7, "abcdefgh"});
   REQUIRE(row.size() == 14);
   REQUIRE(svc.storeBytes(7, row).succeeded());
   CHECK(svc.length(7).returnVal() == 8);
   CHECK(svc.viewLength(7).returnVal() == 8);

   // Cut inside the fixed part
   REQUIRE(svc.storeBytes(8, std::vector<char>(row.begin(), row.begin() + 3)).succeeded());
   CHECK(svc.length(8).failed("pssz: record fixed region truncated"));
   CHECK(viewFails(8, "a record's header announces more than the record holds"));
   CHECK(!svc.valid(8).returnVal());
   // No bytes at all
   REQUIRE(svc.storeBytes(9, std::vector<char>{}).succeeded());
   CHECK(svc.length(9).failed("pssz: record header truncated"));
   // The offset of the text points past the end of the row
   auto past = row;
   past[5]   = static_cast<char>(200);
   REQUIRE(svc.storeBytes(10, past).succeeded());
   CHECK(svc.length(10).failed("pssz: invalid record payload offset"));
   CHECK(viewFails(10, "the offsets of a record member are out of order or out of range"));
   // The header claims a fixed part larger than the row
   auto header = row;
   header[0]   = static_cast<char>(200);
   REQUIRE(svc.storeBytes(11, header).succeeded());
   CHECK(svc.length(11).failed("pssz: record fixed region truncated"));
   CHECK(viewFails(11, "a record's header announces more than the record holds"));
   // A row of an older layout of the type, from before it had its text
   REQUIRE(svc.storeBytes(12, psio::to_pssz(OldNote{12})).succeeded());
   CHECK(svc.length(12).failed("pssz: required record field missing"));
   CHECK(viewFails(12, "a record's header omits a required member"));

   // A list whose count is corrupted. The count of a list of strings is its
   // first offset (the size of the offset table): one byte makes it claim
   // more elements than the row holds.
   const auto tags = psio::to_pssz(TagsRow{7, {"ab", "cde"}});
   REQUIRE(tags.size() == 25);
   REQUIRE(svc.storeTagBytes(7, tags).succeeded());
   CHECK(svc.tagCount(7).returnVal() == 2);
   CHECK(svc.viewTagCount(7).returnVal() == 2);
   auto count = tags;
   count[12]  = static_cast<char>(0xff);
   REQUIRE(svc.storeTagBytes(8, count).succeeded());
   CHECK(svc.tagCount(8).failed("pssz: offset table past the end of the list"));
   CHECK(svc.viewTagCount(8).failed(std::string(view) +
                                    "the offset table of a list is cut short"));
   count     = tags;
   count[15] = static_cast<char>(0x7f);
   REQUIRE(svc.storeTagBytes(9, count).succeeded());
   CHECK(svc.tagCount(9).failed("pssz: offset table past the end of the list"));
   CHECK(svc.viewTagCount(9).failed(std::string(view) +
                                    "the offset table of a list is cut short"));
}
