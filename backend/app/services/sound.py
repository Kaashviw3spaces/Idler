import os
import platform
import subprocess
import threading
from pathlib import Path
from typing import Optional


def _play_macos_chime():
    """Plays native macOS alert chime using afplay."""
    # Preferred sounds in order of availability
    candidates = [
        Path("/System/Library/Sounds/Glass.aiff"),
        Path("/System/Library/Sounds/Hero.aiff"),
        Path("/System/Library/Sounds/Tink.aiff"),
        Path("/System/Library/Sounds/Ping.aiff"),
    ]
    for sound_path in candidates:
        if sound_path.exists():
            try:
                subprocess.Popen(
                    ["afplay", str(sound_path)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                return True
            except Exception:
                continue
    # Fallback to terminal bell
    print("\a", end="", flush=True)
    return False


def _play_windows_chime():
    """Plays native Windows notification chime using PowerShell or rundll32."""
    cmd = (
        'powershell.exe -NoProfile -NonInteractive -Command '
        '"[System.Media.SystemSounds]::Asterisk.Play()"'
    )
    try:
        subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        return True
    except Exception:
        pass

    try:
        # Fallback via rundll32 message beep
        subprocess.Popen(
            ["rundll32.exe", "user32.dll,MessageBeep"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        return True
    except Exception:
        print("\a", end="", flush=True)
        return False


def play_system_chime(platform_override: Optional[str] = None) -> dict:
    """
    Plays an OS-native audio chime when scheduled background tasks or workflows finish.
    Tailors the sound specifically for macOS vs Windows.
    Runs asynchronously so caller is never blocked.
    """
    sys_name = platform.system().lower()
    target = (platform_override or sys_name).lower()

    if "darwin" in target or "mac" in target:
        threading.Thread(target=_play_macos_chime, daemon=True).start()
        return {"status": "played", "platform": "macos", "sound": "Glass.aiff"}
    elif "win" in target:
        threading.Thread(target=_play_windows_chime, daemon=True).start()
        return {"status": "played", "platform": "windows", "sound": "SystemAsterisk"}
    else:
        # Linux / other: terminal bell
        print("\a", end="", flush=True)
        return {"status": "played", "platform": "linux", "sound": "bell"}

