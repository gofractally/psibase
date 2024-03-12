/*
 * File: jwt.hpp
 *
 * Declares the interfaces for encoding and decoding JSON Web Tokens (JWT) used by the Http Server.
 * This file contains the struct definitions necessary for representing JWT data, keys, and responses,
 * as well as the function declarations for handling the JWT encoding and decoding processes.
 */
#pragma once

#include <psibase/check.hpp>
#include <psio/reflect.hpp>

#include <cstdint>
#include <limits>
#include <string>
#include <string_view>

namespace psibase::http
{
   /**
    * @brief Structure representing the data of a JWT token.
    *
    * @details
    * This struct holds the payload information for a JWT token.
    * - exp: The expiration time of the token. Expressed as a Unix timestamp.
    * - mode: The access mode of the token. Valid values are "r" for read-only and "rw" for read-write access.
    */
   struct token_data
   {
      std::uint64_t exp;
      std::string   mode;  // "r", "rw"
   };
   PSIO_REFLECT(token_data, exp, mode);
   struct token_key
   /**
    * @brief Holds a secret key used for signing and verifying JWT tokens.
    *
    * @details
    * This struct encapsulates the HMAC secret key required for token operations.
    * It ensures the key does not contain newline characters and does not exceed a certain length limit.
    *
    * Public methods allow access to the key data for JWT operations.
    */
   {
     public:
      /**
       * @brief Initializes the token_key with a provided secret key.
       *
       * @param k The secret key used for signing and verifying JWT tokens. Ensures that the key does not contain newline characters and is of acceptable length.
       */
      token_key(std::string_view k) : impl(k)
      {
         for (auto ch : k)
         {
            psibase::check(ch != '\r' && ch != '\n', "Unexpected newline in key");
         }
         psibase::check(k.size() <= std::numeric_limits<int>::max(), "Key too large");
      }
                  operator std::string_view() const { return impl; }
      const char* data() const { return impl.data(); }
      int         size() const { return static_cast<int>(impl.size()); }
      std::string str() const { return impl; }

     private:
      std::string impl;
   };
   /**
    * @brief Decodes a JWT token using the given key and verifies its validity.
    *
    * @param k The secret key used to decode and verify the JWT token's signature.
    * @param token The JWT token to decode.
    * @return Decoded token data.
    * @throws std::runtime_error If token decoding fails or if the signature is invalid.
    */
   token_data  decode_jwt(const token_key& k, std::string_view token);
   /**
    * @brief Encodes and signs a JWT token using the given key and token data.
    *
    * @param k The secret key used to sign the JWT token.
    * @param token The data to encode into the JWT token.
    * @return The encoded JWT token as a string.
    * @throws std::runtime_error If token encoding fails.
    */
   std::string encode_jwt(const token_key& k, const token_data&);

   /**
    * @brief Structure representing the response containing a JWT token.
    *
    * @details Holds the JWT access token, its expiration time, and the mode of access.
    * - accessToken: The JWT token issued for authenticated access.
    * - exp: Expiration time as a Unix timestamp, indicating when the token becomes invalid.
    * - mode: Access privileges associated with the token, typically 'r' for read-only or 'rw' for read-write access.
    */
   struct token_response
   {
      std::string   accessToken;
      std::uint64_t exp;
      std::string   mode;
   };
   PSIO_REFLECT(token_response, accessToken, exp, mode)
}  // namespace psibase::http
