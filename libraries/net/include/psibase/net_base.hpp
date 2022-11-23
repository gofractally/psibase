#pragma once

#include <psibase/AccountNumber.hpp>

namespace psibase::net
{
   using producer_id                          = AccountNumber;
   using peer_id                              = int;
   static constexpr producer_id null_producer = {};
   // TODO: Make this a public key and validate it
   // which requires binding it to the TLS session, which we don't have
   // access to because we're behind a proxy...
   using NodeId = std::uint64_t;
}  // namespace psibase::net
