#include <psibase/check.hpp>

#include <cstddef>
#include <cstdint>
#include <string>

// PSIO's build-time abort handler for guests (-DPSIO_CODEC_ABORT_HANDLER,
// set on the `psio` target). A guest is built without exceptions, so a
// fail-fast path of PSIO (a checked decode of invalid bytes, a value with
// no encoding) ends here with its error; the message reaches the host
// through abortMessage.
extern "C" void psibase_psio_codec_abort(const char*   what,
                                         std::size_t   what_size,
                                         std::uint32_t byte_offset,
                                         const char*   format,
                                         std::size_t   format_size)
{
   // (PSIO's messages name their format: "pssz: offset out of range")
   std::string message{what, what_size};
   if (!message.starts_with(std::string_view{format, format_size}))
      message = std::string{format, format_size} + ": " + message;
   message += " (at byte " + std::to_string(byte_offset) + ")";
   psibase::abortMessage(message);
}
