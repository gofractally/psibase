#pragma once

namespace psio1
{
   template <typename F>
   struct finally
   {
      F f;
      ~finally() { f(); }
   };

   template <typename F>
   finally(F) -> finally<F>;
}  // namespace psio1
