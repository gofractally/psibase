#pragma once

#include <psibase/AccountNumber.hpp>
#include <cstdint>

// The `guest` account (gofractally/psibase #2307).
//
// `guest` is an ordinary account that uses auth-sig like any other. What
// makes it the account of nobody is its key alone: the owner and the active
// key are one secp256k1 point for which no private key is known, and it has
// no recovery partner. No service, and nothing in the dispatcher, looks at
// the name. These constants are for code that has to name the account (a
// wallet showing a signed-out visitor as `guest`) and for the tests; the
// account itself is created by this package's postinstall.json.
//
// The key is derived from `keySeed` by ../../../guest-key.py, which states
// the derivation and writes guest-key.json:
//
//    x = SHA-256(keySeed || keyCounter as 4 bytes, little-endian)
//
// with the first counter for which x is the x-coordinate of a point of the
// curve; the key is that point with the even y. `guest-key.py --check` fails
// if this file, guest-key.json or postinstall.json disagree.

namespace SystemService
{
   namespace AuthSig
   {
      namespace guest
      {
         inline constexpr psibase::AccountNumber account{"guest"};

         inline constexpr char          keySeed[]  = "psibase guest account: nobody holds this key";
         inline constexpr std::uint32_t keyCounter = 0;

         /// The DER SubjectPublicKeyInfo of the key: the compressed point,
         /// 02 || x
         inline constexpr unsigned char keySpki[] = {
             0x30, 0x36, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d,
             0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x03, 0x22,
             0x00, 0x02, 0x9a, 0xe2, 0xe8, 0x32, 0x37, 0xcf, 0xbe, 0x00, 0x37,
             0xe8, 0x0f, 0x60, 0x98, 0xc6, 0xca, 0xe9, 0x57, 0xe8, 0xf0, 0x24,
             0xfc, 0xb8, 0xbb, 0x42, 0x21, 0xf6, 0x74, 0x61, 0x20, 0x8b, 0x07,
             0x10};
      }  // namespace guest
   }  // namespace AuthSig
}  // namespace SystemService
