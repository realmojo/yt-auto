#!/usr/bin/env python3
"""영상의 오디오를 음성강화(denoiser dns64)본으로 교체(in-place).
영상 스트림은 복사, 오디오만 교체 → BGM/배경 억제, 목소리 강조.
사용: python3 voice_swap.py <video.mp4> ...
"""
import sys, os, subprocess, numpy as np, torch
from scipy.io import wavfile
from scipy.signal import resample_poly
from denoiser import pretrained

DEV = "cpu"  # 병렬 안정성 위해 CPU
model = pretrained.dns64().to(DEV)
model.eval()


def process(v):
    base = os.path.basename(v)
    mix = v + ".mix.wav"
    enh = v + ".enh.wav"
    tmp = v + ".voiced.tmp.mp4"
    try:
        subprocess.run(["ffmpeg", "-y", "-i", v, "-vn", "-ac", "1", "-ar", "44100", mix],
                       capture_output=True)
        sr, data = wavfile.read(mix)
        if data.ndim == 2:
            data = data.mean(1)
        x = data.astype(np.float32) / 32768.0
        x16 = resample_poly(x, 16000, sr).astype(np.float32)
        with torch.no_grad():
            est = model(torch.from_numpy(x16)[None, None].to(DEV))
        out = np.clip(est.squeeze().cpu().numpy(), -1, 1)
        wavfile.write(enh, 16000, out.astype(np.float32))
        r = subprocess.run(["ffmpeg", "-y", "-i", v, "-i", enh, "-map", "0:v", "-map", "1:a",
                            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "16000",
                            "-shortest", "-movflags", "+faststart", tmp], capture_output=True)
        if r.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 0:
            os.replace(tmp, v)
            print("OK", base, flush=True)
        else:
            print("FAIL", base, r.stderr.decode()[-200:], flush=True)
    except Exception as e:
        print("ERR", base, str(e)[:200], flush=True)
    finally:
        for f in (mix, enh, tmp):
            if os.path.exists(f):
                try:
                    os.remove(f)
                except OSError:
                    pass


for v in sys.argv[1:]:
    process(v)
