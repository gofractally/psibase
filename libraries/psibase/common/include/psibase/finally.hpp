#pragma once

namespace psibase
{
   /// Runs `f` when the object goes out of scope
   template <typename F>
   struct finally
   {
      F f;
      ~finally() { f(); }
   };

   template <typename F>
   finally(F) -> finally<F>;
}  // namespace psibase
