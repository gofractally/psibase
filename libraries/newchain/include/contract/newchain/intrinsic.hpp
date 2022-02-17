#pragma once

#include <stdint.h>

namespace newchain
{
   // These use mangled names instead of extern "C" to prevent collisions
   // with other libraries. e.g. libc++'s abort_message
   namespace intrinsic
   {
      // Intrinsics which return data do it by storing it in a result buffer.
      // get_result copies min(dest_size, result_size) bytes into dest and returns result_size.
      [[clang::import_name("get_result")]] uint32_t get_result(const char* dest,
                                                               uint32_t    dest_size);

      // Write message to console. Message should be UTF8.
      [[clang::import_name("write_console")]] void write_console(const char* message, uint32_t len);

      // Abort with message. Message should be UTF8.
      [[clang::import_name("abort_message"), noreturn]] void abort_message(const char* message,
                                                                           uint32_t    len);

      // Store the currently-executing action into result and return the result size.
      //
      // If the contract, while handling action A, calls itself with action B:
      //    * Before the call to B, get_current_action() returns A.
      //    * After the call to B, get_current_action() returns B.
      //    * After B returns, get_current_action() returns A.
      //
      // Note: The above only applies if the contract uses the call() intrinsic.
      //       The call() function and the action wrappers use the call() intrinsic.
      //       Calling a contract member function directly does NOT use the call() intrinsic.
      [[clang::import_name("get_current_action")]] uint32_t get_current_action();

      // Call a contract, store the return value into result, and return the result size.
      [[clang::import_name("call")]] uint32_t call(const char* action, uint32_t len);
   }  // namespace intrinsic
}  // namespace newchain
