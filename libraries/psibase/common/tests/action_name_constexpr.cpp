// Compile this with the host compiler and the WASI compiler. Expected SHA IDs
// depend only on the fixed hash contract, never on statistical model weights.
#include <psio/action_name.hpp>

constexpr auto hash_input = psio::action_names::impl::normalize(
    "this_is_a_model_independent_sha_padding_vector_with_more_than_sixty_four_ascii_characters_"
    "0123456789");
static_assert(hash_input.has_value());
static_assert(psio::action_names::impl::hash(*hash_input) == 14161499883774062114ULL);
static_assert(psio::action_names::encode("requestRecovery") ==
              psio::action_names::encode("requestrecovery"));
static_assert(psio::action_names::encode("foo_bar") != psio::action_names::encode("fooqbar"));
static_assert(psio::action_names::encode("load0") != psio::action_names::encode("loado"));
static_assert(psio::action_names::encode("#c000000000000000") == (uint64_t{3} << 62));

#ifdef __wasm32__
static_assert(sizeof(void*) == 4);
#endif

extern "C" uint64_t action_name_runtime_stack_probe(const char* text, unsigned size)
{
   return psio::action_names::encode({text, size});
}
