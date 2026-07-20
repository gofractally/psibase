#pragma once

#include <memory>

namespace psibase
{
   struct Socket;
   std::shared_ptr<Socket> makeLogSocket();
}  // namespace psibase
