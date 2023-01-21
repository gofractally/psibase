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
      constexpr std::string_view acceptOwnInvite = "You can only accept your own invite!";
      constexpr std::string_view invalidAccepter = "This account cannot be used to accept invites";
      constexpr std::string_view accepterDNE     = "Accepter account DNE";
      constexpr std::string_view alreadyAccepted = "This invite was already accepted";
      constexpr std::string_view alreadyRejected = "This invite was already rejected";
      constexpr std::string_view mustUseInvitedSys = "You must send this action as: invited-sys";
      constexpr std::string_view onlyWhitelisted = "Only whitelisted accounts can create invites";
      constexpr std::string_view noBlacklisted = "Blacklisted accounts cannot create invites";
      constexpr std::string_view whitelistIsSet = "Cannot modify blacklist while whitelist is set";

      // AuthInviteSys
      constexpr std::string_view restrictedService =
          "invited-sys can only be used to call actions in InviteSys";
      constexpr std::string_view restrictedActions = "invited-sys may only call specific actions.";
      constexpr std::string_view notWhitelisted    = "Account not whitelisted by InviteAuthSys";
      constexpr std::string_view missingInviteSig =
          "Transaction does not include the invite key in its claims.";
   }  // namespace Errors
}  // namespace UserService
