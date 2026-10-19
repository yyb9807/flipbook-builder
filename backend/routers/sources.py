"""Read-only public source discovery; no model or project database access."""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from source_retrieval import SourceRetrievalError, WikipediaSources

router = APIRouter()
_sources = WikipediaSources()


def get_source_service() -> WikipediaSources:
    return _sources


def _http_error(error: SourceRetrievalError) -> HTTPException:
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after is not None else None
    return HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message}, headers=headers,
    )


@router.get("/sources/search")
async def search_sources(
    q: Annotated[str, Query(min_length=1, max_length=200)],
    response: Response,
    language: Literal["zh", "en"] = "zh",
    service: WikipediaSources = Depends(get_source_service),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await service.search(q, language)
    except SourceRetrievalError as error:
        raise _http_error(error) from error


@router.get("/sources/page")
async def source_page(
    key: Annotated[str, Query(min_length=1, max_length=512)],
    response: Response,
    language: Literal["zh", "en"] = "zh",
    service: WikipediaSources = Depends(get_source_service),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await service.page(key, language)
    except SourceRetrievalError as error:
        raise _http_error(error) from error
