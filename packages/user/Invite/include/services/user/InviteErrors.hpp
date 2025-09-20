#pragma once

#include <string_view>

namespace UserService
{
   namespace Errors
   {
      // invite
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
      constexpr std::string_view onlyWhitelisted   = "Only whitelisted accounts can create invites";
      constexpr std::string_view noBlacklisted     = "Blacklisted accounts cannot create invites";
      constexpr std::string_view whitelistIsSet = "Cannot modify blacklist while whitelist is set";
      constexpr std::string_view accAlreadyExists =
          "Account already exists. This should never happen.";
      constexpr std::string_view secretDNE = "Secret does not exist";
      constexpr std::string_view mustUseInviteCredential =
          "To create a new account, you must accept the invite using the invite credential";
      constexpr std::string_view noActiveCredential      = "No active credential";
      constexpr std::string_view canOnlyCallAcceptCreate = "can only call acceptCreate";
   }  // namespace Errors
}  // namespace UserService
