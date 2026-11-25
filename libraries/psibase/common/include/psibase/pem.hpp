#pragma once

#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace psibase
{
   /// The PEM armor of `der` (RFC 7468): `-----BEGIN <label>-----`, the
   /// base64 of the bytes in lines of 64 characters, `-----END <label>-----`,
   /// each line ended by a newline.
   std::string pemEncode(std::span<const unsigned char> der, std::string_view label);

   /// The bytes inside the PEM armor `text` with the label `label`, or
   /// nothing when `text` is not such a document. White space is allowed
   /// around the armor and inside the base64 body; nothing else is. Never
   /// aborts or throws on malformed text.
   std::optional<std::vector<unsigned char>> pemDecode(std::string_view text,
                                                       std::string_view label);

   /// Whether `der` has the outer shape of an X.509 SubjectPublicKeyInfo:
   /// one DER `SEQUENCE` holding exactly an `AlgorithmIdentifier` (a
   /// `SEQUENCE` that starts with an `OBJECT IDENTIFIER`) and a `BIT STRING`,
   /// with definite lengths that fit. The key material is not examined.
   /// Never aborts or throws.
   bool hasSubjectPublicKeyInfoShape(std::span<const unsigned char> der) noexcept;
}  // namespace psibase
