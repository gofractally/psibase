#pragma once

#include <psibase/jwt.hpp>

#include <boost/asio/ip/address.hpp>
#include <string_view>
#include <variant>

namespace psibase::http
{
   struct authz_any
   {
      authz_any(std::string_view s) { psibase::check(s.empty(), "Unexpected argument for any"); }
      std::string str() const { return "any"; }
   };
   struct authz_loopback
   {
      std::string str() const { return "loopback"; }
   };
   inline authz_loopback authz_loopback_from_string(std::string_view s)
   {
      psibase::check(s.empty(), "Unexpected argument for loopback");
      return {};
   }
   struct authz_ip
   {
      // TODO: should use a subnet mask
      boost::asio::ip::address address;
      std::string              str() const { return "ip:" + address.to_string(); }
   };
   inline authz_ip authz_ip_from_string(std::string_view s)
   {
      return authz_ip{boost::asio::ip::make_address(s)};
   }
   struct authz_bearer
   {
      token_key   key;
      std::string str() const { return "bearer:" + key.str(); }
   };
   inline authz_bearer authz_bearer_from_string(std::string_view s)
   {
      return authz_bearer{token_key{s}};
   }
   struct authz
   {
      enum mode_type
      {
         none,
         read       = 1,
         write      = 2,
         read_write = 3
      };
      mode_type                                                       mode;
      std::variant<authz_any, authz_loopback, authz_ip, authz_bearer> data;
      std::string                                                     str() const
      {
         std::string result = mode == read ? "r" : "rw";
         result += ":";
         result += std::visit([](const auto& d) { return d.str(); }, data);
         return result;
      }
      static mode_type mode_from_string(std::string_view s)
      {
         if (s == "r")
         {
            return authz::read;
         }
         else if (s == "rw")
         {
            return authz::read_write;
         }
         else
         {
            throw std::runtime_error("Invalid mode");
         }
      }
   };
   inline authz authz_from_string(std::string_view s)
   {
      auto mode_end = s.find(":");
      if (mode_end == std::string::npos)
         throw std::runtime_error("Bad authorization");
      authz::mode_type mode     = authz::mode_from_string(s.substr(0, mode_end));
      auto             kind_end = s.find(':', mode_end + 1);
      auto             kind     = s.substr(mode_end + 1, kind_end - mode_end - 1);
      auto params = kind_end == std::string::npos ? std::string_view() : s.substr(kind_end + 1);
      if (kind == "any")
      {
         return {mode, authz_any(params)};
      }
      else if (kind == "loopback")
      {
         return {mode, authz_loopback_from_string(params)};
      }
      else if (kind == "ip")
      {
         return {mode, authz_ip_from_string(params)};
      }
      else if (kind == "bearer")
      {
         return {mode, authz_bearer_from_string(params)};
      }
      else
      {
         throw std::runtime_error("Unknown authorization type");
      }
   }
}  // namespace psibase::http
