#pragma once

#include <string_view>

namespace UserService
{
   namespace Errors
   {
      constexpr std::string_view inviteDNE        = "Invite does not exist";
      constexpr std::string_view needUniquePubkey = "Cannot use invite key as account key";
      constexpr std::string_view unauthDelete     = "Only the inviter can delete an invite";
      constexpr std::string_view secretDNE        = "Secret does not exist";
      constexpr std::string_view mustUseInviteCredential =
          "To create a new account, you must accept the invite using the invite credential";
      constexpr std::string_view noActiveCredential       = "No active credential";
      constexpr std::string_view canOnlyCallCreateAccount = "can only call createAccount";
      constexpr std::string_view outOfNewAccounts = "Invite cannot be used to create more accounts";
      constexpr std::string_view inviteHooksRequired =
          "To enable hooks, the invite creator must be a service that implements the 'InviteHooks' "
          "interface";
   }  // namespace Errors
}  // namespace UserService
