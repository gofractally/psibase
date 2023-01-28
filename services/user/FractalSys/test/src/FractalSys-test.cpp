#define CATCH_CONFIG_MAIN
#include <psibase/DefaultTestChain.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/FractalSys.hpp>

using namespace psibase;
using namespace UserService;
using namespace UserService::Errors;
using namespace UserService::Fractal;

SCENARIO("Creating a fractal")
{
   GIVEN("Default chain setup")
   {
      THEN("Alice can create a fractal") {}
      WHEN("Alice creates a fractal")
      {
         THEN("Bob cannot create a fractal with the same name") {}
      }
   }
}

SCENARIO("Inviting people to a fractal")
{
   GIVEN("Alice has a fractal")
   {
      THEN("Alice can invite a user to the fractal") {}
      WHEN("Alice invites a user to the fractal")
      {
         THEN("Bob can join the fractal") {}
         WHEN("Bob joins the fractal")
         {
            THEN("Bob is a member of the fractal") {}
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
         THEN("No one may call the meetingStarted action before the meeting start time is reached")
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
