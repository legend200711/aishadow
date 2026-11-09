import numpy as np
import sounddevice as sd
import sherpa_onnx
from scipy.signal import resample_poly

MODEL = "models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
INPUT_RATE = 48000
MODEL_RATE = 16000
DEVICE = 15
BLOCK_SIZE = 1536

print("\nSHADOW WAKE-WORD TEST")
print("Listening for: SHADOW")
print("Speak clearly into your microphone.")
print("Press CTRL+C to stop.\n")

spotter = sherpa_onnx.KeywordSpotter(
    tokens=f"{MODEL}/tokens.txt",
    encoder=f"{MODEL}/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    decoder=f"{MODEL}/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    joiner=f"{MODEL}/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    keywords_file="models/shadow-keyword-tokens.txt",
    num_threads=2,
    sample_rate=MODEL_RATE,
    keywords_score=1.0,
    keywords_threshold=0.25,
    provider="cpu",
)

stream = spotter.create_stream()

try:
    with sd.InputStream(
        device=DEVICE,
        channels=1,
        samplerate=INPUT_RATE,
        blocksize=BLOCK_SIZE,
        dtype="float32",
    ) as mic:
        print("Microphone connected. Say SHADOW!\n")

        while True:
            audio, overflowed = mic.read(BLOCK_SIZE)

            samples_48k = np.asarray(audio[:, 0], dtype=np.float32)
            samples_16k = resample_poly(samples_48k, 1, 3).astype(np.float32)

            stream.accept_waveform(MODEL_RATE, samples_16k)

            while spotter.is_ready(stream):
                spotter.decode_stream(stream)

            result = spotter.get_result(stream)

            if result:
                print("WAKE WORD DETECTED:", result)
                stream = spotter.create_stream()

except KeyboardInterrupt:
    print("\nWake-word test stopped.")
except Exception as error:
    print("\nWAKE TEST ERROR:", repr(error))
