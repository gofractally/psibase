#pragma once

#include <string_view>

namespace UserService
{
   namespace Errors
   {
      // Invite-sys
      constexpr std::string_view inviteAlreadyExists = "Invite already exists";
      constexpr std::string_view inviteDNE           = "Invite does not exist";
      constexpr std::string_view needUniquePubkey    = "Cannot use invite key as account key";
      constexpr std::string_view inviteExpired       = "Invite expired";
      constexpr std::string_view noNewAccToken = "No new accounts may be created with this invite";
      constexpr std::string_view unauthDelete  = "Only the inviter can delete an invite";

      // AuthInviteSys
      constexpr std::string_view onlyOneClaim =
          "invited-sys should only have one claim: the invite key";
      constexpr std::string_view mustUseVerifyEC =
          "invited-sys claim service should be VerifyEcSys";
      constexpr std::string_view restrictedService =
          "invited-sys can only be used to call actions in InviteSys";
      constexpr std::string_view restrictedActions = "invited-sys may only call specific actions.";
      constexpr std::string_view notWhitelisted    = "Account not whitelisted by InviteAuthSys";
   }  // namespace Errors
}  // namespace UserService
