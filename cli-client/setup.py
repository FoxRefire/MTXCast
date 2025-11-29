from setuptools import setup

setup(
    name="mtxcast-cli",
    version="0.1.0",
    description="CLI client for MTXCast server",
    py_modules=["mtxcast_cli"],
    install_requires=[
        "requests>=2.32.3",
    ],
    entry_points={
        "console_scripts": [
            "mtxcast-cli=mtxcast_cli:main",
        ],
    },
    python_requires=">=3.8",
)
