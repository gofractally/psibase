#include <psibase/saturating.hpp>

using namespace psibase;

static_assert(saturatingCast<std::uint8_t>(std::int8_t{-1}) == 0u);
static_assert(saturatingCast<std::uint8_t>(std::int8_t{-128}) == 0u);
static_assert(saturatingCast<std::uint8_t>(std::int8_t{127}) == 127u);
static_assert(saturatingCast<std::uint8_t>(-256) == 0u);
static_assert(saturatingCast<std::uint8_t>(-1) == 0u);
static_assert(saturatingCast<std::uint8_t>(255) == 0xffu);
static_assert(saturatingCast<std::uint8_t>(256) == 0xffu);

static_assert(saturatingCast<std::int8_t>(std::uint8_t{0}) == 0);
static_assert(saturatingCast<std::int8_t>(std::uint8_t{127}) == 127);
static_assert(saturatingCast<std::int8_t>(std::uint8_t{128}) == 127);
static_assert(saturatingCast<std::int8_t>(std::uint8_t{255}) == 127);
static_assert(saturatingCast<std::int8_t>(-128) == -128);
static_assert(saturatingCast<std::int8_t>(-129) == -128);
static_assert(saturatingCast<std::int8_t>(-257) == -128);

static_assert(saturatingCast<std::chrono::duration<std::int8_t, std::ratio<128, 1>>>(
                  std::chrono::duration<std::int8_t>(-128))
                  .count() == -1);
static_assert(saturatingCast<std::chrono::duration<std::uint8_t, std::ratio<128, 1>>>(
                  std::chrono::duration<std::int8_t>(-128))
                  .count() == 0u);

static_assert(saturatingCast<std::chrono::duration<std::int8_t, std::ratio<1, 10>>>(
                  std::chrono::duration<std::int8_t>(10))
                  .count() == 100);
static_assert(saturatingCast<std::chrono::duration<std::int8_t, std::ratio<1, 10>>>(
                  std::chrono::duration<std::int8_t>(100))
                  .count() == 127);
static_assert(saturatingCast<std::chrono::duration<std::int8_t, std::ratio<1, 10>>>(
                  std::chrono::duration<std::int8_t>(-100))
                  .count() == -128);

static_assert(saturatingCast<std::chrono::duration<std::int8_t, std::ratio<1, 128>>>(
                  std::chrono::duration<std::int8_t>(-1))
                  .count() == -128);
static_assert(saturatingCast<std::chrono::duration<std::uint8_t, std::ratio<1, 128>>>(
                  std::chrono::duration<std::int8_t>(-1))
                  .count() == 0);

int main() {}
