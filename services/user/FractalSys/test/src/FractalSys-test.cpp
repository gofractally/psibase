#define CATCH_CONFIG_MAIN
#include <psibase/DefaultTestChain.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/CoreFractalSys.hpp>
#include <services/user/FractalSys.hpp>
#include <services/user/InviteSys.hpp>

using namespace psibase;
using namespace UserService;
using namespace UserService::Errors;
using namespace UserService::Fractal;

namespace
{
   auto invPub  = publicKeyFromString("PUB_K1_7jTdMYEaHi66ZEcrh7To9XKingVkRdBuz6abm3meFbGw8zFFve");
   auto invPriv = privateKeyFromString("PVT_K1_ZGRNZ4qwN1Ei9YEyVBr1aBGekAxC5FKVPR3rQA2HnEhvqviF2");

   auto userPub  = publicKeyFromString("PUB_K1_5Dcj42CYrYpPMpCPWPzBSpM9gThV5ywAPdbYgiL2JUxGrnVUbn");
   auto userPriv = privateKeyFromString("PVT_K1_SjmZ1DKTPNZFnfPEPwGb9rt3CAuwAoqYjZf5UoM4Utwm5dJW3");
}  // namespace

SCENARIO("Creating a fractal")
{
   GIVEN("Default chain setup")
   {
      DefaultTestChain t;

      auto alice      = t.from(t.add_account("alice"_a));
      auto fractalSys = t.from(FractalSys::service);
      auto coreFrac   = t.from(CoreFractalSys::service);
      auto a          = alice.to<FractalSys>();

      THEN("Alice can create an identity in fractal-sys")
      {
         auto createIdentity = a.createIdentity();
         REQUIRE(createIdentity.succeeded());
      }
      THEN("Alice can create a fractal")
      {
         a.createIdentity();
         auto createFractal = a.newFractal("astronauts"_a, CoreFractalSys::service);
         CHECK(createFractal.succeeded());
      }
      WHEN("Alice creates a fractal")
      {
         a.createIdentity();
         a.newFractal("astronauts"_a, CoreFractalSys::service);

         THEN("Bob cannot create a fractal with the same name")
         {
            auto bob = t.from(t.add_account("bob"_a));
            auto b   = bob.to<FractalSys>();
            b.createIdentity();

            auto newFrac = b.newFractal("astronauts"_a, CoreFractalSys::service);
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

      auto alice      = t.from(t.add_account("alice"_a));
      auto bob        = t.from(t.add_ec_account("bob"_a, userPub));
      auto fractalSys = t.from(FractalSys::service);
      auto coreFrac   = t.from(CoreFractalSys::service);
      auto fractal    = "astronauts"_a;

      auto a = alice.to<FractalSys>();
      a.createIdentity();
      a.newFractal(fractal, CoreFractalSys::service);

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
            auto acceptInvite = bob.with(userAndInviteKeys).to<Invite::InviteSys>().accept(invPub);
            CHECK(acceptInvite.succeeded());

            auto claim = bob.with(userKeys).to<FractalSys>().claim(invPub);
            CHECK(claim.succeeded());
         }
         WHEN("Bob claims the invite")
         {
            bob.with(userAndInviteKeys).to<Invite::InviteSys>().accept(invPub);
            bob.with(userKeys).to<FractalSys>().claim(invPub);

            THEN("Bob has a fractal-sys identity")
            {
               auto identity = a.getIdentity(bob).returnVal();
               CHECK(identity.has_value());
               CHECK(identity->name == bob.id);
            }
            THEN("Bob can accept the invite")
            {
               auto accept = bob.with(userKeys).to<FractalSys>().accept(invPub);
               CHECK(accept.succeeded());
            }
         }
         WHEN("Bob accepts the invite to a fractal")
         {
            bob.with(userAndInviteKeys).to<Invite::InviteSys>().accept(invPub);

            auto b = bob.with(userKeys).to<FractalSys>();
            b.claim(invPub);
            b.accept(invPub);

            THEN("Bob is a member of the fractal")
            {
               auto member = a.getMember(bob, fractal).returnVal();
               CHECK(member.has_value());
               CHECK(member->inviter == alice.id);
            }
            THEN("No one else can join using that invite")
            THEN("The invite no longer exists in invite-sys") {}
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
