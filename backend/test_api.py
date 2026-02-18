"""Test script to verify status API reads history from workspace."""

import sys
from pathlib import Path

sys.path.insert(0, ".")

from app.models.schemas import RoundtableStatus
from app.models.store import get_topic, update_topic_roundtable
from app.api.roundtable import get_roundtable_status_endpoint

# Test topic we created
topic_id = "dc8d7c97-03e5-4a97-9ce5-cf07777419f2"

# Mark as running
update_topic_roundtable(topic_id, RoundtableStatus.RUNNING)

# Check topic
topic = get_topic(topic_id)
print(f"Topic status: {topic.roundtable_status}")
print(f"Has result: {topic.roundtable_result is not None}")

# Now check what get_roundtable_status_endpoint returns
# We'll simulate by calling the logic inside
from pathlib import Path
from app.agent.workspace import read_discussion_history
from app.core.config import get_workspace_base
from app.models.schemas import RoundtableResult

ws_base = get_workspace_base()
ws_path = ws_base / "topics" / topic_id
history = read_discussion_history(ws_path)
print(f"\nRead history from workspace:")
print(f"  Length: {len(history)} chars")
print(f"  Starts with: {repr(history[:100])}")

# Now test the full API endpoint via curl
import subprocess
print("\n\nTesting GET /topics/{topic_id}/roundtable/status via curl:")
result = subprocess.run(
    ["curl", "-s", f"http://localhost:8000/topics/{topic_id}/roundtable/status"],
    capture_output=True,
    text=True,
)
print(result.stdout)
