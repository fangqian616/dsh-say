"""Report what the ONNX engine can do here, without importing genie_tts.

`import genie_tts` is not a safe way to ask: it runs `Core/Resources.py`, which
prints to stdout, calls input() when its data directory is missing, and raises
FileNotFoundError when the hubert model is absent. So readiness is probed with
importlib.util.find_spec, which locates the package without executing it.

Prints one JSON object.
"""

import importlib.util
import json
import os
import sys

DATA_DIR = os.environ.get("GENIE_DATA_DIR", "")

# Both are checked by genie_tts at import time; without them it cannot load.
REQUIRED = ["chinese-hubert-base", "speaker_encoder.onnx"]

report = {
    "python": sys.executable,
    "pythonVersion": "%d.%d.%d" % sys.version_info[:3],
    "dataDir": DATA_DIR,
    "dataDirExists": bool(DATA_DIR) and os.path.isdir(DATA_DIR),
    "missing": [],
}

try:
    spec = importlib.util.find_spec("genie_tts")
except (ImportError, ValueError):
    spec = None

report["genieTts"] = spec is not None
report["genieTtsPath"] = getattr(spec, "origin", "") or "" if spec else ""

if report["dataDirExists"]:
    report["missing"] = [name for name in REQUIRED if not os.path.exists(os.path.join(DATA_DIR, name))]

try:
    import onnxruntime

    report["onnxruntime"] = onnxruntime.__version__
    # What is compiled in, not what a session gets. The worker reports the rest.
    report["availableProviders"] = list(onnxruntime.get_available_providers())
except Exception as error:  # pragma: no cover - broken environment
    report["onnxruntime"] = ""
    report["availableProviders"] = []
    report["onnxruntimeError"] = "%s: %s" % (type(error).__name__, error)

sys.stdout.write(json.dumps(report, ensure_ascii=False) + "\n")
