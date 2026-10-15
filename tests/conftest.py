import os

import pytest


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: needs the wav2vec2 model and real audio (run with -m slow)")


def pytest_collection_modifyitems(config, items):
    if os.environ.get("SHRUTI_FAST_TESTS") == "1":
        skip = pytest.mark.skip(reason="SHRUTI_FAST_TESTS=1")
        for item in items:
            if "slow" in item.keywords:
                item.add_marker(skip)
