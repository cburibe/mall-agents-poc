from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("POWERTOOLS_SERVICE_NAME", "pre-token-generation")
os.environ.setdefault("POWERTOOLS_METRICS_NAMESPACE", "MallAgentsTest")
os.environ.setdefault("POWERTOOLS_TRACE_DISABLED", "true")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-2")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
