import asyncio
import json
import time

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.base import _log, get_imggen_config, get_llm_config
from agents.image_generation import ImageGenerationAgent
from agents.page_generation import PageGenerationAgent
from database import get_pool
from sse import _sse, sse_stream
from utils import gen_id

router = APIRouter()


def _grid_hotspots(sub_topics: list[str]) -> list[dict]:
    """从 sub_topics 生成网格布局热点（瞬时，无 LLM 调用）。
    最多 4 个，2x2 网格分布在 16:9 图片上。"""
    out = []
    items = sub_topics[:4]
    cols = 2
    for i, label in enumerate(items):
        col = i % cols
        row = i // cols
        out.append({
            "label": label,
            "x": 0.08 + col * 0.48,
            "y": 0.18 + row * 0.42,
            "width": 0.36,
            "height": 0.30,
            "score": 0.8,
        })
    return out


class HotspotUpdate(BaseModel):
    id: str
    label: str | None = None
    selected: bool | None = None
    pos_x: float | None = None
    pos_y: float | None = None
    width: float | None = None
    height: float | None = None


class UpdateHotspotsBody(BaseModel):
    hotspots: list[HotspotUpdate]


@router.patch("/projects/{project_id}/nodes/{node_id}/hotspots")
async def update_hotspots(
    project_id: str,
    node_id: str,
    body: UpdateHotspotsBody,
    pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        node = await conn.fetchrow(
            "SELECT id FROM nodes WHERE id = $1 AND project_id = $2", node_id, project_id
        )
        if not node:
            raise HTTPException(404, "节点不存在")

        for upd in body.hotspots:
            # 构建动态 UPDATE
            sets = []
            vals = []
            if upd.label is not None:
                sets.append(f"label = ${len(vals)+1}")
                vals.append(upd.label)
            if upd.selected is not None:
                sets.append(f"selected = ${len(vals)+1}")
                vals.append(upd.selected)
            if upd.pos_x is not None:
                sets.append(f"pos_x = ${len(vals)+1}")
                vals.append(upd.pos_x)
            if upd.pos_y is not None:
                sets.append(f"pos_y = ${len(vals)+1}")
                vals.append(upd.pos_y)
            if upd.width is not None:
                sets.append(f"width = ${len(vals)+1}")
                vals.append(upd.width)
            if upd.height is not None:
                sets.append(f"height = ${len(vals)+1}")
                vals.append(upd.height)

            if sets:
                vals.append(upd.id)
                await conn.execute(
                    f"UPDATE hotspots SET {', '.join(sets)} WHERE id = ${len(vals)}",
                    *vals,
                )

    return {"status": "ok"}


class GenerateChildrenBody(BaseModel):
    selected_keywords: list[str] = []


@router.post("/projects/{project_id}/nodes/{node_id}/generate-children")
async def generate_children(
    project_id: str,
    node_id: str,
    request: Request,
    body: GenerateChildrenBody = GenerateChildrenBody(),
    pool: asyncpg.Pool = Depends(get_pool),
):
    llm_config = get_llm_config(request)
    imggen_config = get_imggen_config(request)

    # 验证和预读（必须在 generator 外完成）
    async with pool.acquire() as conn:
        project = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        if not project:
            raise HTTPException(404, "项目不存在")
        node = await conn.fetchrow(
            "SELECT * FROM nodes WHERE id = $1 AND project_id = $2", node_id, project_id
        )
        if not node:
            raise HTTPException(404, "节点不存在")
        settings = json.loads(project["settings"]) if isinstance(project["settings"], str) else project["settings"]
        max_depth = settings.get("max_depth", 4)
        if node["depth"] >= max_depth:
            raise HTTPException(400, f"已达到最大深度 {max_depth}")
        selected_hotspots = await conn.fetch(
            "SELECT * FROM hotspots WHERE node_id = $1 AND selected = true ORDER BY sort_order",
            node_id,
        )

    if not selected_hotspots:
        raise HTTPException(400, "没有选中的热点")

    visual_style = settings.get("visual_style", "cinematic")
    language = settings.get("language", "zh")

    @sse_stream("GEN-CHILDREN")
    async def stream(bg_tasks: list[asyncio.Task]):
        flow_t0 = time.time()
        _log(f"════ GEN-CHILDREN start project={project_id} node={node_id} hotspots={len(selected_hotspots)}")
        page_agent = PageGenerationAgent(llm_config)
        image_agent = ImageGenerationAgent(imggen_config)

        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE nodes SET status = 'generating', updated_at = NOW() WHERE id = $1", node_id
            )
            pending = await _filter_pending_hotspots(conn, selected_hotspots)

        if not pending:
            yield _sse({"done": True, "nodes": []})
            return

        # ── 并行：每个 hotspot 一条独立的"页面文案 + 配图"流水线 ──
        # 4 个热点串行 = 4 × (15s + 60s) = 5 分钟
        # 4 个热点并行 = max(15s + 60s) ≈ 75s
        async def build_one(hs: dict) -> dict:
            return await _build_child(
                hs,
                node,
                page_agent,
                image_agent,
                project_id,
                visual_style,
                language,
                body.selected_keywords or [],
                bool(imggen_config.api_key),
            )

        yield _sse({"step": 1, "pct": 10, "message": f"并行生成 {len(pending)} 个子页面"})
        gather_task = asyncio.ensure_future(asyncio.gather(*[build_one(hs) for hs in pending]))
        bg_tasks.append(gather_task)
        elapsed = 0
        while not gather_task.done():
            await asyncio.sleep(5)
            elapsed += 5
            pct = min(10 + elapsed, 80)
            yield _sse({"step": 2, "pct": pct, "message": f"并行生成中 {elapsed}s…"})
        results = await gather_task

        # ── 串行写库（写库本身很快）──
        yield _sse({"step": 3, "pct": 88, "message": "保存结果"})
        new_nodes: list[dict] = []
        for built in results:
            new_nodes.append(await _persist_child(pool, project_id, node_id, node["depth"], built))

        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE nodes SET status = 'completed', updated_at = NOW() WHERE id = $1", node_id
            )

        _log(f"════ GEN-CHILDREN done total={time.time() - flow_t0:.1f}s nodes={len(new_nodes)}")
        yield _sse({"done": True, "nodes": new_nodes})

    return StreamingResponse(stream(), media_type="text/event-stream")


# ─────────── generate_children helpers ───────────

async def _filter_pending_hotspots(conn: asyncpg.Connection, selected: list) -> list[dict]:
    """从选中热点里去掉已经生成过子节点的（target_node_id 已存在）。"""
    pending = []
    for hs in selected:
        existing = await conn.fetchrow(
            "SELECT id FROM nodes WHERE id = (SELECT target_node_id FROM hotspots WHERE id = $1)",
            hs["id"],
        )
        if not existing:
            pending.append(hs)
    return pending


async def _build_child(
    hs: dict,
    parent: dict,
    page_agent: PageGenerationAgent,
    image_agent: ImageGenerationAgent,
    project_id: str,
    visual_style: str,
    language: str,
    selected_keywords: list[str],
    has_img_key: bool,
) -> dict:
    """单个热点的 build 流水线：LLM 生成文案 → 图片生成 → 规则法热点定位。"""
    child_node_id = gen_id("node_")
    raw_content = await page_agent.generate(
        hotspot_label=hs["label"],
        parent_title=parent["title"],
        parent_description=parent["description"],
        visual_style=visual_style,
        language=language,
        selected_keywords=selected_keywords,
    )
    page_content: dict = raw_content if isinstance(raw_content, dict) else {
        "title": hs["label"],
        "description": f"探索{hs['label']}",
        "image_prompt": f"illustrated knowledge guide about {hs['label']}, editorial illustration, 16:9",
        "sub_topics": [hs["label"]],
    }
    image_url = None
    if has_img_key:
        try:
            image_url = await image_agent.generate(
                prompt=page_content.get("image_prompt", hs["label"]),
                project_id=project_id,
                node_id=child_node_id,
            )
        except Exception as e:
            print(f"图片生成失败（{hs['label']}）: {e}")
    sub_topics = page_content.get("sub_topics") or [hs["label"]]
    return {
        "hs": hs,
        "child_node_id": child_node_id,
        "page_content": page_content,
        "image_url": image_url,
        "child_hotspots_data": _grid_hotspots(sub_topics),
    }


async def _persist_child(
    pool: asyncpg.Pool,
    project_id: str,
    parent_node_id: str,
    parent_depth: int,
    built: dict,
) -> dict:
    """写入一个子节点 + 它的热点 + 关联回父节点的热点。返回供 SSE 输出的 node dict。"""
    hs = built["hs"]
    child_node_id = built["child_node_id"]
    page_content = built["page_content"]
    image_url = built["image_url"]
    child_hotspots_data = built["child_hotspots_data"]

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO nodes (id, project_id, parent_id, depth, title, description,
               source_type, image_url, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'image', $7, 'generated')""",
            child_node_id, project_id, parent_node_id,
            parent_depth + 1,
            page_content.get("title", hs["label"]),
            page_content.get("description", ""),
            image_url,
        )
        await conn.execute(
            "UPDATE hotspots SET target_node_id = $1 WHERE id = $2",
            child_node_id, hs["id"],
        )
        for i, h in enumerate(child_hotspots_data):
            h_id = gen_id("hs_")
            await conn.execute(
                """INSERT INTO hotspots (id, node_id, label, pos_x, pos_y, width, height,
                   score, selected, sort_order)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)""",
                h_id, child_node_id,
                h.get("label", f"区域{i+1}"),
                float(h.get("x", 0.1)), float(h.get("y", 0.1)),
                float(h.get("width", 0.2)), float(h.get("height", 0.15)),
                float(h.get("score", 0.8)), i,
            )
            h["id"] = h_id

    return {
        "id": child_node_id,
        "parent_id": parent_node_id,
        "depth": parent_depth + 1,
        "title": page_content.get("title", hs["label"]),
        "description": page_content.get("description", ""),
        "image_url": image_url,
        "status": "generated",
        "hotspots": [
            {
                "id": h["id"],
                "label": h.get("label", f"区域{i+1}"),
                "position": {"x": float(h.get("x", 0.1)), "y": float(h.get("y", 0.1))},
                "size": {"width": float(h.get("width", 0.2)), "height": float(h.get("height", 0.15))},
                "score": float(h.get("score", 0.8)),
                "selected": False,
                "target_node_id": None,
            }
            for i, h in enumerate(child_hotspots_data)
        ],
        "children": [],
        "hotspot_id": hs["id"],
    }


@router.post("/projects/{project_id}/nodes/{node_id}/regenerate")
async def regenerate_node(
    project_id: str,
    node_id: str,
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
):
    llm_config = get_llm_config(request)
    imggen_config = get_imggen_config(request)

    async with pool.acquire() as conn:
        project = await conn.fetchrow("SELECT * FROM projects WHERE id = $1", project_id)
        node = await conn.fetchrow(
            "SELECT * FROM nodes WHERE id = $1 AND project_id = $2", node_id, project_id
        )
        if not project or not node:
            raise HTTPException(404, "节点不存在")

        # 获取父节点
        parent = None
        if node["parent_id"]:
            parent = await conn.fetchrow("SELECT * FROM nodes WHERE id = $1", node["parent_id"])

        # 获取关联热点标签
        hotspot = await conn.fetchrow(
            "SELECT * FROM hotspots WHERE target_node_id = $1", node_id
        )

    settings = json.loads(project["settings"]) if isinstance(project["settings"], str) else project["settings"]
    visual_style = settings.get("visual_style", "cinematic")
    language = settings.get("language", "zh")

    label = hotspot["label"] if hotspot else node["title"]
    parent_title = parent["title"] if parent else ""
    parent_desc = parent["description"] if parent else ""

    page_agent = PageGenerationAgent(llm_config)
    image_agent = ImageGenerationAgent(imggen_config)

    page_content = await page_agent.generate(
        hotspot_label=label,
        parent_title=parent_title,
        parent_description=parent_desc,
        visual_style=visual_style,
        language=language,
    )

    image_url = node["image_url"]
    if imggen_config.api_key:
        try:
            image_url = await image_agent.generate(
                prompt=page_content.get("image_prompt", label),
                project_id=project_id,
                node_id=node_id,
            )
        except Exception as e:
            print(f"重新生成图片失败: {e}")

    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE nodes SET title = $1, description = $2, image_url = $3,
               status = 'generated', updated_at = NOW()
               WHERE id = $4""",
            page_content.get("title", label),
            page_content.get("description", ""),
            image_url, node_id,
        )

    return {
        "id": node_id,
        "title": page_content.get("title", label),
        "description": page_content.get("description", ""),
        "image_url": image_url,
        "status": "generated",
    }
