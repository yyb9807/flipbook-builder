from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

JobStatus = Literal[
    "queued", "running", "waiting_credentials", "waiting_confirmation", "cancelling",
    "succeeded", "partial", "failed", "cancelled",
]
TERMINAL = {"succeeded", "partial", "failed", "cancelled"}
ACTIVE_SQL = "('queued','running','waiting_credentials','waiting_confirmation','cancelling')"


class CreateJobBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    selected_keywords: list[Annotated[str, StringConstraints(max_length=200)]] = Field(default_factory=list, max_length=50)
    generate_images: bool | None = None


class ResolveJobBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    confirmation_id: str = Field(min_length=1, max_length=160)


class CreatePageJobBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    generate_images: bool | None = None
