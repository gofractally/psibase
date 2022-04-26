#pragma once

namespace psio
{
   template <typename F>
   struct finally
   {
      F f;
      ~finally() { f(); }
   };

   template <typename F>
   finally(F) -> finally<F>;
}  // namespace psio
