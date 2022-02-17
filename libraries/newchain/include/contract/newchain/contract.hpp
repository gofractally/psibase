#pragma once

#include <newchain/block.hpp>
#include <newchain/intrinsic.hpp>

namespace newchain
{
   // Get result when size is known. Caution: this does not verify size.
   std::vector<char> get_result(uint32_t size);

   // Get result when size is unknown
   std::vector<char> get_result();

   // Abort with message. Message should be UTF8.
   [[noreturn]] inline void abort_message(std::string_view msg)
   {
      intrinsic::abort_message(msg.data(), msg.size());
   }

   // Abort with message if !cond. Message should be UTF8.
   inline void check(bool cond, std::string_view message)
   {
      if (!cond)
         abort_message(message);
   }

   // Get the currently-executing action.
   //
   // If the contract, while handling action A, calls itself with action B:
   //    * Before the call to B, get_current_action() returns A.
   //    * After the call to B, get_current_action() returns B.
   //    * After B returns, get_current_action() returns A.
   //
   // Note: The above only applies if the contract uses the call() intrinsic.
   //       The call() function and the action wrappers use the call() intrinsic.
   //       Calling a contract member function directly does NOT use the call() intrinsic.
   action get_current_action();

   std::vector<char> call(const action& action);
}  // namespace newchain
