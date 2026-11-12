#pragma once

#include <chrono>
#include <initializer_list>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <psibase/Rpc.hpp>
#include <psibase/crypto.hpp>
#include <psibase/time.hpp>
#include <psio/json/any.hpp>
#include <psio/stream.hpp>
#include <psio/to_json.hpp>

namespace xportal
{
   inline psibase::HttpReply jsonBody(std::vector<psibase::HttpHeader> headers, const auto& value)
   {
      psibase::HttpReply  reply{.contentType = "application/json", .headers = std::move(headers)};
      psio::vector_stream stream{reply.body};
      psio::to_json(value, stream);
      return reply;
   }

   psibase::HttpReply textError(std::vector<psibase::HttpHeader> headers,
                                psibase::HttpStatus              status,
                                std::string_view                 message);

   inline psibase::MonotonicTimePointUSec monotonicNow()
   {
      return std::chrono::time_point_cast<psibase::MicroSeconds>(std::chrono::steady_clock::now());
   }

   psibase::TimePointUSec wallNow();

   void maskSecret(std::optional<std::string>& secret);

   const psio::json::any* objectField(const psio::json::any_object& object, std::string_view key);

   // Sets `out` when `key` is present. Returns the 400 message, naming the
   // field `<path>.<key>`, when its value is not a non-empty string.
   std::optional<std::string> readStringField(const psio::json::any_object& object,
                                              std::string_view              path,
                                              std::string_view              key,
                                              std::optional<std::string>&   out);

   // Returns the 400 message, naming the field `name`, when `value` is not a
   // positive integer.
   std::optional<std::string> readPositive(const psio::json::any& value,
                                           std::string_view       name,
                                           uint64_t&              out);

   // `key=value&...` with every character outside RFC 3986's unreserved set
   // percent-encoded. Serves both query strings and form bodies.
   std::string formEncode(
       std::initializer_list<std::pair<std::string_view, std::string_view>> fields);

   std::string        codeChallenge(std::string_view verifier);
   psibase::HttpReply redirect(std::string location, std::vector<psibase::HttpHeader> headers = {});
   psibase::HttpReply badGateway(std::string_view message);
   bool               sameBytes(std::span<const char> a, const psibase::Checksum256& b);
}  // namespace xportal
