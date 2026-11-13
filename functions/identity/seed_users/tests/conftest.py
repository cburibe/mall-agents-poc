from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("POWERTOOLS_SERVICE_NAME", "seed-test-users")
os.environ.setdefault("POWERTOOLS_TRACE_DISABLED", "true")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-2")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
