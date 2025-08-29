from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict

CONFIG_FILE = Path.home() / ".mtxcast" / "config.json"


@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8080
    whip_endpoint: str = "/whip"
    metadata_endpoint: str = "/metadata"
    control_endpoint: str = "/control"
    enable_https: bool = False
    https_cert: str | None = None
    https_key: str | None = None
    auto_fullscreen: bool = True
    autoplay: bool = True
    yt_dlp_format: str = "best"
    api_token: str | None = None
    tray_autostart: bool = True

    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ServerConfig":
        filtered: Dict[str, Any] = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        extra = {k: v for k, v in data.items() if k not in filtered}
        cfg = cls(**filtered)
        cfg.extra = extra
        return cfg


def load_config(path: Path | None = None) -> ServerConfig:
    cfg_path = path or CONFIG_FILE
    if not cfg_path.exists():
        cfg_path.parent.mkdir(parents=True, exist_ok=True)
        config = ServerConfig()
        save_config(config, cfg_path)
        return config

    with cfg_path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return ServerConfig.from_dict(data)


def save_config(config: ServerConfig, path: Path | None = None) -> None:
    cfg_path = path or CONFIG_FILE
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    with cfg_path.open("w", encoding="utf-8") as fh:
        json.dump(config.to_dict(), fh, indent=2)

