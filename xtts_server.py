import os
import re
from pathlib import Path
from flask import Flask, jsonify, request, send_file
from TTS.api import TTS

BASE_DIR = Path(__file__).resolve().parent
VOICE_REFERENCE = Path(os.getenv("XTTS_VOICE_REFERENCE", str(BASE_DIR / "kikivoice-cloned-file-2026-10-05-05-56-45-9835.mp3")))
OUTPUT_DIR = Path(os.getenv("XTTS_OUTPUT_DIR", "/tmp/xtts-output"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
API_TOKEN = os.getenv("XTTS_SERVER_TOKEN", "").strip()
DEFAULT_LANGUAGE = os.getenv("XTTS_LANGUAGE", "ar").strip() or "ar"
PORT = int(os.getenv("XTTS_PORT", "8000"))

app = Flask(__name__)
model = None

def get_model():
    global model
    if model is None:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
        app.logger.info("XTTS loaded on %s", device)
    return model

def authorized():
    return not API_TOKEN or request.headers.get("X-API-Key", "") == API_TOKEN

@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "dali-xtts", "voice_reference": VOICE_REFERENCE.exists()})

@app.post("/tts")
def tts():
    if not authorized():
        return jsonify({"error": "Unauthorized."}), 401
    data = request.get_json(silent=True) or {}
    text = data.get("text", "")
    language = data.get("language", DEFAULT_LANGUAGE)
    if not isinstance(text, str):
        return jsonify({"error": "Invalid text."}), 400
    text = re.sub(r"\\s+", " ", text).strip()
    if not text:
        return jsonify({"error": "Text cannot be empty."}), 400
    if len(text) > 5000:
        text = text[:5000]
    if not VOICE_REFERENCE.exists():
        return jsonify({"error": "Voice reference file is missing."}), 500

    output_path = OUTPUT_DIR / f"dali-{os.urandom(12).hex()}.wav"
    try:
        get_model().tts_to_file(
            text=text,
            speaker_wav=str(VOICE_REFERENCE),
            language=language,
            file_path=str(output_path),
            split_sentences=True,
        )
        response = send_file(output_path, mimetype="audio/wav", as_attachment=False, max_age=0)
        @response.call_on_close
        def cleanup():
            try:
                output_path.unlink(missing_ok=True)
            except Exception:
                pass
        return response
    except Exception:
        app.logger.exception("XTTS synthesis failed")
        try:
            output_path.unlink(missing_ok=True)
        except Exception:
            pass
        return jsonify({"error": "XTTS synthesis failed."}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
