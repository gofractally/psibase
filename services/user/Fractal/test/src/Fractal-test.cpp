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

SCENARIO("Inviting people to a fractal")
{
   GIVEN("Alice has a fractal")
   {
      DefaultTestChain t;

      auto alice          = t.from(t.addAccount("alice"_a));
      auto bob            = t.from(t.addAccount("bob"_a, userPub));
      auto fractalService = t.from(Fractal::service);
      auto coreFrac       = t.from(CoreFractal::service);
      auto fractal        = "astronauts"_a;

      auto a = alice.to<Fractal>();
      a.createIdentity();
      a.newFractal(fractal, CoreFractal::service);

      THEN("Alice can invite a user to the fractal")
      {
         auto invite = a.invite(fractal, invPub);
         CHECK(invite.succeeded());
      }
      WHEN("Alice invites a user to the fractal")
      {
         a.invite(fractal, invPub);
         KeyList userAndInviteKeys{{userPub, userPriv}, {invPub, invPriv}};
         KeyList userKeys{{userPub, userPriv}};

         THEN("Bob can claim the invite")
         {
            auto acceptInvite = bob.with(userAndInviteKeys).to<InviteNs::Invite>().accept(invPub);
            CHECK(acceptInvite.succeeded());

            auto claim = bob.with(userKeys).to<Fractal>().claim(invPub);
            CHECK(claim.succeeded());
         }
         WHEN("Bob claims the invite")
         {
            bob.with(userAndInviteKeys).to<InviteNs::Invite>().accept(invPub);
            bob.with(userKeys).to<Fractal>().claim(invPub);

            THEN("Bob has a fractal identity")
            {
               auto identity = a.getIdentity(bob).returnVal();
               CHECK(identity.has_value());
               CHECK(identity->name == bob.id);
            }
            THEN("Bob can accept the invite")
            {
               auto accept = bob.with(userKeys).to<Fractal>().accept(invPub);
               CHECK(accept.succeeded());
            }
         }
         WHEN("Bob accepts the invite to a fractal")
         {
            bob.with(userAndInviteKeys).to<InviteNs::Invite>().accept(invPub);

            auto b = bob.with(userKeys).to<Fractal>();
            b.claim(invPub);
            b.accept(invPub);

            THEN("Bob is a member of the fractal")
            {
               auto member = a.getMember(bob, fractal).returnVal();
               CHECK(member.has_value());
               CHECK(member->inviter == alice.id);
            }
            THEN("No one else can join using that invite")
            THEN("The invite no longer exists in invite") {}
         }
      }
      /* Todo */
      /* Invite configurations:
         - founder-only: Only the founder can invite other users
         - limited-depth: Open invites, down to a limited depth away from the founder
         - open: Any member can invite any other member
         - minimum-rank: Invites are open to anyone with sufficient rank
         - ?? Council-only? Whitelist of invite-creators?
      */
      /* Invite cost configurations:
         - minimum: Simply pay for the cost of inviting a new chain user
         - additional: Must pay an additional amount for each invite, to prevent spam
      */
      /* Growth rate restriction
         - New invites cannot be created at a rate that exceeds a configurable percentage of total community growth
         - New invites
      */
   }
}

// Todo - Automatically managing part time vs full time membership
//SCENARIO("Membership"){}

SCENARIO("Leaving a fractal")
{
   GIVEN("Bob joins Alice's fractal")
   {
      THEN("If the fractal is in founder mode")
      {
         AND_THEN("Alice can kick him out")
         {
            AND_THEN("Bob is no longer a member") {}
         }
         AND_THEN("Bob may leave")
         {
            AND_THEN("Bob is no longer a member") {}
         }
      }
      THEN("If the fractal is not in founder mode")
      {
         AND_THEN("Alice cannot kick Bob out")
         {
            AND_THEN("Bob is no longer a member") {}
         }
         AND_THEN("Bob may leave")
         {
            AND_THEN("Bob is no longer a member") {}
         }
      }
   }
   /* Todo */
   /* * When not in founder mode, the council may kick Bob out
   */
}

// Todo:
// SCENARIO("Deleting a fractal") {
// Requires no members?
// }

SCENARIO("Meetings start/end time & registration")
{
   GIVEN("Alice has a fractal in founder mode")
   {
      THEN("Alice can configure the meeting time and frequency") {}
      WHEN("The meeting time is configured")
      {
         THEN("No one may register outside one hour before the scheduled meeting time") {}
         THEN("Anyone may register for a meeting up to 1 hour before the scheduled time") {}
         THEN(
             "No one may call the meetingStarted action before the meeting start time is "
             "reached")
         {
         }
         THEN("Anyone may call the meetingStarted action after the meeting start time is reached")
         {
            AND_THEN("No one else may call the meetingStarted action") {}
         }
         THEN("No one may call the meetingFinished action before the meeting is over") {}
         THEN("Anyone may call the meetingFinished action after the meeting is over") {}
      }
   }
}

// TODO: Meeting group formation

SCENARIO("Ranking submission")
{
   GIVEN("A fractal exists with users registered for a started meeting")
   {
      WHEN("A user submits a ranking")
      {
         THEN("The user may not submit another ranking") {}
         // ...unfinished.
      }
   }
}
