# Account numbers

Account names on a psibase network are able to compress to 64-bit numbers. To achieve this, psibase uses a reimplementation of the [CACM87](https://web.stanford.edu/class/ee398a/handouts/papers/WittenACM87ArithmCoding.pdf) arithmetic coding technique. Arithmetic coding uses fewer bits to encode frequently-seen symbols and more bits to encode rarely-seen symbols. For the psibase implementation, the model used to calibrate character and substring frequency was calculated using the set of publicly known Reddit account names.

The benefit of using an entropy-encoding technique is that psibase account names can be up to 18 characters long. The following rules for account names must be adhered to:
* Name length is between 0 and 18 characters
* Names may only include the following character: a-z, 0-9, and - (hyphen)
* A hyphen may not be the second or last character in an account name
* Non-empty names must begin with a letter

To get 64-bit values out of 18-character names, some names will necessarily fail to compress down to 64 bits. The probability that a name will fail to compress increases as the length of the name increases and also as the number of rarely-seen characters and substrings increases. The compression algorithm prefers names that are more likely to appear in user handles, and less likely to compress names that look non-human (e.g. no vowels).

> Note: For more details, see the code for the account number encoding C++ [reference implementation](../../development/services/cpp-service/reference/magic-numbers.md#psibaseaccountnumber).

## Usage in URLs

Account names will frequently appear in subdomains of psibase network nodes. Therefore, the rules for account names are restricted to what is allowed by the DNS rules. Furthermore, a hyphen is not allowed in the second position of an account name because that would conflict with a psibase-specific URL encoding rule, that words in the URL with a hyphen in the second position are attribute values and not account names. More about psibase URL encoding can be found [here](../blockchain/request-encoding.md).
