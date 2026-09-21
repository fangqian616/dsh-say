"""dsh-say ONNX engine worker.

A long-lived process that loads one character and then answers synthesis
requests, so the model load is paid once instead of on every line.

Protocol: one JSON object per line in, one JSON object per line out. Requests
carry an `id`; the reply repeats it.

Why a resident process at all: Genie-TTS loads four ONNX sessions plus a
reference-audio context, and doing that per call costs several seconds. The
GPT-SoVITS engine avoids the same cost by keeping its API server running; this
is the same idea without a port.

Two things about the engine shape this file:

* Everything genie_tts prints goes to stderr. At import it writes
  "GenieData folder not found." to stdout, and under a GBK console that write
  raises instead of warning - either way it must not land in the JSON stream.

* `ModelManager.__init__` hardcodes `self.providers = ["CPUExecutionProvider"]`,
  so a CUDA build of onnxruntime is never asked for the GPU unless the attribute
  is replaced before the first session is created. Every session here is created
  lazily, on the first `set_reference_audio` or `tts`, which is why replacing it
  right after import is early enough.

Never raises: every failure is reported as {"ok": false, "reason": "..."}.
"""

import importlib.util
import json
import os
import sys
import time
import traceback

# --- the protocol channel ---------------------------------------------------
# Kept private, because sys.stdout is handed to stderr for the rest of the run.
_PROTOCOL = sys.stdout
sys.stdout = sys.stderr

# `Core/Resources.py` calls input() when the data directory is missing. With no
# stdin that raises instead of hanging forever - so sys.stdin is replaced here,
# while the real one is kept for the protocol. Reading sys.stdin in the main loop
# instead would read from devnull and the worker would never see a request.
_INPUT = sys.stdin
try:
    sys.stdin = open(os.devnull, "r")
except Exception:  # pragma: no cover - platform dependent
    pass

LANGUAGES = {"zh": "Chinese", "en": "English", "ja": "Japanese",
             "chinese": "Chinese", "english": "English", "japanese": "Japanese"}

_state = {"character": "", "loaded": False, "requested": [], "language": "", "dllDirs": []}


def emit(payload):
    _PROTOCOL.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _PROTOCOL.flush()


def fail(request_id, reason):
    emit({"id": request_id, "ok": False, "reason": reason})


def ai_note(message):
    """A note for the user, on stderr so it cannot disturb the protocol."""
    sys.stderr.write("[dsh-say] %s\n" % message)
    sys.stderr.flush()


def language_of(code):
    return LANGUAGES.get(str(code or "zh").lower(), "")


def enable_cuda_dlls():
    """Put the CUDA runtime on the DLL search path before onnxruntime loads.

    onnxruntime-gpu does not fail when it cannot find cudnn: it reports CUDA in
    `get_available_providers()` and then builds a CPU session, warning on stderr
    that nobody reads. Adding the directories here is what actually turns CUDA on.

    Three places are searched, in the order a user is likely to have them:

      * DSH_SAY_CUDA_DLL_DIRS, so a caller can point at a working installation;
      * the NVIDIA pip packages (nvidia-cudnn-cu12 and friends), which is the
        self-contained option that needs no system CUDA;
      * torch's bundled runtime, because anyone who already has GPT-SoVITS has a
        working CUDA stack sitting in torch/lib and should not download it twice.

    Returns the directories that were added, for the report.
    """
    if os.name != "nt":
        return []

    candidates = []
    if os.environ.get("DSH_SAY_CUDA_DLL_DIRS"):
        candidates.extend(part for part in os.environ["DSH_SAY_CUDA_DLL_DIRS"].split(os.pathsep) if part)

    for module in ("nvidia.cudnn", "nvidia.cublas", "nvidia.cuda_runtime", "nvidia.cufft", "nvidia.curand"):
        try:
            spec = importlib.util.find_spec(module)
        except (ImportError, ValueError):
            continue
        for base in list(getattr(spec, "submodule_search_locations", None) or []):
            candidates.append(os.path.join(base, "bin"))
            candidates.append(os.path.join(base, "lib"))

    try:
        import torch  # noqa: F401
        candidates.append(os.path.join(os.path.dirname(torch.__file__), "lib"))
    except Exception:
        pass

    added = []
    for path in candidates:
        if not path or not os.path.isdir(path):
            continue
        try:
            os.add_dll_directory(path)
            added.append(path)
        except Exception:
            pass
    return added


# --- reading back what actually happened ------------------------------------

def collect_providers():
    """The execution providers the live sessions really got.

    onnxruntime answers `get_available_providers()` from what is compiled in,
    not from what a session was given: a CUDA build reports CUDA even when the
    session silently fell back to CPU because it could not find cudnn. The only
    honest answer comes from the sessions themselves, so they are walked.
    """
    seen = []

    def visit(obj, depth):
        if obj is None or depth > 4:
            return
        getter = getattr(obj, "get_providers", None)
        if callable(getter):
            try:
                for provider in getter():
                    if provider not in seen:
                        seen.append(provider)
            except Exception:
                pass
            return
        if isinstance(obj, dict):
            for value in list(obj.values())[:64]:
                visit(value, depth + 1)
        elif isinstance(obj, (list, tuple)):
            for value in obj[:64]:
                visit(value, depth + 1)
        elif hasattr(obj, "__dict__") and type(obj).__module__.startswith("genie_tts"):
            for value in list(vars(obj).values())[:64]:
                visit(value, depth + 1)

    from genie_tts.ModelManager import model_manager
    visit(model_manager, 0)
    return seen


def provider_report():
    """Which provider is in use, and why it might not be the requested one."""
    import onnxruntime

    actual = collect_providers()
    available = list(onnxruntime.get_available_providers())
    using_cuda = any("CUDA" in name for name in actual)
    requested_cuda = any("CUDA" in name for name in _state["requested"])

    report = {
        "providers": actual,
        "available": available,
        "device": "cuda" if using_cuda else "cpu",
        "requested": _state["requested"],
        "dllDirs": _state.get("dllDirs", []),
    }
    if requested_cuda and not using_cuda:
        # The failure that motivated this whole report: the user asked for the
        # GPU, the library agrees it has CUDA, and the session runs on the CPU
        # anyway. Say it out loud instead of letting it be slow in silence.
        report["warning"] = (
            "CUDA was requested but the sessions are running on the CPU. onnxruntime only warns when it "
            "cannot create a CUDA session, and the usual cause is a missing CUDA 12 / cuDNN 9 runtime. "
            "Either install it into the engine venv (nvidia-cudnn-cu12 plus nvidia-cublas-cu12), point "
            "DSH_SAY_CUDA_DLL_DIRS at a directory that has them, or set engines.onnx.device to cpu to stop "
            "asking for it."
        )
    return report


# --- operations -------------------------------------------------------------

def op_hello(request):
    return {
        "python": sys.executable,
        "pythonVersion": sys.version.split()[0],
        "dataDir": os.environ.get("GENIE_DATA_DIR", ""),
        "dataDirExists": os.path.isdir(os.environ.get("GENIE_DATA_DIR", "")),
    }


def op_load(request):
    language = language_of(request.get("language"))
    if not language:
        return {"ok": False, "reason": (
            "the ONNX engine speaks Chinese, English and Japanese only; %r is not one of them. "
            "Set textLang to zh, en or ja for this engine." % (request.get("language"),)
        )}

    model_dir = request.get("modelDir") or ""
    if not os.path.isdir(model_dir):
        return {"ok": False, "reason": "ONNX model directory not found: %s" % model_dir}

    device = str(request.get("device") or "auto").lower()
    if device == "cpu":
        wanted = ["CPUExecutionProvider"]
    else:
        wanted = ["CUDAExecutionProvider", "CPUExecutionProvider"]

    # Before anything pulls onnxruntime in, so the CUDA runtime is already
    # findable by the time the first session is built.
    _state["dllDirs"] = enable_cuda_dlls()

    import genie_tts
    from genie_tts.ModelManager import model_manager

    # The patch. See the module docstring: without this the engine is CPU-only
    # no matter which onnxruntime is installed.
    _state["requested"] = list(wanted)
    model_manager.providers = list(wanted)

    character = request.get("character") or "voice"
    genie_tts.load_character(
        character_name=character,
        onnx_model_dir=model_dir,
        language=language,
    )
    _state.update({"character": character, "loaded": True, "language": language})

    report = provider_report()
    report["ok"] = True
    report["character"] = character
    report["language"] = language
    if report.get("warning"):
        ai_note(report["warning"])
    return report


def op_reference(request):
    import genie_tts

    character = request.get("character") or _state["character"]
    audio = request.get("audioPath") or ""
    if not os.path.exists(audio):
        return {"ok": False, "reason": "reference audio not found: %s" % audio}

    genie_tts.set_reference_audio(
        character_name=character,
        audio_path=audio,
        audio_text=request.get("promptText") or "",
        language=language_of(request.get("language")) or _state["language"],
    )
    return {"ok": True, "character": character, "audioPath": audio}


def op_synth(request):
    import genie_tts

    character = request.get("character") or _state["character"]
    out = request.get("out") or ""
    if not out:
        return {"ok": False, "reason": "no output path was given"}

    started = time.time()
    genie_tts.tts(
        character_name=character,
        text=request.get("text") or "",
        play=False,
        split_sentence=request.get("splitSentence") is not False,
        save_path=out,
    )
    elapsed = round(time.time() - started, 1)

    if not os.path.exists(out):
        return {"ok": False, "reason": "the engine produced no audio for this text"}

    return {
        "ok": True,
        "audio": out,
        "bytes": os.path.getsize(out),
        "elapsedSeconds": elapsed,
        # Carried on every synthesis: a fallback that happened at load time is
        # still the reason this call is slow, and the caller reports it upward.
        "device": provider_report().get("device", "cpu"),
    }


def op_providers(request):
    report = provider_report()
    report["ok"] = True
    return report


def op_shutdown(request):
    emit({"id": request.get("id"), "ok": True, "stopping": True})
    raise SystemExit(0)


OPERATIONS = {
    "hello": op_hello,
    "load": op_load,
    "reference": op_reference,
    "synth": op_synth,
    "providers": op_providers,
    "shutdown": op_shutdown,
}


def main():
    for line in iter(_INPUT.readline, ""):
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except Exception as error:
            emit({"id": None, "ok": False, "reason": "malformed request: %r" % (error,)})
            continue

        request_id = request.get("id")
        handler = OPERATIONS.get(request.get("op") or "")
        if handler is None:
            fail(request_id, "unknown op %r" % (request.get("op"),))
            continue

        try:
            result = handler(request)
        except SystemExit:
            raise
        except Exception as error:
            # The full traceback goes to stderr; the caller gets the one line it
            # can act on. A worker that dies here would take the engine with it.
            traceback.print_exc(file=sys.stderr)
            fail(request_id, "%s: %s" % (type(error).__name__, error))
            continue

        result["id"] = request_id
        emit(result)


if __name__ == "__main__":
    main()
