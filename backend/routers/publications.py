"""Trusted editor management endpoints; never mounted by the publication reader."""
import asyncpg
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field

from database import get_pool
from publications import create_publication, list_publications, withdraw_publication

router = APIRouter()


class PublishBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    expected_revision: int = Field(ge=0)


@router.get("/publications")
async def all_publications():
    return {"publications": list_publications()}


@router.post("/projects/{project_id}/publications", status_code=201)
async def publish_project(project_id: str, body: PublishBody, response: Response,
                          pool: asyncpg.Pool = Depends(get_pool)):
    publication, created = await create_publication(pool, project_id, body.operation_id, body.expected_revision)
    response.status_code = 201 if created else 200
    return {"publication": publication}


@router.get("/projects/{project_id}/publications")
async def project_publications(project_id: str):
    return {"publications": list_publications(project_id)}


@router.delete("/projects/{project_id}/publications/{publication_id}")
async def unpublish_project(project_id: str, publication_id: str):
    return {"publication": withdraw_publication(project_id, publication_id)}
