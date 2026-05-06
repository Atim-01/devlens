"""
The AI service contract.

Every analyser in DevLens — HuggingFace, local model, or any future engine —
must implement this interface. The worker and circuit breaker only ever talk
to this interface, never to a concrete implementation directly.

Why this matters:
  The worker calls `analyser.analyse(files)` and gets back an `AnalysisResult`.
  It does not know or care whether HuggingFace ran or the local model ran.
  Swapping engines, adding new ones, or mocking in tests requires zero changes
  to the worker — only the analyser implementation changes.

This is the Dependency Inversion principle in practice: high-level code
(the worker) depends on an abstraction, not a concrete implementation.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class AnalysisResult:
    """
    The output of any analysis run — regardless of which engine produced it.

    Fields:
        scores    — dict mapping dimension name to score (0–100).
                    Keys: security, performance, readability, complexity, bug_risk.
                    Example: {"security": 62, "performance": 74, ...}

        issues    — list of dicts, one per flagged issue.
                    Each dict contains: file_path, line_number, dimension,
                    severity, title, explanation, suggestion.

        engine    — which engine produced this result: "huggingface" or "local".
                    Stored on the Job row for observability.

        degraded  — True when the local fallback ran instead of HuggingFace.
                    Surfaced as a yellow warning banner on the dashboard so
                    users know to treat results as indicative, not definitive.
    """

    scores: dict
    issues: list[dict]
    engine: str
    degraded: bool = False

    # Provide safe defaults so callers can construct a minimal result
    # without specifying every field — useful in tests and error paths.
    def __post_init__(self):
        if self.scores is None:
            self.scores = {}
        if self.issues is None:
            self.issues = []


# The five dimensions DevLens scores every commit across.
# Defined here as a constant so every analyser uses the same names —
# a typo in one implementation would cause silent data gaps in the DB.
DIMENSIONS = ("security", "performance", "readability", "complexity", "bug_risk")

# Valid severity levels for issues — ordered from most to least severe.
SEVERITY_LEVELS = ("critical", "warning", "info")


class BaseAnalyser(ABC):
    """
    Abstract base class every analyser must inherit from.

    Subclasses must implement `analyse()`. Everything else — circuit breaker
    routing, retry logic, result persistence — lives outside this class.

    Usage:
        class MyAnalyser(BaseAnalyser):
            def analyse(self, files: list[dict]) -> AnalysisResult:
                ...
    """

    @abstractmethod
    def analyse(self, files: list[dict]) -> AnalysisResult:
        """
        Analyse a list of changed files and return scored results.

        Args:
            files: list of dicts, each with keys:
                   - "path": str  — relative file path, e.g. "src/auth.py"
                   - "content": str — full file content as a string

        Returns:
            AnalysisResult with scores across all 5 dimensions and a list
            of specific issues with explanations and suggestions.

        Raises:
            Any exception — the circuit breaker and worker handle retries.
            Implementations should not swallow exceptions silently.
        """
        ...
