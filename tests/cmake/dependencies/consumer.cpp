// Exercise maintained PSIO's public target and typed APIs; no copied codec.
// Explicit standard includes also allow testing the unmodified ff114 parent.
#include <cstdint>
#include <iostream>
#include <string>
#include <variant>
#include <vector>
#include <psio/json.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_view.hpp>
#include <psio/transcode.hpp>

struct Message
{
    std::uint32_t id;
    std::string text;
};
PSIO_REFLECT(Message, id, text)

int main()
{
    const Message input{7, "canonical dependency"};
    const auto bytes = psio::encode(psio::pssz{}, input);
    if (!psio::validate<Message>(psio::pssz{}, bytes).ok())
        return 1;
    const auto decoded = psio::decode<Message>(psio::pssz{}, bytes);
    if (decoded.id != input.id || decoded.text != input.text)
        return 2;
    const psio::view<Message, psio::pssz, psio::storage::const_borrow> view{bytes};
    if (view.template get<1>().view_() != input.text)
        return 3;
    const auto json = psio::transcode<Message>(psio::pssz{}, bytes, psio::json{});
    if (json != R"({"id":7,"text":"canonical dependency"})")
        return 4;
    std::cout << "maintained PSIO encode/validate/decode/view/JSON: " << json << '\n';
}
