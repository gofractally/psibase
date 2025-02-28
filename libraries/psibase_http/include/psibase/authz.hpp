#pragma once

#include <psibase/jwt.hpp>

#include <boost/asio/ip/address.hpp>
#include <cstdint>
#include <string>
#include <string_view>
#include <variant>

namespace psibase::http
{
   struct token_data
   {
      std::uint64_t exp;
      std::string   mode;  // "r", "rw"
   };
   PSIO_REFLECT(token_data, exp, mode);
   struct token_key
   {
     public:
      token_key(std::string_view k) : impl(k)
      {
         for (auto ch : k)
         {
            psibase::check(ch != '\r' && ch != '\n', "Unexpected newline in key");
         }
      }
      operator std::string_view() const { return impl; }
      operator std::span<const char>() const { return impl; }
      const char* data() const { return impl.data(); }
      int         size() const { return static_cast<int>(impl.size()); }
      std::string str() const { return impl; }

     private:
      std::string impl;
   };

   struct token_response
   {
      std::string   accessToken;
      std::uint64_t exp;
      std::string   mode;
   };
   PSIO_REFLECT(token_response, accessToken, exp, mode)

   struct authz_any
   {
      authz_any() = default;
      authz_any(std::string_view s) { psibase::check(s.empty(), "Unexpected argument for any"); }
      std::string str() const { return "any"; }
   };
   void to_json_impl(const authz_any&, auto& stream)
   {
      to_json("kind", stream);
      stream.write(':');
      to_json("any", stream);
   }
   struct authz_loopback
   {
      std::string str() const { return "loopback"; }
   };
   void to_json_impl(const authz_loopback&, auto& stream)
   {
      to_json("kind", stream);
      stream.write(':');
      to_json("loopback", stream);
   }
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
   void to_json_impl(const authz_ip& obj, auto& stream)
   {
      to_json("kind", stream);
      stream.write(':');
      to_json("ip", stream);
      stream.write(',');
      to_json("address", stream);
      stream.write(':');
      to_json(obj.address.to_string(), stream);
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
   void to_json_impl(const authz_bearer& obj, auto& stream)
   {
      to_json("kind", stream);
      stream.write(':');
      to_json("bearer", stream);
      stream.write(',');
      to_json("key", stream);
      stream.write(':');
      to_json(obj.key.str(), stream);
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
         std::string result = mode_to_string(mode);
         result += ":";
         result += std::visit([](const auto& d) { return d.str(); }, data);
         return result;
      }
      static std::string mode_to_string(mode_type m)
      {
         std::string result;
         if (m & read)
         {
            result += 'r';
         }
         if (m & write)
         {
            result += 'w';
         }
         return result;
      }
      static mode_type mode_from_string(std::string_view s)
      {
         mode_type result = none;
         for (auto ch : s)
         {
            switch (ch)
            {
               case 'r':
                  result = static_cast<mode_type>(result | read);
                  break;
               case 'w':
                  result = static_cast<mode_type>(result | write);
                  break;
               default:
                  throw std::runtime_error("Invalid mode");
            }
         }
         return result;
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
   void to_json(const authz& obj, auto& stream)
   {
      stream.write('{');
      to_json("mode", stream);
      stream.write(':');
      to_json(authz::mode_to_string(obj.mode), stream);
      stream.write(',');
      std::visit([&](auto& d) { to_json_impl(d, stream); }, obj.data);
      stream.write('}');
   }
   struct any_authz
   {
      std::string                mode;
      std::string                kind;
      std::optional<std::string> address;
      std::optional<std::string> key;
   };
   PSIO_REFLECT(any_authz, mode, kind, address, key);
   inline void from_json(authz& obj, auto& stream)
   {
      any_authz tmp;
      from_json(tmp, stream);
      obj.mode = authz::mode_from_string(tmp.mode);
      if (tmp.kind == "any")
      {
         obj.data = authz_any{};
      }
      else if (tmp.kind == "loopback")
      {
         obj.data = authz_loopback{};
      }
      else if (tmp.kind == "ip")
      {
         check(!!tmp.address, "Missing address");
         obj.data = authz_ip{boost::asio::ip::make_address(*tmp.address)};
      }
      else if (tmp.kind == "bearer")
      {
         check(!!tmp.key, "Missing key");
         obj.data = authz_bearer{token_key(*tmp.key)};
      }
      else
      {
         throw std::runtime_error("Unknown authorization type");
      }
   }
}  // namespace psibase::http
