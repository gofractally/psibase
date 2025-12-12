#pragma once

#include <optional>
#include <psibase/schema.hpp>
#include <string>

namespace psibase
{
   std::optional<std::string> findDifference(const ServiceSchema& lhs, const ServiceSchema& rhs);
   std::optional<std::string> findDifference(const ServiceSchema& schema);

#define CHECK_SCHEMA(SERVICE)                                                          \
   do                                                                                  \
   {                                                                                   \
      auto err = ::psibase::findDifference(::psibase::ServiceSchema::make<SERVICE>()); \
      if (err)                                                                         \
         UNSCOPED_INFO(*err);                                                          \
      CHECK(!err);                                                                     \
   } while (0)

}  // namespace psibase
