from __future__ import annotations

import asyncio
import logging
import signal

import uvicorn
from PySide6 import QtWidgets
from qasync import QEventLoop

from .api_server import build_api
from .config import ServerConfig, load_config
from .metadata import MetadataResolver
from .player import SettingsDialog, UIHandles, build_ui
from .stream_manager import StreamManager
from .webrtc import WhipEndpoint

LOGGER = logging.getLogger("mtxcast")


async def _start_uvicorn(app, config: ServerConfig) -> None:
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=config.host,
            port=config.port,
            loop="asyncio",
            log_level="info",
        )
    )
    await server.serve()


async def _async_main(handles: UIHandles, config: ServerConfig) -> None:
    quit_event = asyncio.Event()

    def request_quit() -> None:
        if not quit_event.is_set():
            quit_event.set()
        handles.app.quit()

    def open_settings() -> None:
        dialog = SettingsDialog(config, handles.window)
        if dialog.exec() == QtWidgets.QDialog.DialogCode.Accepted:
            dialog.apply()

    handles.tray.wire(on_settings=open_settings, on_quit=request_quit)

    resolver = MetadataResolver(config.yt_dlp_format)
    manager = StreamManager(handles.backend, resolver)
    whip = WhipEndpoint(manager)
    api = build_api(manager, whip, config)

    handles.window.play_requested.connect(lambda: asyncio.create_task(manager.resume()))
    handles.window.pause_requested.connect(lambda: asyncio.create_task(manager.pause()))
    handles.window.stop_requested.connect(lambda: asyncio.create_task(manager.stop()))
    handles.window.seek_requested.connect(lambda position: asyncio.create_task(manager.seek(position)))
    handles.window.volume_changed.connect(lambda value: asyncio.create_task(manager.set_volume(value)))

    server_task = asyncio.create_task(_start_uvicorn(api, config))

    loop = asyncio.get_running_loop()
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, request_quit)
    except NotImplementedError:  # Windows fallback
        LOGGER.debug("Signal handlers not supported on this platform")

    await quit_event.wait()
    server_task.cancel()
    try:
        await server_task
    except asyncio.CancelledError:
        pass


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(name)s: %(message)s")
    config = load_config()
    handles = build_ui(config)
    loop = QEventLoop(handles.app)
    asyncio.set_event_loop(loop)
    with loop:
        loop.run_until_complete(_async_main(handles, config))


if __name__ == "__main__":
    main()

