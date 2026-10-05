import os
import tempfile

import gradio as gr
import spaces
import torch

# XTTS asks for an interactive license confirmation on first download.
# The Space is non-interactive, so explicitly accept the non-commercial CPML.
os.environ.setdefault("COQUI_TOS_AGREED", "1")

# PyTorch 2.6+ changed torch.load defaults. XTTS's older checkpoint/config
# format needs the legacy behavior.
_original_torch_load = torch.load

def _patched_torch_load(*args, **kwargs):
    kwargs.setdefault("weights_only", False)
    return _original_torch_load(*args, **kwargs)

torch.load = _patched_torch_load

from TTS.api import TTS

MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
DEVICE = "cuda"

print("Loading XTTS-v2...")
tts = TTS(MODEL_NAME, progress_bar=False).to(DEVICE)
print("XTTS-v2 ready.")


@spaces.GPU(duration=120)
def synthesize(text, audio, language="ar"):
    if not text or not text.strip():
        raise gr.Error("Text is empty.")

    if not audio:
        raise gr.Error("Reference voice audio is required.")

    language = (language or "ar").strip().lower()
    if language not in {
        "ar", "en", "fr", "de", "es", "it", "pt", "pl", "tr",
        "ru", "nl", "cs", "zh-cn", "ja", "hu", "ko", "hi"
    }:
        raise gr.Error("Unsupported XTTS language.")

    output = tempfile.NamedTemporaryFile(
        suffix=".wav",
        delete=False
    )
    output.close()

    try:
        tts.tts_to_file(
            text=text.strip(),
            speaker_wav=audio,
            language=language,
            file_path=output.name,
            split_sentences=True
        )
        return output.name
    except Exception as error:
        raise gr.Error(f"XTTS synthesis failed: {error}") from error


with gr.Blocks(title="Dali AI XTTS Voice") as demo:
    gr.Markdown("# Dali AI — XTTS-v2 Voice API")

    text = gr.Textbox(
        label="Text",
        placeholder="اكتب النص هنا...",
        lines=4
    )
    audio = gr.Audio(
        label="Reference voice",
        type="filepath"
    )
    language = gr.Dropdown(
        choices=[
            "ar", "en", "fr", "de", "es", "it", "pt", "pl",
            "tr", "ru", "nl", "cs", "zh-cn", "ja", "hu", "ko", "hi"
        ],
        value="ar",
        label="Language"
    )
    output = gr.Audio(
        label="Generated voice",
        type="filepath"
    )
    button = gr.Button("Generate voice")
    button.click(
        fn=synthesize,
        inputs=[text, audio, language],
        outputs=output,
        api_name="synthesize"
    )

if __name__ == "__main__":
    demo.queue().launch()
