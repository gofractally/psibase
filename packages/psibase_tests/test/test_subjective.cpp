#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/SetCode.hpp>
#include <services/test/SubjectiveDb.hpp>
#include <services/test/XSudo.hpp>

using namespace psibase;
using namespace psio;
using namespace SystemService;
using namespace TestService;

template <typename T>
struct Catch::StringMaker<std::optional<T>>
{
   static std::string convert(const std::optional<T>& value)
   {
      if (value)
      {
         return Catch::StringMaker<T>::convert(*value);
      }
      else
      {
         return "nullopt";
      }
   }
};

TEST_CASE("subjective db")
{
   DefaultTestChain t;
   t.addService(SubjectiveDb::service, "SubjectiveDb.wasm");
   t.from(SetCode::service)
       .to<SetCode>()
       .setFlags(SubjectiveDb::service, SubjectiveDb::serviceFlags);
   t.from(SubjectiveDb::service).to<HttpServer>().registerServer(SubjectiveDb::service);
   auto subjective = t.from(SubjectiveDb::service).to<SubjectiveDb>();

   CHECK(subjective.write("a", "b").succeeded());
   CHECK(subjective.read("a").returnVal() == std::optional{std::string("b")});

   for (int i = 0; i < 3; ++i)
   {
      subjective.abort("a", "WRONG", i);
      CHECK(subjective.read("a").returnVal() == std::optional{std::string("b")});
   }

   CHECK(subjective.nested("n", "1", "2").succeeded());
   CHECK(subjective.read("n").returnVal() == std::optional{std::string("1")});

   for (bool b : {false, true})
   {
      for (int i = 0; i < 4; ++i)
      {
         CHECK(subjective.testRFail1("a", b, i).failed(
             "subjectiveCheckout is required to access the subjective database"));
      }
   }
   for (int i = 0; i < 4; ++i)
   {
      CHECK(subjective.testRFail2(AccountNumber{"alice"}, "a", i)
                .failed("key prefix must match service"));
   }
   CHECK(subjective.testWFail1("a", "b").failed(
       "subjectiveCheckout is required to access the subjective database"));

   for (bool b : {false, true})
   {
      CHECK(subjective.nestFail1a(b).failed("requires checkoutSubjective"));
      CHECK(subjective.nestFail2a(b).failed("requires checkoutSubjective"));
      for (bool b2 : {false, true})
      {
         CHECK(subjective.nestFail3a(b, b2).failed("requires checkoutSubjective"));
      }
   }

   t.post(SubjectiveDb::service, "/write", SubjectiveRow{"c", "d"});
   CHECK(t.post<std::optional<std::string>>(SubjectiveDb::service, "/read", "c") ==
         std::optional{std::string("d")});
}

void addLocalService(TestChain&       t,
                     AccountNumber    account,
                     std::string_view filename,
                     std::uint64_t    flags)
{
   auto          code = readWholeFile(filename);
   auto          hash = sha256(code.data(), code.size());
   CodeByHashRow codeByHashRow{hash, 0, 0, {code.begin(), code.end()}};
   CodeRow       codeRow{account, flags, hash, 0, 0};
   PSIBASE_SUBJECTIVE_TX
   {
      t.kvPut(DbId::nativeSubjective, codeByHashRow.key(), codeByHashRow);
      t.kvPut(DbId::nativeSubjective, codeRow.key(), codeRow);
   }
}

TEST_CASE("local service sudo")
{
   DefaultTestChain t;
   auto             callee = AccountNumber{"callee"};
   t.addService(callee, "Nop.wasm", CodeRow::isSubjective);
   t.startBlock();
   // sanity check
   expect(t.pushTransaction(t.makeTransaction({Action{.sender = callee, .service = callee}})));

   addLocalService(t, AccountNumber{"callee"}, "Nop.wasm", 0);
   t.startBlock();
   expect(t.pushTransaction(t.makeTransaction({Action{.sender = callee, .service = callee}})),
          "Cannot substitute");

   auto sudo = AccountNumber{"sudo"};
   t.addService(sudo, "XSudo.wasm", XSudo::flags);
   t.from(sudo).to<HttpServer>().registerServer(sudo);
   t.startBlock();
   {
      auto reply = t.post(sudo, "/", FracPackBody{Action{.sender = callee, .service = callee}});
      CHECK((int)reply.status == 500);
      CHECK_THAT(std::string(reply.body.data(), reply.body.size()),
                 Catch::Matchers::ContainsSubstring("cannot sudo"));
   }

   t.addAccount(XSudo::service);
   t.from(XSudo::service).to<HttpServer>().registerServer(XSudo::service);
   addLocalService(t, XSudo::service, "XSudo.wasm", XSudo::flags);
   {
      auto reply =
          t.post(XSudo::service, "/", FracPackBody{Action{.sender = callee, .service = callee}});
      CHECK((int)reply.status == 200);
   }
}
