#define CATCH_CONFIG_MAIN
#include <psibase/DefaultTestChain.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/CoreFractal.hpp>
#include <services/user/Fractal.hpp>
#include <services/user/Invite.hpp>
//#include <services/user/

using namespace psibase;
using namespace UserService;
using namespace UserService::Errors;
using namespace UserService::FractalNs;
using namespace SystemService::AuthSig;

namespace
{
   SubjectPublicKeyInfo invPub{
       parseSubjectPublicKeyInfo("-----BEGIN PUBLIC KEY-----\n"
                                 "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEuq/4/cEGTAZ8V3+i4Zxz0QfR2RGM"
                                 "\nJDlUzFnWFApcZiNxKRPmkuf75ReZuHlMIsY8KYl4ofsclgXYX6bA6jseqg==\n"
                                 "-----END PUBLIC KEY-----\n")};
   PrivateKeyInfo invPriv{
       parsePrivateKeyInfo("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgPg6NiBwqfaR+62Dg"
                           "\nlo4SJYDN63VgN5KsJ+ShifkhUS2hRANCAAS6r/j9wQZMBnxXf6LhnHPRB9HZEY"
                           "wk\nOVTMWdYUClxmI3EpE+aS5/vlF5m4eUwixjwpiXih+xyWBdhfpsDqOx6q\n"
                           "-----END PRIVATE KEY-----\n")};
   SubjectPublicKeyInfo userPub{
       parseSubjectPublicKeyInfo("-----BEGIN PUBLIC KEY-----\n"
                                 "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkyH2C34UK39YQuYiKPU7oUG92hdo"
                                 "\nM/oj7dx2ZxVLoHgb7J2S4RVTAlsxlFnDnm1tQLglLm7EU+VfeDTXF0UOnQ==\n"
                                 "-----END PUBLIC KEY-----\n")};
   PrivateKeyInfo userPriv{
       parsePrivateKeyInfo("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSDWviYxkk0ZXecnn"
                           "\nm8yWW94bvDE3rqRHNJulM4nH6cehRANCAASTIfYLfhQrf1hC5iIo9TuhQb3aF2"
                           "gz\n+iPt3HZnFUugeBvsnZLhFVMCWzGUWcOebW1AuCUubsRT5V94NNcXRQ6d\n"
                           "-----END PRIVATE KEY-----\n")};
}  // namespace

SCENARIO("Creating a fractal")
{
   GIVEN("Default chain setup")
   {
      DefaultTestChain t;

      auto alice          = t.from(t.addAccount("alice"_a));
      auto fractalService = t.from(Fractal::service);
      auto coreFrac       = t.from(CoreFractal::service);
      auto a              = alice.to<Fractal>();

      THEN("Alice can create a fractal identity")
      {
         auto createIdentity = a.createIdentity();
         REQUIRE(createIdentity.succeeded());
      }
      THEN("Alice can create a fractal")
      {
         a.createIdentity();
         auto createFractal = a.newFractal("astronauts"_a, CoreFractal::service);
         CHECK(createFractal.succeeded());
      }
      WHEN("Alice creates a fractal")
      {
         a.createIdentity();
         a.newFractal("astronauts"_a, CoreFractal::service);

         THEN("Bob cannot create a fractal with the same name")
         {
            auto bob = t.from(t.addAccount("bob"_a));
            auto b   = bob.to<Fractal>();
            b.createIdentity();

            auto newFrac = b.newFractal("astronauts"_a, CoreFractal::service);
            CHECK(newFrac.failed("already exists"));
         }
      }
   }
}
