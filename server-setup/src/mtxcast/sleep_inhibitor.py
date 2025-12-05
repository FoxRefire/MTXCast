"""Sleep and screen blanking inhibitor for preventing system sleep during casting."""

from __future__ import annotations

import logging
import subprocess
import shutil
from typing import Optional

LOGGER = logging.getLogger(__name__)


class SleepInhibitor:
    """Manages system sleep and screen blanking inhibition during casting."""
    
    def __init__(self) -> None:
        self._inhibit_process: Optional[subprocess.Popen] = None
        self._xset_available = shutil.which("xset") is not None
        self._systemd_inhibit_available = shutil.which("systemd-inhibit") is not None
        
        if self._systemd_inhibit_available:
            LOGGER.info("Using systemd-inhibit for sleep inhibition")
        elif self._xset_available:
            LOGGER.info("Using xset for sleep inhibition")
        else:
            LOGGER.warning("No sleep inhibition method available (neither systemd-inhibit nor xset found)")
    
    def start(self) -> bool:
        """Start inhibiting sleep and screen blanking."""
        if self._inhibit_process is not None:
            LOGGER.warning("Sleep inhibition already active")
            return True
        
        try:
            if self._systemd_inhibit_available:
                # Use systemd-inhibit to prevent sleep and screen blanking
                self._inhibit_process = subprocess.Popen(
                    [
                        "systemd-inhibit",
                        "--what=sleep:idle:shutdown",
                        "--who=MTXCast",
                        "--why=Preventing sleep during casting",
                        "--mode=block",
                        "sleep", "infinity"
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                LOGGER.info("Started systemd-inhibit for sleep prevention")
                return True
            elif self._xset_available:
                # Use xset to disable DPMS (Display Power Management Signaling)
                try:
                    subprocess.run(
                        ["xset", "s", "off"],
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=5
                    )
                    subprocess.run(
                        ["xset", "-dpms"],
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=5
                    )
                    LOGGER.info("Disabled screen blanking using xset")
                    return True
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
                    LOGGER.warning("Failed to disable screen blanking with xset: %s", e)
                    return False
            else:
                LOGGER.warning("No sleep inhibition method available")
                return False
        except Exception as e:
            LOGGER.error("Failed to start sleep inhibition: %s", e, exc_info=True)
            return False
    
    def stop(self) -> bool:
        """Stop inhibiting sleep and screen blanking."""
        success = True
        
        if self._inhibit_process is not None:
            try:
                self._inhibit_process.terminate()
                self._inhibit_process.wait(timeout=5)
                LOGGER.info("Stopped systemd-inhibit")
            except subprocess.TimeoutExpired:
                LOGGER.warning("systemd-inhibit process did not terminate, killing it")
                self._inhibit_process.kill()
                self._inhibit_process.wait()
            except Exception as e:
                LOGGER.error("Error stopping systemd-inhibit: %s", e)
                success = False
            finally:
                self._inhibit_process = None
        
        if self._xset_available:
            # Re-enable DPMS
            try:
                subprocess.run(
                    ["xset", "s", "on"],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5
                )
                subprocess.run(
                    ["xset", "+dpms"],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5
                )
                LOGGER.info("Re-enabled screen blanking using xset")
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
                LOGGER.warning("Failed to re-enable screen blanking with xset: %s", e)
                success = False
        
        return success
    
    def is_active(self) -> bool:
        """Check if sleep inhibition is currently active."""
        if self._inhibit_process is not None:
            # Check if process is still running
            if self._inhibit_process.poll() is None:
                return True
            else:
                # Process has terminated, clean up
                self._inhibit_process = None
                return False
        return False

