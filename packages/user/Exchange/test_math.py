"""Run the unchanged arithmetic tests on the host, including should_panic.

Psitest's aborting WASM harness skips should_panic cases. Strip only the
Fracpack storage adapter, which depends on the platform, and compile the exact
constants, arithmetic functions and test bodies from service/src/math.rs.
No financial algorithm is duplicated in this runner.
"""
from pathlib import Path
import subprocess
import tempfile

source = (Path(__file__).parent / "service/src/math.rs").read_text()
adapter = source.index("/// Fracpack deliberately")
functions = source.index("pub fn amount(", adapter)
with tempfile.TemporaryDirectory(prefix="exchange-math-") as directory:
    root = Path(directory)
    test_source = root / "math.rs"
    executable = root / "math-tests"
    test_source.write_text(source[:adapter] + source[functions:])
    subprocess.run(["rustc", "--edition", "2021", "--test", "-O", str(test_source),
                    "-o", str(executable)], check=True)
    subprocess.run([str(executable)], check=True)
