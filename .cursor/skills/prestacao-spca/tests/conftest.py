"""Setup comum: adiciona scripts/ ao sys.path para import."""
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS = SKILL_ROOT / "scripts"

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
