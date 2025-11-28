from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Callable, Optional

from aiortc import RTCPeerConnection
from aiortc.mediastreams import MediaStreamTrack
from av import VideoFrame
from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget

from .config import ServerConfig, save_config
from .stream_manager import PlayerTransport


class VideoCanvas(QtWidgets.QLabel):
    frame_ready = QtCore.Signal(QtGui.QImage)

    def __init__(self) -> None:
        super().__init__()
        self.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        self.setText("Waiting for video...")
        self.setStyleSheet("background-color: black; color: white; font-size: 18px;")
        self.frame_ready.connect(self._on_frame_ready)

    def _on_frame_ready(self, image: QtGui.QImage) -> None:
        pixmap = QtGui.QPixmap.fromImage(image)
        self.setPixmap(pixmap.scaled(self.size(), QtCore.Qt.AspectRatioMode.KeepAspectRatio, QtCore.Qt.TransformationMode.SmoothTransformation))

    def render_frame(self, image: QtGui.QImage) -> None:
        """Thread-safe method to render frame"""
        self.frame_ready.emit(image)

    def resizeEvent(self, event: QtGui.QResizeEvent) -> None:
        super().resizeEvent(event)
        if self.pixmap():
            self.setPixmap(self.pixmap().scaled(self.size(), QtCore.Qt.AspectRatioMode.KeepAspectRatio, QtCore.Qt.TransformationMode.SmoothTransformation))


class ControlBar(QtWidgets.QWidget):
    play_clicked = QtCore.Signal()
    pause_clicked = QtCore.Signal()

    def __init__(self) -> None:
        super().__init__()
        layout = QtWidgets.QHBoxLayout(self)
        self.play_button = QtWidgets.QPushButton("Play")
        self.pause_button = QtWidgets.QPushButton("Pause")
        self.volume_slider = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.volume_slider.setRange(0, 100)
        self.volume_slider.setValue(80)

        layout.addWidget(self.play_button)
        layout.addWidget(self.pause_button)
        layout.addWidget(QtWidgets.QLabel("Volume"))
        layout.addWidget(self.volume_slider)

        self.play_button.clicked.connect(self.play_clicked.emit)
        self.pause_button.clicked.connect(self.pause_clicked.emit)


class PlayerWindow(QtWidgets.QMainWindow):
    play_requested = QtCore.Signal()
    pause_requested = QtCore.Signal()
    volume_changed = QtCore.Signal(float)

    def __init__(self, config: ServerConfig) -> None:
        super().__init__()
        self.setWindowTitle("MTXCast Player")
        self._config = config

        self._stack = QtWidgets.QStackedWidget()
        self._video_widget = QVideoWidget()
        self._canvas = VideoCanvas()
        self._stack.addWidget(self._video_widget)
        self._stack.addWidget(self._canvas)

        self._controls = ControlBar()
        self._controls.play_clicked.connect(self._on_play)
        self._controls.pause_clicked.connect(self._on_pause)
        self._controls.volume_slider.valueChanged.connect(self._on_volume)

        layout = QtWidgets.QVBoxLayout()
        layout.addWidget(self._stack)
        layout.addWidget(self._controls)

        container = QtWidgets.QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

    def video_widget(self) -> QVideoWidget:
        return self._video_widget

    def canvas(self) -> VideoCanvas:
        return self._canvas

    def show_player(self, use_webrtc: bool) -> None:
        self._stack.setCurrentWidget(self._canvas if use_webrtc else self._video_widget)
        if not self.isVisible():
            self.show()
        self.raise_()
        self.activateWindow()
        if self._config.auto_fullscreen and not self.isFullScreen():
            self.showFullScreen()

    def set_volume_slider(self, value: float) -> None:
        self._controls.volume_slider.blockSignals(True)
        self._controls.volume_slider.setValue(int(value * 100))
        self._controls.volume_slider.blockSignals(False)

    def _on_play(self) -> None:
        self.play_requested.emit()

    def _on_pause(self) -> None:
        self.pause_requested.emit()

    def _on_volume(self, value: int) -> None:
        self.volume_changed.emit(value / 100)


class TrayIcon(QtWidgets.QSystemTrayIcon):
    def __init__(self, window: PlayerWindow) -> None:
        icon = window.style().standardIcon(QtWidgets.QStyle.StandardPixmap.SP_ComputerIcon)
        super().__init__(icon, window)
        self.setToolTip("MTXCast")

        menu = QtWidgets.QMenu()
        self.show_action = menu.addAction("Show Player")
        self.settings_action = menu.addAction("Settings")
        self.quit_action = menu.addAction("Quit")

        self.show_action.triggered.connect(window.show)

        self.setContextMenu(menu)
        self.show()

    def wire(self, on_settings: Callable[[], None], on_quit: Callable[[], None]) -> None:
        self.settings_action.triggered.connect(on_settings)
        self.quit_action.triggered.connect(on_quit)


class SettingsDialog(QtWidgets.QDialog):
    def __init__(self, config: ServerConfig, parent: QtWidgets.QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("MTXCast Settings")
        self._config = config

        form = QtWidgets.QFormLayout(self)
        self.host_edit = QtWidgets.QLineEdit(config.host)
        self.port_edit = QtWidgets.QSpinBox()
        self.port_edit.setRange(1, 65535)
        self.port_edit.setValue(config.port)
        self.whip_edit = QtWidgets.QLineEdit(config.whip_endpoint)
        self.metadata_edit = QtWidgets.QLineEdit(config.metadata_endpoint)
        self.control_edit = QtWidgets.QLineEdit(config.control_endpoint)
        self.autoplay_check = QtWidgets.QCheckBox("Auto play")
        self.autoplay_check.setChecked(config.autoplay)
        self.fullscreen_check = QtWidgets.QCheckBox("Auto fullscreen")
        self.fullscreen_check.setChecked(config.auto_fullscreen)

        form.addRow("Host", self.host_edit)
        form.addRow("Port", self.port_edit)
        form.addRow("WHIP endpoint", self.whip_edit)
        form.addRow("Metadata endpoint", self.metadata_edit)
        form.addRow("Control endpoint", self.control_edit)
        form.addRow(self.autoplay_check)
        form.addRow(self.fullscreen_check)

        buttons = QtWidgets.QDialogButtonBox(QtWidgets.QDialogButtonBox.StandardButton.Ok | QtWidgets.QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addWidget(buttons)

    def apply(self) -> ServerConfig:
        self._config.host = self.host_edit.text().strip()
        self._config.port = int(self.port_edit.value())
        self._config.whip_endpoint = self.whip_edit.text().strip()
        self._config.metadata_endpoint = self.metadata_edit.text().strip()
        self._config.control_endpoint = self.control_edit.text().strip()
        self._config.autoplay = self.autoplay_check.isChecked()
        self._config.auto_fullscreen = self.fullscreen_check.isChecked()
        save_config(self._config)
        return self._config


class WebRTCSession:
    def __init__(self, canvas: VideoCanvas) -> None:
        self._canvas = canvas
        self._task: asyncio.Task[None] | None = None
        self._pc: RTCPeerConnection | None = None
        self._running = False

    async def attach(self, track: MediaStreamTrack, pc: RTCPeerConnection) -> None:
        await self.stop()
        self._pc = pc
        self._running = True
        self._task = asyncio.create_task(self._reader(track))

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._pc:
            await self._pc.close()
            self._pc = None

    async def _reader(self, track: MediaStreamTrack) -> None:
        import logging
        logger = logging.getLogger(__name__)
        try:
            logger.info("WebRTC track reader started")
            frame_count = 0
            while self._running:
                try:
                    frame: VideoFrame = await track.recv()
                    frame_count += 1
                    if frame_count % 30 == 0:  # Log every 30 frames
                        logger.debug("Received %d frames", frame_count)
                    
                    image = self._frame_to_qimage(frame)
                    if image and not image.isNull():
                        # Emit signal to render on Qt main thread
                        self._canvas.render_frame(image)
                    else:
                        logger.warning("Failed to convert frame to QImage")
                except Exception as e:
                    logger.error("Error processing frame: %s", e, exc_info=True)
                    await asyncio.sleep(0.1)  # Prevent tight loop on errors
        except asyncio.CancelledError:
            logger.info("WebRTC track reader cancelled")
        except Exception as e:
            logger.error("WebRTC track reader error: %s", e, exc_info=True)

    def _frame_to_qimage(self, frame: VideoFrame) -> QtGui.QImage | None:
        import logging
        logger = logging.getLogger(__name__)
        try:
            if frame is None:
                logger.warning("Received None frame")
                return None
            
            # Convert to RGB24 format
            arr = frame.to_ndarray(format="rgb24")
            if arr is None:
                logger.warning("Failed to convert frame to ndarray")
                return None
                
            h, w, channels = arr.shape
            if channels != 3:
                logger.warning("Unexpected channel count: %d", channels)
                return None
            
            # Ensure contiguous array
            if not arr.flags["C_CONTIGUOUS"]:
                arr = arr.copy()
            
            # Create QImage from array data
            bytes_per_line = arr.strides[0]
            image = QtGui.QImage(arr.data, w, h, bytes_per_line, QtGui.QImage.Format.Format_RGB888)
            
            if image.isNull():
                logger.warning("Created null QImage")
                return None
                
            return image.copy()
        except Exception as e:
            logger.error("Frame conversion error: %s", e, exc_info=True)
            return None


class PlayerBackend(QtCore.QObject):
    def __init__(self, window: PlayerWindow) -> None:
        super().__init__(window)
        self._window = window
        self._player = QMediaPlayer()
        self._audio = QAudioOutput()
        self._player.setAudioOutput(self._audio)
        self._player.setVideoOutput(window.video_widget())
        self._webrtc_session = WebRTCSession(window.canvas())
        self._volume = 0.8
        self._audio.setVolume(self._volume)
        self._window.set_volume_slider(self._volume)

        window.volume_changed.connect(self._on_volume_changed)

    async def play_url(self, url: str, start_time: float = 0.0, title: str | None = None) -> None:
        await self._webrtc_session.stop()
        self._player.setSource(QtCore.QUrl(url))
        self._player.play()
        if start_time:
            self._player.setPosition(int(start_time * 1000))
        self._window.show_player(use_webrtc=False)

    async def attach_webrtc_track(self, track: MediaStreamTrack, pc: RTCPeerConnection) -> None:
        import logging
        logger = logging.getLogger(__name__)
        logger.info("PlayerBackend: Attaching WebRTC track")
        self._player.stop()
        await self._webrtc_session.attach(track, pc)
        logger.info("PlayerBackend: Switching to WebRTC canvas")
        self._window.show_player(use_webrtc=True)

    async def pause(self) -> None:
        self._player.pause()

    async def resume(self) -> None:
        self._player.play()

    async def seek(self, position: float) -> None:
        self._player.setPosition(int(position * 1000))

    async def set_volume(self, volume: float) -> None:
        self._volume = max(0.0, min(volume, 1.0))
        self._audio.setVolume(self._volume)
        self._window.set_volume_slider(self._volume)

    def _on_volume_changed(self, value: float) -> None:
        self._volume = value
        self._audio.setVolume(self._volume)


@dataclass
class UIHandles:
    app: QtWidgets.QApplication
    window: PlayerWindow
    tray: TrayIcon
    backend: PlayerBackend


def build_ui(config: ServerConfig) -> UIHandles:
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    window = PlayerWindow(config)
    backend = PlayerBackend(window)
    tray = TrayIcon(window)
    window.hide()  # Hide until playback starts
    return UIHandles(app=app, window=window, tray=tray, backend=backend)

